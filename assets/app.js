/*!
 * app.js —— 练习台界面逻辑：把 Git 模拟器的状态画出来，并把命令接进来。
 */
(function () {
  'use strict';

  var GitSim = window.GitSim;
  var TASKS = window.GIT_TASKS || [];
  var STORAGE_KEY = 'git-practice-board-v1';
  var LANE_COLORS = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff', '#f7768e', '#ff9e64'];
  var CHEATS = [
    'git status', 'git add .', 'git add README.md', 'git commit -m "更新说明"',
    'git log --oneline', 'git diff', 'git branch', 'git switch -c feature/demo',
    'git switch main', 'git merge feature/demo', 'git tag v1.0', 'git push origin main',
    'git pull', 'git fetch', 'git stash', 'git stash pop', 'git reset --hard HEAD~1',
    'git reflog', 'help'
  ];

  var state = {
    repo: GitSim.freshRepo(),
    snapshots: [],
    used: {},
    entries: [],
    completed: {},
    editing: null,
    cmdHistory: [],
    cmdIndex: -1
  };

  var laneColorCache = {};

  /* ------------------------------------------------------------ DOM 小工具 */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function laneColor(name) {
    if (!name) return '#8b93a7';
    if (!laneColorCache[name]) {
      var keys = Object.keys(laneColorCache).length;
      laneColorCache[name] = LANE_COLORS[keys % LANE_COLORS.length];
    }
    return laneColorCache[name];
  }

  /* ------------------------------------------------------------ 持久化 */

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        repo: state.repo,
        used: state.used,
        completed: state.completed,
        entries: state.entries.slice(-30)
      }));
    } catch (err) { /* 隐私模式下可能写不了，忽略即可 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.repo) return false;
      state.repo = data.repo;
      state.used = data.used || {};
      state.completed = data.completed || {};
      state.entries = data.entries || [];
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------------------------ 执行命令 */

  function snapshot() {
    state.snapshots.push(JSON.stringify(state.repo));
    if (state.snapshots.length > 100) state.snapshots.shift();
  }

  function execute(raw) {
    var command = String(raw || '').trim();
    if (!command) return;

    snapshot();
    var result = GitSim.run(state.repo, command);
    if (result.kind && result.kind !== 'noop') {
      state.used[result.kind] = (state.used[result.kind] || 0) + 1;
    }

    if (result.clear) {
      state.entries = [];
    } else {
      state.entries.push({
        command: command,
        ok: result.ok !== false,
        lines: result.lines || [],
        explain: result.explain || ''
      });
      if (state.entries.length > 200) state.entries.shift();
    }

    state.cmdHistory.push(command);
    state.cmdIndex = state.cmdHistory.length;

    var newly = checkTasks();
    newly.forEach(function (task) {
      state.entries.push({
        command: '',
        ok: true,
        lines: ['🎉 关卡完成：' + task.title],
        explain: '干得漂亮！继续下一个关卡，或者自己在终端里随便试试。'
      });
    });

    renderAll();
    save();
  }

  function checkTasks() {
    var newly = [];
    var ctx = { repo: state.repo, used: state.used };
    TASKS.forEach(function (task) {
      if (state.completed[task.id]) return;
      var passed = false;
      try { passed = !!task.check(ctx); } catch (err) { passed = false; }
      if (passed) {
        state.completed[task.id] = true;
        newly.push(task);
      }
    });
    return newly;
  }

  /* ------------------------------------------------------------ 渲染：终端 */

  function renderTerminal() {
    var out = $('term-output');
    clear(out);
    if (!state.entries.length) {
      out.appendChild(el('div', 'line muted', '欢迎来到 Git 练习台。左边是你的文件，中间是提交图，右边是关卡。'));
      out.appendChild(el('div', 'line muted', '先试试输入 git init，或者直接点下面的“速查”按钮。'));
      return;
    }
    state.entries.forEach(function (entry) {
      var box = el('div', 'entry ' + (entry.ok ? 'ok' : 'err'));
      if (entry.command) {
        var cmdLine = el('div', 'cmdline');
        cmdLine.appendChild(el('span', 'prompt', '$ '));
        cmdLine.appendChild(el('span', 'cmdtext', entry.command));
        box.appendChild(cmdLine);
      }
      (entry.lines || []).forEach(function (line) {
        box.appendChild(el('pre', 'outline', line));
      });
      if (entry.explain) {
        var ex = el('div', 'explain');
        ex.appendChild(el('span', 'bulb', '💡 '));
        ex.appendChild(el('span', null, entry.explain));
        box.appendChild(ex);
      }
      out.appendChild(box);
    });
    out.scrollTop = out.scrollHeight;
  }

  /* ------------------------------------------------------------ 渲染：三区 */

  function fileStatus(path, st) {
    if (state.repo.conflicts[path]) return { label: '冲突待解决', tone: 'bad' };
    var staged = st.staged.filter(function (s) { return s.path === path; })[0];
    var unstaged = st.unstaged.filter(function (s) { return s.path === path; })[0];
    if (staged && unstaged) return { label: '已暂存 + 有新改动', tone: 'warn' };
    if (staged) return { label: '已暂存，等待提交', tone: 'good' };
    if (unstaged) return { label: unstaged.kind === 'deleted' ? '已删除（未暂存）' : '已修改（未暂存）', tone: 'warn' };
    if (!GitSim.headTree(state.repo)[path] && !state.repo.index[path]) return { label: '未跟踪', tone: 'dim' };
    return { label: '已提交', tone: 'dim' };
  }

  function renderWorkspace() {
    var repo = state.repo;
    var st = GitSim.statusOf(repo);
    var list = $('files-list');
    clear(list);

    var paths = Object.keys(repo.workdir).sort();
    if (!paths.length) {
      list.appendChild(el('div', 'muted', '工作区里没有文件。用 touch <文件名> 新建一个。'));
    }
    paths.forEach(function (path) {
      var status = fileStatus(path, st);
      var row = el('div', 'filerow' + (state.editing === path ? ' active' : ''));
      var dot = el('span', 'dot ' + status.tone);
      row.appendChild(dot);
      row.appendChild(el('span', 'fname', path));
      row.appendChild(el('span', 'badge ' + status.tone, status.label));
      row.addEventListener('click', function () { openEditor(path); });
      list.appendChild(row);
    });

    var indexList = $('index-list');
    clear(indexList);
    if (!st.staged.length && !st.conflicts.length) {
      indexList.appendChild(el('div', 'muted', '暂存区是空的。git add <文件> 可以把改动放进来。'));
    }
    st.staged.forEach(function (s) {
      var row = el('div', 'filerow');
      row.appendChild(el('span', 'dot good'));
      row.appendChild(el('span', 'fname', s.path));
      row.appendChild(el('span', 'badge good',
        s.kind === 'new' ? '新增' : s.kind === 'deleted' ? '删除' : '修改'));
      indexList.appendChild(row);
    });
    st.conflicts.forEach(function (p) {
      var row = el('div', 'filerow');
      row.appendChild(el('span', 'dot bad'));
      row.appendChild(el('span', 'fname', p));
      row.appendChild(el('span', 'badge bad', '有冲突'));
      row.addEventListener('click', function () { openEditor(p); });
      indexList.appendChild(row);
    });

    var info = $('repo-info');
    clear(info);
    addInfoRow(info, 'HEAD', repo.initialized ? GitSim.headLabel(repo) : '未初始化');
    addInfoRow(info, '提交数', String(GitSim.reachableCommits(repo).length));

    var branchBox = el('div', 'branchlist');
    if (!Object.keys(repo.branches).length) {
      branchBox.appendChild(el('div', 'muted', '还没有分支，git init 之后就出现 main 了。'));
    }
    Object.keys(repo.branches).forEach(function (name) {
      var row = el('div', 'branchrow');
      row.appendChild(el('span', 'swatch', ''));
      row.firstChild.style.background = laneColor(name);
      var isHead = !repo.HEAD.detached && repo.HEAD.name === name;
      row.appendChild(el('span', 'bname' + (isHead ? ' current' : ''), (isHead ? '● ' : '') + name));
      row.appendChild(el('span', 'bsha', repo.branches[name] ? GitSim.shortId(repo.branches[name]) : '(空)'));
      branchBox.appendChild(row);
    });
    if (repo.HEAD.detached) {
      branchBox.appendChild(el('div', 'warnline', '⚠ 当前处于分离头指针状态：' + GitSim.shortId(repo.HEAD.name)));
    }
    info.appendChild(branchBox);

    var tagNames = Object.keys(repo.tags);
    if (tagNames.length) {
      info.appendChild(el('div', 'section-label', '标签'));
      tagNames.forEach(function (t) {
        info.appendChild(el('div', 'tagline', t + ' → ' + GitSim.shortId(repo.tags[t])));
      });
    }
    if (repo.stash.length) {
      info.appendChild(el('div', 'section-label', '贮藏（stash）'));
      repo.stash.forEach(function (s, i) {
        info.appendChild(el('div', 'stashline', 'stash@{' + i + '}'));
      });
    }
  }

  function addInfoRow(parent, key, value) {
    var row = el('div', 'inforow');
    row.appendChild(el('span', 'infokey', key));
    row.appendChild(el('span', 'infoval', value));
    parent.appendChild(row);
  }

  function openEditor(path) {
    state.editing = path;
    $('editor-title').textContent = path;
    $('editor-panel').hidden = false;
    var ta = $('editor-textarea');
    ta.value = Object.prototype.hasOwnProperty.call(state.repo.workdir, path)
      ? state.repo.workdir[path]
      : '';
    renderWorkspace();
    ta.focus();
  }

  function closeEditor() {
    state.editing = null;
    $('editor-panel').hidden = true;
    renderWorkspace();
  }

  /* ------------------------------------------------------------ 渲染：提交图 */

  function renderGraph() {
    var wrap = $('graph-wrap');
    var width = Math.max(320, wrap.clientWidth || 520);
    var layout = GitSim.graphLayout(state.repo);
    var rows = layout.rows;
    var laneCount = Math.max(1, layout.lanes.length);

    var rowH = 46;
    var laneW = 28;
    var padLeft = 22;
    var padTop = 30;
    var graphWidth = padLeft + laneCount * laneW;
    var height = padTop + Math.max(rows.length, 1) * rowH + 14;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(height));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '提交图，共 ' + rows.length + ' 个提交，' + layout.lanes.length + ' 条泳道');

    function xOf(lane) { return padLeft + lane * laneW + laneW / 2; }
    function yOf(row) { return padTop + row * rowH + rowH / 2; }

    if (!rows.length) {
      var empty = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      empty.setAttribute('x', String(width / 2));
      empty.setAttribute('y', '56');
      empty.setAttribute('text-anchor', 'middle');
      empty.setAttribute('class', 'graph-empty');
      empty.textContent = '还没有提交。执行 git init → git add . → git commit -m "第一次提交"';
      svg.appendChild(empty);
    }

    // 连线
    layout.edges.forEach(function (edge) {
      var x1 = xOf(edge.fromLane), y1 = yOf(edge.fromRow) + 8;
      var x2 = xOf(edge.toLane), y2 = yOf(edge.toRow) - 8;
      var mid = (y1 + y2) / 2;
      var d = 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + mid + ', ' + x2 + ' ' + mid + ', ' + x2 + ' ' + y2;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', laneColor(layout.lanes[edge.fromLane] ? layout.lanes[edge.fromLane].name : ''));
      path.setAttribute('stroke-width', edge.isMerge ? '2.5' : '1.6');
      if (edge.isMerge) path.setAttribute('stroke-dasharray', '5 3');
      path.setAttribute('opacity', '0.85');
      svg.appendChild(path);
    });

    // 节点
    rows.forEach(function (item) {
      var commit = item.commit;
      var cx = xOf(item.lane), cy = yOf(item.row);
      var color = laneColor(layout.lanes[item.lane] ? layout.lanes[item.lane].name : '');
      var isHead = (!state.repo.HEAD.detached && state.repo.branches[state.repo.HEAD.name] === commit.id)
        || (state.repo.HEAD.detached && state.repo.HEAD.name === commit.id);

      if (isHead) {
        var ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('cx', String(cx));
        ring.setAttribute('cy', String(cy));
        ring.setAttribute('r', '11');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#e6edf3');
        ring.setAttribute('stroke-width', '1.5');
        ring.setAttribute('opacity', '0.75');
        svg.appendChild(ring);
      }

      var node = document.createElementNS('http://www.w3.org/2000/svg', commit.parents.length > 1 ? 'rect' : 'circle');
      if (commit.parents.length > 1) {
        node.setAttribute('x', String(cx - 6));
        node.setAttribute('y', String(cy - 6));
        node.setAttribute('width', '12');
        node.setAttribute('height', '12');
        node.setAttribute('rx', '2');
      } else {
        node.setAttribute('cx', String(cx));
        node.setAttribute('cy', String(cy));
        node.setAttribute('r', '6.5');
      }
      node.setAttribute('fill', color);
      node.setAttribute('stroke', '#0d1117');
      node.setAttribute('stroke-width', '1.5');
      svg.appendChild(node);

      // 提交号 + 说明
      var textX = graphWidth + 6;
      var available = Math.max(60, width - textX - 120);
      var perChar = 7.0;
      var maxChars = Math.max(10, Math.floor(available / perChar));
      var message = commit.msg.length > maxChars ? commit.msg.slice(0, maxChars - 1) + '…' : commit.msg;

      if (isHead) {
        var headTag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        headTag.setAttribute('x', String(cx));
        headTag.setAttribute('y', String(cy - 15));
        headTag.setAttribute('text-anchor', 'middle');
        headTag.setAttribute('class', 'graph-head');
        headTag.textContent = 'HEAD';
        svg.appendChild(headTag);
      }

      var shaText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      shaText.setAttribute('x', String(textX));
      shaText.setAttribute('y', String(cy + 4));
      shaText.setAttribute('class', 'graph-sha');
      shaText.textContent = GitSim.shortId(commit.id);
      svg.appendChild(shaText);

      var msgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      msgText.setAttribute('x', String(textX + 62));
      msgText.setAttribute('y', String(cy + 4));
      msgText.setAttribute('class', 'graph-msg');
      msgText.textContent = message;
      svg.appendChild(msgText);

      var tips = layout.tips[commit.id] || [];
      if (state.repo.tags && Object.keys(state.repo.tags).some(function (t) { return state.repo.tags[t] === commit.id; })) {
        Object.keys(state.repo.tags).forEach(function (t) {
          if (state.repo.tags[t] === commit.id) tips = tips.concat(['tag: ' + t]);
        });
      }
      var badgeX = width - 8;
      tips.slice().reverse().forEach(function (tip) {
        var label = tip;
        var w = label.length * 6.6 + 14;
        badgeX -= w + 6;
        if (badgeX < graphWidth) return;
        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(badgeX));
        rect.setAttribute('y', String(cy - 9));
        rect.setAttribute('width', String(w));
        rect.setAttribute('height', '18');
        rect.setAttribute('rx', '9');
        rect.setAttribute('fill', tip.indexOf('tag:') === 0 ? '#e0af68' : laneColor(tip));
        rect.setAttribute('opacity', '0.22');
        svg.appendChild(rect);
        var badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeText.setAttribute('x', String(badgeX + w / 2));
        badgeText.setAttribute('y', String(cy + 4));
        badgeText.setAttribute('text-anchor', 'middle');
        badgeText.setAttribute('fill', tip.indexOf('tag:') === 0 ? '#e0af68' : laneColor(tip));
        badgeText.setAttribute('font-size', '11');
        badgeText.textContent = label;
        svg.appendChild(badgeText);
      });
    });

    clear(wrap);
    wrap.appendChild(svg);

    // 图例
    var legend = $('graph-legend');
    clear(legend);
    if (layout.lanes.length) {
      layout.lanes.forEach(function (lane) {
        var item = el('span', 'legenditem');
        var sw = el('span', 'swatch');
        sw.style.background = laneColor(lane.name);
        item.appendChild(sw);
        item.appendChild(el('span', null, lane.name));
        legend.appendChild(item);
      });
      legend.appendChild(el('span', 'legendnote', '■ 方形节点 = 合并提交，虚线 = 合并操作引入的那条父线'));
    }
  }

  /* ------------------------------------------------------------ 渲染：远程仓库 */

  function renderRemote() {
    var box = $('remote-panel');
    clear(box);
    var repo = state.repo;
    var names = Object.keys(repo.remotes);

    if (!names.length) {
      box.appendChild(el('div', 'muted', '还没有连接远程仓库。填一个 GitHub 地址，就等于把本地和云端接起来：'));
      var form = el('div', 'rowform');
      var input = el('input', 'textinput');
      input.id = 'remote-url';
      input.placeholder = 'https://github.com/你的名字/git-exercise.git';
      var btn = el('button', 'btn', 'git remote add origin');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var url = input.value.trim() || 'https://github.com/yourname/git-exercise.git';
        execute('git remote add origin ' + url);
      });
      form.appendChild(input);
      form.appendChild(btn);
      box.appendChild(form);
      return;
    }

    names.forEach(function (name) {
      var remote = repo.remotes[name];
      var head = el('div', 'remotehead');
      head.appendChild(el('span', 'remotename', name));
      head.appendChild(el('span', 'remotedesc', '（GitHub 上的副本）'));
      box.appendChild(head);
      box.appendChild(el('div', 'remoteurl', remote.url));

      var branches = Object.keys(remote.branches);
      if (!branches.length) {
        box.appendChild(el('div', 'muted', '这个远程还是空的，push 一次就会出现在这里。'));
      }
      branches.forEach(function (b) {
        var row = el('div', 'branchrow');
        row.appendChild(el('span', 'swatch')); row.firstChild.style.background = laneColor(name + '/' + b);
        row.appendChild(el('span', 'bname', name + '/' + b));
        row.appendChild(el('span', 'bsha', GitSim.shortId(remote.branches[b])));
        var local = repo.branches[b];
        var same = local === remote.branches[b];
        row.appendChild(el('span', 'badge ' + (same ? 'good' : 'warn'), same ? '与本地一致' : '与本地不同'));
        box.appendChild(row);
      });
      if (repo.upstream && repo.upstream.remote === name) {
        box.appendChild(el('div', 'muted', '当前分支 ' + repo.upstream.branch + ' 跟踪 ' + name + '/' + repo.upstream.branch));
      }
    });

    var actions = el('div', 'rowform');
    var mate = el('button', 'btn', '模拟队友提交');
    mate.type = 'button';
    mate.addEventListener('click', function () {
      var res = GitSim.teammatePush(state.repo, '队友补充了文档');
      snapshot();
      state.entries.push({ command: '（GitHub 上的队友推送了一个提交）', ok: res.ok, lines: res.lines, explain: res.explain });
      renderAll();
      save();
    });
    var fetchBtn = el('button', 'btn', 'git fetch');
    fetchBtn.type = 'button';
    fetchBtn.addEventListener('click', function () { execute('git fetch'); });
    var pullBtn = el('button', 'btn', 'git pull');
    pullBtn.type = 'button';
    pullBtn.addEventListener('click', function () { execute('git pull'); });
    var pushBtn = el('button', 'btn btn-primary', 'git push origin main');
    pushBtn.type = 'button';
    pushBtn.addEventListener('click', function () { execute('git push origin main'); });
    actions.appendChild(mate);
    actions.appendChild(fetchBtn);
    actions.appendChild(pullBtn);
    actions.appendChild(pushBtn);
    box.appendChild(actions);
  }

  /* ------------------------------------------------------------ 渲染：关卡 */

  function renderTasks() {
    var list = $('tasks-list');
    clear(list);
    var done = 0;
    var groups = {};
    TASKS.forEach(function (task) {
      if (state.completed[task.id]) done++;
      if (!groups[task.group]) groups[task.group] = [];
      groups[task.group].push(task);
    });

    Object.keys(groups).forEach(function (groupName) {
      list.appendChild(el('div', 'section-label', groupName));
      groups[groupName].forEach(function (task) {
        var isDone = !!state.completed[task.id];
        var item = el('div', 'task' + (isDone ? ' done' : ''));
        var head = el('div', 'taskhead');
        head.appendChild(el('span', 'check', isDone ? '✔' : '○'));
        head.appendChild(el('span', 'tasktitle', task.title));
        item.appendChild(head);
        item.appendChild(el('div', 'taskdesc', task.desc));

        var hint = el('div', 'taskhint');
        hint.hidden = true;
        hint.appendChild(el('div', 'hinttext', task.hint));
        var fill = el('button', 'btn btn-small', '把示例命令填进终端');
        fill.type = 'button';
        fill.addEventListener('click', function () {
          var input = $('term-input');
          input.value = task.example;
          input.focus();
        });
        hint.appendChild(fill);
        item.appendChild(hint);

        var toggle = el('button', 'linkbtn', '提示 / 示例命令');
        toggle.type = 'button';
        toggle.addEventListener('click', function () { hint.hidden = !hint.hidden; });
        item.appendChild(toggle);

        list.appendChild(item);
      });
    });

    var total = TASKS.length;
    $('tasks-progress-text').textContent = done + ' / ' + total + ' 关';
    var bar = $('tasks-progress-bar');
    bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    $('tasks-progress').setAttribute('aria-valuenow', String(done));
  }

  /* ------------------------------------------------------------ 渲染：顶部与速查 */

  function renderHeader() {
    var repo = state.repo;
    var pill = $('status-pill');
    if (!repo.initialized) {
      pill.textContent = '尚未初始化仓库';
      pill.className = 'pill warn';
    } else if (repo.HEAD.detached) {
      pill.textContent = '分离头指针 ' + GitSim.shortId(repo.HEAD.name);
      pill.className = 'pill bad';
    } else {
      pill.textContent = '分支 ' + repo.HEAD.name + ' · ' + GitSim.reachableCommits(repo).length + ' 个提交';
      pill.className = 'pill good';
    }
    $('prompt-path').textContent = repo.initialized ? '~/git-exercise' : '~/git-exercise (不是 Git 仓库)';
  }

  function renderCheats() {
    var box = $('cheats');
    if (box.childElementCount) return;
    CHEATS.forEach(function (cmd) {
      var btn = el('button', 'chip', cmd);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var input = $('term-input');
        input.value = cmd;
        input.focus();
      });
      box.appendChild(btn);
    });
  }

  function renderAll() {
    renderHeader();
    renderWorkspace();
    renderGraph();
    renderRemote();
    renderTasks();
    renderTerminal();
    renderCheats();
  }

  /* ------------------------------------------------------------ 事件绑定 */

  function complete(input) {
    var value = input.value;
    var tokens = value.split(' ');
    var last = tokens[tokens.length - 1];
    var pool = tokens.length <= 1
      ? ['git', 'help', 'clear', 'ls', 'touch']
      : ['status', 'add', 'commit', 'log', 'diff', 'branch', 'switch', 'checkout',
        'merge', 'rebase', 'tag', 'stash', 'reset', 'reflog', 'remote', 'push', 'fetch', 'pull'];
    var matches = pool.filter(function (c) { return c.indexOf(last) === 0; });
    if (matches.length === 1) {
      tokens[tokens.length - 1] = matches[0];
      input.value = tokens.join(' ');
    }
  }

  function boot() {
    var restored = load();
    checkTasks();

    $('term-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var input = $('term-input');
      execute(input.value);
      input.value = '';
    });

    $('term-input').addEventListener('keydown', function (event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        complete(event.target);
        return;
      }
      if (event.key === 'ArrowUp') {
        if (!state.cmdHistory.length) return;
        event.preventDefault();
        state.cmdIndex = Math.max(0, state.cmdIndex - 1);
        event.target.value = state.cmdHistory[state.cmdIndex] || '';
      }
      if (event.key === 'ArrowDown') {
        if (!state.cmdHistory.length) return;
        event.preventDefault();
        state.cmdIndex = Math.min(state.cmdHistory.length, state.cmdIndex + 1);
        event.target.value = state.cmdHistory[state.cmdIndex] || '';
      }
    });

    $('editor-save').addEventListener('click', function () {
      if (!state.editing) return;
      snapshot();
      state.repo.workdir[state.editing] = $('editor-textarea').value;
      var name = state.editing;
      state.entries.push({
        command: '（在编辑器里修改了 ' + name + '）',
        ok: true,
        lines: [],
        explain: '文件内容变了，工作区因此变“脏”。接下来用 git diff 看改了什么，再 git add 把它放进暂存区。'
      });
      closeEditor();
      renderAll();
      save();
    });
    $('editor-cancel').addEventListener('click', closeEditor);

    $('newfile-btn').addEventListener('click', function () {
      var input = $('newfile-input');
      var name = input.value.trim();
      if (!name) return;
      if (Object.prototype.hasOwnProperty.call(state.repo.workdir, name)) {
        input.value = '';
        openEditor(name);
        return;
      }
      snapshot();
      state.repo.workdir[name] = '';
      input.value = '';
      state.entries.push({
        command: 'touch ' + name,
        ok: true,
        lines: [],
        explain: '新建了文件 ' + name + '。它还处于“未跟踪”状态，git add 之后才会被 Git 管理。'
      });
      openEditor(name);
      renderAll();
      save();
    });

    $('btn-undo').addEventListener('click', function () {
      if (!state.snapshots.length) {
        state.entries.push({ command: '（撤销）', ok: false, lines: ['已经没有可以撤销的步骤了。'], explain: '' });
        renderTerminal();
        return;
      }
      state.repo = JSON.parse(state.snapshots.pop());
      state.entries.push({
        command: '（撤销上一步）',
        ok: true,
        lines: ['仓库状态已回到上一条命令之前。'],
        explain: '这里撤销的是练习台的模拟状态，不是 git 本身的命令。真实仓库里撤销提交要用 git reset / git revert。'
      });
      renderAll();
      save();
    });

    $('btn-reset').addEventListener('click', function () {
      state.repo = GitSim.freshRepo();
      state.snapshots = [];
      state.used = {};
      state.completed = {};
      state.editing = null;
      state.entries = [];
      $('editor-panel').hidden = true;
      renderAll();
      save();
    });

    $('btn-help').addEventListener('click', function () { execute('help'); });

    if (window.ResizeObserver) {
      var timer = null;
      new ResizeObserver(function () {
        window.clearTimeout(timer);
        timer = window.setTimeout(renderGraph, 120);
      }).observe($('graph-wrap'));
    }

    renderAll();
    if (restored) {
      state.entries.push({
        command: '（从上次的进度继续）',
        ok: true,
        lines: ['已恢复上次练习的仓库状态。想从头开始，点右上角“重置练习”。'],
        explain: ''
      });
      renderTerminal();
    }
    $('term-input').focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
