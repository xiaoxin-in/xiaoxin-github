/*!
 * git-engine.js —— 跑在浏览器里的“极简 Git 模拟器”
 *
 * 设计目标：把 Git 的内部状态（工作区 / 暂存区 / 提交 / 分支 / 远程）做成
 * 可以被页面直接画出来的数据结构，并在执行命令时给出中文解释。
 * 纯内存实现，不接触真实文件系统，不会影响你电脑上的任何仓库。
 */
(function (global) {
  'use strict';

  /* ============================================================ 通用工具 */

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function tokenize(input) {
    var out = [];
    var re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    var m;
    while ((m = re.exec(input)) !== null) {
      if (m[1] !== undefined) out.push(m[1]);
      else if (m[2] !== undefined) out.push(m[2]);
      else out.push(m[3]);
    }
    return out;
  }

  function shortId(id) {
    return id ? String(id).slice(0, 7) : '(空)';
  }

  function splitLines(text) {
    return String(text == null ? '' : text).split('\n');
  }

  function pad(text, width) {
    text = String(text);
    while (text.length < width) text += ' ';
    return text;
  }

  /* 逐行 LCS 差异，用于 git diff 的展示 */
  function diffLines(before, after) {
    var A = splitLines(before).slice(0, 400);
    var B = splitLines(after).slice(0, 400);
    var n = A.length, m = B.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var out = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ type: 'ctx', text: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i] }); i++; }
      else { out.push({ type: 'add', text: B[j] }); j++; }
    }
    while (i < n) out.push({ type: 'del', text: A[i++] });
    while (j < m) out.push({ type: 'add', text: B[j++] });
    return out;
  }

  /* 生成一个看起来像 sha 的提交号（练习站内部标识，不具备真实哈希含义） */
  function makeSha(repo, message) {
    var seed = message + '|' + repo.nextId + '|' + repo.clock + '|' + Math.random();
    var h = 0x811c9dc5;
    var hex = '';
    for (var round = 0; round < 4; round++) {
      for (var i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      hex += ('00000000' + h.toString(16)).slice(-8);
    }
    return hex.slice(0, 40);
  }

  /* ============================================================ 初始状态 */

  function createRepo() {
    return {
      initialized: false,
      nextId: 1,
      clock: 0,
      branches: {},
      branchOrder: [],
      HEAD: { name: 'main', detached: false },
      commits: {},
      tags: {},
      workdir: {},
      index: {},
      conflicts: {},
      stash: [],
      remotes: {},
      upstream: null,
      pendingMerge: null,
      stats: { conflictsResolved: 0, pushes: 0, pulls: 0, rebases: 0, resets: 0, stashes: 0 },
      reflog: []
    };
  }

  /* 练习目录里“本来就存在”的文件 */
  function seedFiles(repo) {
    repo.workdir = {
      'README.md':
        '# 我的练习仓库\n' +
        '\n' +
        '这是用来练习 Git 的地方，随便改。\n',
      'src/app.js':
        'function hello(name) {\n' +
        '  return "hello, " + name;\n' +
        '}\n' +
        '\n' +
        'console.log(hello("git"));\n',
      'docs/notes.md':
        '# 随手记\n' +
        '\n' +
        '- 今天学会了 git add\n'
    };
    repo.index = {};
    repo.conflicts = {};
    return repo;
  }

  function freshRepo() {
    return seedFiles(createRepo());
  }

  /* ============================================================ 引用与查询 */

  function headCommit(repo) {
    if (repo.HEAD.detached) return repo.commits[repo.HEAD.name] || null;
    var id = repo.branches[repo.HEAD.name];
    return id ? repo.commits[id] || null : null;
  }

  function headLabel(repo) {
    return repo.HEAD.detached ? 'HEAD 已分离于 ' + shortId(repo.HEAD.name) : repo.HEAD.name;
  }

  function treeOfCommit(repo, id) {
    var c = id ? repo.commits[id] : null;
    return c ? c.tree : {};
  }

  function headTree(repo) {
    var c = headCommit(repo);
    return c ? c.tree : {};
  }

  function resolveRef(repo, name) {
    if (!name) {
      var h = headCommit(repo);
      return h ? h.id : null;
    }
    name = String(name).trim();

    var rel = name.match(/^([^~^]+)((?:[~^]\d*)+)$/);
    if (rel) {
      var base = resolveRef(repo, rel[1]);
      if (!base) return null;
      var ops = rel[2].match(/[~^]\d*/g) || [];
      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        var count = op.length > 1 ? parseInt(op.slice(1), 10) : 1;
        if (op[0] === '^' && count > 1) count = 1;
        for (var k = 0; k < count; k++) {
          var c = repo.commits[base];
          if (!c || !c.parents.length) return null;
          base = c.parents[0];
        }
      }
      return base;
    }

    if (name === 'HEAD' || name === '@') {
      var hc = headCommit(repo);
      return hc ? hc.id : null;
    }
    if (has(repo.branches, name)) return repo.branches[name];
    if (has(repo.tags, name)) return repo.tags[name];

    var rm = name.match(/^([^/]+)\/(.+)$/);
    if (rm && has(repo.remotes, rm[1]) && has(repo.remotes[rm[1]].branches, rm[2])) {
      return repo.remotes[rm[1]].branches[rm[2]];
    }

    var ids = Object.keys(repo.commits);
    for (var j = 0; j < ids.length; j++) {
      if (ids[j] === name || ids[j].slice(0, name.length) === name) return ids[j];
    }
    return null;
  }

  function ancestors(repo, id, acc) {
    acc = acc || {};
    if (!id || acc[id]) return acc;
    acc[id] = true;
    var c = repo.commits[id];
    if (!c) return acc;
    c.parents.forEach(function (p) { ancestors(repo, p, acc); });
    return acc;
  }

  function isAncestor(repo, maybeAncestor, id) {
    if (!maybeAncestor || !id) return false;
    return has(ancestors(repo, id), maybeAncestor);
  }

  function mergeBase(repo, a, b) {
    if (!a || !b) return null;
    var ancA = ancestors(repo, a);
    var best = null;
    var frontier = [b];
    var seen = {};
    while (frontier.length) {
      var next = [];
      frontier.forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        if (has(ancA, id)) {
          if (!best || repo.commits[id].time > repo.commits[best].time) best = id;
        }
        (repo.commits[id] ? repo.commits[id].parents : []).forEach(function (p) { next.push(p); });
      });
      frontier = next;
    }
    return best;
  }

  /* 所有“现在还能追溯到”的提交号：分支、标签、远程分支、分离头指针 */
  function reachableCommits(repo) {
    var pool = {};
    function add(id) {
      if (!id) return;
      Object.keys(ancestors(repo, id)).forEach(function (x) { pool[x] = true; });
    }
    Object.keys(repo.branches).forEach(function (b) { add(repo.branches[b]); });
    Object.keys(repo.tags).forEach(function (t) { add(repo.tags[t]); });
    Object.keys(repo.remotes).forEach(function (r) {
      Object.keys(repo.remotes[r].branches).forEach(function (b) { add(repo.remotes[r].branches[b]); });
    });
    if (repo.HEAD.detached) add(repo.HEAD.name);
    return Object.keys(pool).filter(function (id) { return !!repo.commits[id]; });
  }

  /* 提交图布局：每个提交落到“它诞生时所在分支”的泳道上 */
  function graphLayout(repo) {
    var commits = reachableCommits(repo).map(function (id) { return repo.commits[id]; });
    commits.sort(function (a, b) { return b.time - a.time; });

    var laneByName = {};
    var lanes = [];
    var laneOfCommit = {};
    commits.forEach(function (c) {
      var name = c.branch || 'HEAD';
      if (!has(laneByName, name)) {
        laneByName[name] = lanes.length;
        lanes.push(name);
      }
      laneOfCommit[c.id] = laneByName[name];
    });

    var rowOf = {};
    var rows = commits.map(function (c, i) {
      rowOf[c.id] = i;
      return { id: c.id, commit: c, lane: laneOfCommit[c.id], row: i };
    });

    var edges = [];
    commits.forEach(function (c) {
      c.parents.forEach(function (p) {
        if (!has(rowOf, p)) return;
        edges.push({
          from: c.id, to: p,
          fromLane: laneOfCommit[c.id], toLane: laneOfCommit[p],
          fromRow: rowOf[c.id], toRow: rowOf[p],
          isMerge: c.parents.length > 1
        });
      });
    });

    var tips = {};
    Object.keys(repo.branches).forEach(function (name) {
      var id = repo.branches[name];
      if (id) tips[id] = (tips[id] || []).concat([name]);
    });

    return {
      rows: rows,
      edges: edges,
      lanes: lanes.map(function (name, index) { return { name: name, index: index }; }),
      tips: tips,
      detachedHead: repo.HEAD.detached ? repo.HEAD.name : null
    };
  }

  /* ============================================================ 状态对比 */

  function statusOf(repo) {
    var ht = headTree(repo);
    var staged = [];
    var unstaged = [];
    var untracked = [];
    var conflicts = [];

    Object.keys(repo.index).forEach(function (p) {
      if (has(repo.conflicts, p)) return;
      var idx = repo.index[p];
      if (idx === null) { staged.push({ path: p, kind: 'deleted' }); return; }
      if (!has(ht, p)) staged.push({ path: p, kind: 'new' });
      else if (ht[p] !== idx) staged.push({ path: p, kind: 'modified' });
    });

    Object.keys(repo.conflicts).forEach(function (p) {
      conflicts.push(p);
    });

    Object.keys(repo.workdir).forEach(function (p) {
      if (has(repo.conflicts, p)) return;
      var content = repo.workdir[p];
      if (has(repo.index, p)) {
        if (repo.index[p] !== content) unstaged.push({ path: p, kind: 'modified' });
      } else if (has(ht, p)) {
        if (ht[p] !== content) unstaged.push({ path: p, kind: 'modified' });
      } else {
        untracked.push(p);
      }
    });

    Object.keys(ht).forEach(function (p) {
      if (!has(repo.workdir, p) && !has(repo.index, p)) {
        unstaged.push({ path: p, kind: 'deleted' });
      }
    });

    return { staged: staged, unstaged: unstaged, untracked: untracked, conflicts: conflicts };
  }

  function isDirty(repo) {
    var st = statusOf(repo);
    return st.staged.length + st.unstaged.length + st.untracked.length + st.conflicts.length > 0;
  }

  /* ============================================================ 提交与合并 */

  function createCommit(repo, opts) {
    var id = makeSha(repo, opts.message);
    var commit = {
      id: id,
      msg: opts.message,
      parents: opts.parents || [],
      tree: opts.tree || {},
      time: repo.clock++,
      branch: opts.branch || 'HEAD',
      author: opts.author || '你',
      isMerge: (opts.parents || []).length > 1
    };
    repo.commits[id] = commit;

    if (opts.moveBranch && !repo.HEAD.detached) {
      repo.branches[repo.HEAD.name] = id;
    } else if (opts.moveBranch) {
      repo.HEAD.name = id;
    }
    pushReflog(repo, opts.reflogAction || ('commit: ' + opts.message), id);
    return commit;
  }

  function pushReflog(repo, action, id) {
    repo.reflog.unshift({ action: action, id: id, ref: repo.HEAD.detached ? 'HEAD' : repo.HEAD.name });
    if (repo.reflog.length > 200) repo.reflog.length = 200;
  }

  function applyIndexToTree(repo, baseTree) {
    var tree = deepClone(baseTree);
    Object.keys(repo.index).forEach(function (p) {
      if (repo.index[p] === null) delete tree[p];
      else tree[p] = repo.index[p];
    });
    return tree;
  }

  function conflictContent(ours, theirs, oursLabel, theirsLabel) {
    return '<<<<<<< ' + oursLabel + '\n' +
      (ours || '') + (ours && ours.slice(-1) !== '\n' ? '\n' : '') +
      '=======\n' +
      (theirs || '') + (theirs && theirs.slice(-1) !== '\n' ? '\n' : '') +
      '>>>>>>> ' + theirsLabel + '\n';
  }

  function threeWayMerge(repo, baseTree, oursTree, theirsTree) {
    var paths = {};
    [baseTree, oursTree, theirsTree].forEach(function (t) {
      Object.keys(t).forEach(function (p) { paths[p] = true; });
    });

    var merged = {};
    var conflicts = {};

    Object.keys(paths).forEach(function (p) {
      var inBase = has(baseTree, p), inOurs = has(oursTree, p), inTheirs = has(theirsTree, p);
      var b = baseTree[p], o = oursTree[p], t = theirsTree[p];

      if (o === t) { if (inOurs) merged[p] = o; return; }
      if (inOurs && inBase && o === b) { if (inTheirs) merged[p] = t; return; }
      if (inTheirs && inBase && t === b) { if (inOurs) merged[p] = o; return; }
      if (!inOurs && inBase && b === t) return;
      if (!inTheirs && inBase && b === o) { if (inOurs) merged[p] = o; return; }
      conflicts[p] = {
        base: inBase ? b : '',
        ours: inOurs ? o : '',
        theirs: inTheirs ? t : ''
      };
    });

    return { merged: merged, conflicts: conflicts };
  }

  /* 把 fromTree → toTree 的变化套用到 targetTree 上，用于 rebase 的单步重放 */
  function applyDelta(fromTree, toTree, targetTree) {
    var target = deepClone(targetTree);
    var conflicts = [];
    var pathSet = {};
    Object.keys(fromTree).forEach(function (p) { pathSet[p] = true; });
    Object.keys(toTree).forEach(function (p) { pathSet[p] = true; });

    Object.keys(pathSet).forEach(function (p) {
      var before = fromTree[p];
      var after = toTree[p];
      if (before === after) return;
      var current = target[p];
      if (current !== before && current !== after) { conflicts.push(p); return; }
      if (after === undefined) delete target[p];
      else target[p] = after;
    });

    return { tree: target, conflicts: conflicts };
  }

  /* ============================================================ 输出格式 */

  function statusText(repo) {
    var out = [];
    var st = statusOf(repo);

    if (!repo.initialized) {
      out.push('fatal: not a git repository (or any of the parent directories): .git');
      return { ok: false, lines: out, explain: '这里还不是一个 Git 仓库，先执行 git init。' };
    }

    out.push('On branch ' + headLabel(repo));

    var up = repo.upstream;
    if (up && has(repo.remotes, up.remote)) {
      var remoteId = repo.remotes[up.remote].branches[up.branch];
      var localId = repo.branches[up.branch];
      if (remoteId && localId) {
        if (remoteId === localId) out.push("Your branch is up to date with '" + up.remote + '/' + up.branch + "'.");
        else if (isAncestor(repo, remoteId, localId)) out.push("Your branch is ahead of '" + up.remote + '/' + up.branch + "' by 1 commit.");
        else if (isAncestor(repo, localId, remoteId)) out.push("Your branch is behind '" + up.remote + '/' + up.branch + "' by 1 commit.");
        else out.push("Your branch and '" + up.remote + '/' + up.branch + "' have diverged.");
      }
    }
    if (repo.pendingMerge) {
      out.push('You have unmerged paths.');
      out.push('  (fix conflicts and run "git commit")');
    }
    if (!headCommit(repo) && !repo.pendingMerge) {
      out.push('');
      out.push('No commits yet');
    }

    if (st.staged.length) {
      out.push('');
      out.push('Changes to be committed:');
      out.push('  (use "git restore --staged <file>..." to unstage)');
      st.staged.forEach(function (s) {
        var label = s.kind === 'new' ? 'new file' : s.kind === 'deleted' ? 'deleted' : 'modified';
        out.push('\t' + pad(label + ':', 13) + s.path);
      });
    }
    if (st.conflicts.length) {
      out.push('');
      out.push('Unmerged paths:');
      out.push('  (use "git add <file>..." to mark resolution)');
      st.conflicts.forEach(function (p) { out.push('\t' + pad('both modified:', 13) + p); });
    }
    if (st.unstaged.length) {
      out.push('');
      out.push('Changes not staged for commit:');
      out.push('  (use "git add <file>..." to update what will be committed)');
      st.unstaged.forEach(function (s) {
        out.push('\t' + pad((s.kind === 'deleted' ? 'deleted' : 'modified') + ':', 13) + s.path);
      });
    }
    if (st.untracked.length) {
      out.push('');
      out.push('Untracked files:');
      out.push('  (use "git add <file>..." to include in what will be committed)');
      st.untracked.forEach(function (p) { out.push('\t' + p); });
    }
    if (!st.staged.length && !st.unstaged.length && !st.untracked.length && !st.conflicts.length) {
      out.push('');
      out.push('nothing to commit, working tree clean');
    }

    return {
      ok: true, lines: out,
      explain: 'git status 只是“看”：它对比工作区、暂存区和最后一次提交，告诉你哪些改动还没被记录。'
    };
  }

  function logText(repo, opts) {
    var ids = [];
    if (opts.all) {
      var seen = {};
      Object.keys(repo.branches).forEach(function (b) {
        Object.keys(ancestors(repo, repo.branches[b])).forEach(function (id) {
          if (!seen[id]) { seen[id] = true; ids.push(id); }
        });
      });
      Object.keys(repo.remotes).forEach(function (r) {
        Object.keys(repo.remotes[r].branches).forEach(function (b) {
          Object.keys(ancestors(repo, repo.remotes[r].branches[b])).forEach(function (id) {
            if (!seen[id]) { seen[id] = true; ids.push(id); }
          });
        });
      });
    } else {
      var head = headCommit(repo);
      ids = head ? Object.keys(ancestors(repo, head.id)) : [];
    }
    ids.sort(function (a, b) { return repo.commits[b].time - repo.commits[a].time; });

    if (!ids.length) {
      return {
        ok: false,
        lines: ['fatal: your current branch does not have any commits yet'],
        explain: '还没有任何提交，log 自然是空的。'
      };
    }

    var tagsAt = {};
    Object.keys(repo.tags).forEach(function (t) {
      var id = repo.tags[t];
      tagsAt[id] = (tagsAt[id] || []).concat([t]);
    });
    var branchesAt = {};
    Object.keys(repo.branches).forEach(function (b) {
      var id = repo.branches[b];
      if (!id) return;
      branchesAt[id] = (branchesAt[id] || []).concat([b]);
    });

    var lines = [];
    ids.forEach(function (id) {
      var c = repo.commits[id];
      var refs = [];
      if (!repo.HEAD.detached && repo.branches[repo.HEAD.name] === id) refs.push('HEAD -> ' + repo.HEAD.name);
      else if (repo.HEAD.detached && repo.HEAD.name === id) refs.push('HEAD');
      (branchesAt[id] || []).forEach(function (b) {
        if (!repo.HEAD.detached && repo.HEAD.name === b) return;
        refs.push(b);
      });
      (tagsAt[id] || []).forEach(function (t) { refs.push('tag: ' + t); });

      if (opts.oneline) {
        lines.push(shortId(id) + (refs.length ? ' (' + refs.join(', ') + ')' : '') + ' ' + c.msg);
      } else {
        lines.push('commit ' + id + (refs.length ? ' (' + refs.join(', ') + ')' : ''));
        lines.push('Author: ' + c.author);
        lines.push('Date:   第 ' + (c.time + 1) + ' 次提交');
        lines.push('');
        lines.push('    ' + c.msg);
        lines.push('');
      }
    });
    return {
      ok: true, lines: lines,
      explain: 'git log 沿着“父提交”往回走，列出当前分支能追溯到的一串快照。'
    };
  }

  function diffText(repo) {
    var ht = headTree(repo);
    var lines = [];
    var st = statusOf(repo);
    var targets = {};
    st.unstaged.forEach(function (s) { targets[s.path] = true; });
    st.staged.forEach(function (s) { targets[s.path] = true; });

    var paths = Object.keys(targets);
    if (!paths.length) {
      return {
        ok: true,
        lines: ['(工作区与最后一次提交完全一致，没有差异)'],
        explain: 'git diff 显示还没被提交的改动。'
      };
    }

    paths.forEach(function (p) {
      var before = has(ht, p) ? ht[p] : '';
      var after = has(repo.workdir, p) ? repo.workdir[p] : '';
      if (before === after) return;
      lines.push('diff --git a/' + p + ' b/' + p);
      lines.push('--- a/' + p);
      lines.push('+++ b/' + p);
      diffLines(before, after).forEach(function (d) {
        var sign = d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ';
        lines.push(sign + d.text);
      });
    });
    if (!lines.length) lines.push('(没有差异)');
    return { ok: true, lines: lines, explain: '带 + 的是新加的行，带 - 的是被删掉的行。' };
  }

  /* ============================================================ 命令实现 */

  function needRepo(repo) {
    if (!repo.initialized) {
      return {
        ok: false,
        lines: ['fatal: not a git repository (or any of the parent directories): .git'],
        explain: '先 git init 把这个目录变成仓库。'
      };
    }
    return null;
  }

  var COMMANDS = {};

  COMMANDS.init = function (repo) {
    if (repo.initialized) {
      return {
        ok: true,
        lines: ['Reinitialized existing Git repository in ./practice/.git/'],
        explain: '仓库已经存在，重复 init 不会清空历史。'
      };
    }
    repo.initialized = true;
    repo.branches = { main: null };
    repo.branchOrder = ['main'];
    repo.HEAD = { name: 'main', detached: false };
    var out = ['Initialized empty Git repository in ./practice/.git/'];
    var untracked = Object.keys(repo.workdir);
    if (untracked.length) {
      out.push('');
      out.push('提示：目录里已经有 ' + untracked.length + ' 个文件（' + untracked.join('、') + '），它们现在都是“未跟踪”状态。');
    }
    return {
      ok: true, lines: out,
      explain: 'git init 在目录里建了一个隐藏的 .git 文件夹，从这一刻起这里的一切改动都能被记录了。此时分支叫 main，但还没有任何提交。'
    };
  };

  COMMANDS.status = function (repo) { return statusText(repo); };

  COMMANDS.add = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;

    var flags = args.filter(function (a) { return a[0] === '-'; });
    var paths = args.filter(function (a) { return a[0] !== '-'; });
    var all = flags.some(function (f) { return f === '-A' || f === '--all'; });

    var targets = [];
    if (all || paths.indexOf('.') >= 0 || !paths.length) {
      targets = Object.keys(repo.workdir);
      Object.keys(repo.conflicts).forEach(function (p) { if (targets.indexOf(p) < 0) targets.push(p); });
    } else {
      paths.forEach(function (p) {
        if (has(repo.workdir, p) || has(repo.conflicts, p) || has(repo.index, p)) targets.push(p);
      });
    }

    if (!targets.length) {
      var bad = paths.length ? paths.join('、') : '(未指定文件)';
      return {
        ok: false,
        lines: ['fatal: pathspec ' + bad + ' did not match any files'],
        explain: '没找到这些文件，检查一下路径是否写对。'
      };
    }

    var notes = [];
    targets.forEach(function (p) {
      if (has(repo.conflicts, p)) {
        var content = repo.workdir[p] || '';
        if (content.indexOf('<<<<<<<') >= 0) {
          notes.push('warning: ' + p + ' 里还留着冲突标记 <<<<<<<，记得把两边内容整理成你想要的样子。');
        }
        delete repo.conflicts[p];
        repo.stats.conflictsResolved++;
      }
      repo.index[p] = has(repo.workdir, p) ? repo.workdir[p] : null;
    });

    if (!Object.keys(repo.conflicts).length && repo.pendingMerge && !notes.length) {
      notes.push('提示：冲突已全部标记为解决，现在执行 git commit 完成这次合并。');
    }

    return {
      ok: true, lines: notes,
      explain: 'git add 把工作区里选中的内容复制一份放进暂存区（index）。暂存区就是“下次提交要包含什么”的清单。'
    };
  };

  COMMANDS.commit = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;

    var head0 = headCommit(repo);
    var message = null;
    var autoAdd = false;
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-m' || args[i] === '--message') { message = args[i + 1]; break; }
      if (args[i] === '-am' || args[i] === '-a') { autoAdd = true; message = args[i + 1] || null; if (message) break; continue; }
      var inline = args[i].match(/^-a?m(.+)$/);
      if (inline) {
        if (args[i].indexOf('-am') === 0) autoAdd = true;
        message = inline[1];
        break;
      }
    }
    var amend = args.indexOf('--amend') >= 0;

    if (autoAdd) {
      var st = statusOf(repo);
      var ht = headTree(repo);
      st.unstaged.forEach(function (s) {
        if (has(ht, s.path) || has(repo.index, s.path)) repo.index[s.path] = repo.workdir[s.path];
      });
    }

    if (amend && !message && head0) message = head0.msg;
    if (!message && !amend) {
      return {
        ok: false,
        lines: ['error: 练习站只支持 git commit -m "说明" 这种写法'],
        explain: '提交必须有说明。真实终端里会打开编辑器让你写，这里直接用 -m 更省事。'
      };
    }

    if (Object.keys(repo.conflicts).length) {
      return {
        ok: false,
        lines: [
          'error: Committing is not possible because you have unmerged files.',
          'hint: Fix them up in the work tree, and then use "git add <file>"',
          'hint: as appropriate to mark resolution and make a commit.'
        ],
        explain: '还有文件处于冲突状态没解决完，Git 不让提交。编辑冲突文件、删掉 <<<<<<< 这些标记，再 git add，然后才能 commit。'
      };
    }

    var stagedPaths = Object.keys(repo.index);
    var pending = repo.pendingMerge;
    if (!stagedPaths.length && !pending && !amend) {
      return {
        ok: false,
        lines: [
          'On branch ' + headLabel(repo),
          'nothing to commit, working tree clean'
        ],
        explain: '暂存区是空的，没有东西可以提交。先修改文件再 git add。'
      };
    }

    var head = headCommit(repo);
    var parents = [];
    if (amend && head) parents = head.parents.slice();
    else if (head) parents = [head.id];
    if (pending) parents = head ? [head.id, pending.theirs] : [pending.theirs];

    var tree = applyIndexToTree(repo, amend && head ? head.tree : headTree(repo));
    var commit = createCommit(repo, {
      message: message,
      parents: parents,
      tree: tree,
      branch: repo.HEAD.detached ? 'HEAD' : repo.HEAD.name,
      moveBranch: true,
      reflogAction: (amend ? 'commit (amend): ' : pending ? 'merge: ' : 'commit: ') + message
    });

    repo.index = {};
    repo.pendingMerge = null;

    var out = [];
    var label = repo.HEAD.detached ? 'detached HEAD' : repo.HEAD.name;
    if (pending) out.push('[' + label + ' ' + shortId(commit.id) + '] ' + message + '  (合并提交)');
    else if (amend) out.push('[' + label + ' ' + shortId(commit.id) + '] ' + message + '  (已修正上一次提交)');
    else out.push('[' + label + ' ' + shortId(commit.id) + '] ' + message);
    out.push(' ' + Object.keys(tree).length + ' 个文件进入了这次快照');

    return {
      ok: true, lines: out,
      explain: pending
        ? '合并提交：这个提交有两个父提交，一条通往你原来的分支，一条通往被合并的分支 —— 这就是“历史分叉又合流”的样子。'
        : 'git commit 把暂存区里的内容固化成一个快照，永久留在历史里。提交说明要写清楚“这次改了什么”。'
    };
  };

  COMMANDS.log = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    return logText(repo, {
      oneline: args.indexOf('--oneline') >= 0,
      all: args.indexOf('--all') >= 0 || args.indexOf('--graph') >= 0
    });
  };

  COMMANDS.diff = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    if (args.indexOf('--staged') >= 0 || args.indexOf('--cached') >= 0) {
      var ht = headTree(repo);
      var lines = [];
      Object.keys(repo.index).forEach(function (p) {
        var before = has(ht, p) ? ht[p] : '';
        var after = repo.index[p] === null ? '' : repo.index[p];
        if (before === after) return;
        lines.push('diff --git a/' + p + ' b/' + p);
        diffLines(before, after).forEach(function (d) {
          lines.push((d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ') + d.text);
        });
      });
      if (!lines.length) lines.push('(暂存区与最后一次提交没有差异)');
      return { ok: true, lines: lines, explain: '--staged 比较的是“暂存区 vs 最后一次提交”。' };
    }
    return diffText(repo);
  };

  COMMANDS.branch = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;

    var del = args.indexOf('-d') >= 0 || args.indexOf('-D') >= 0;
    var force = args.indexOf('-D') >= 0;
    var rename = args.indexOf('-m') >= 0;
    var names = args.filter(function (a) { return a[0] !== '-'; });

    if (!args.length) {
      var out = Object.keys(repo.branches).sort(function (a, b) {
        return repo.branchOrder.indexOf(a) - repo.branchOrder.indexOf(b);
      }).map(function (b) {
        var mark = (!repo.HEAD.detached && repo.HEAD.name === b) ? '* ' : '  ';
        return mark + b;
      });
      return {
        ok: true, lines: out,
        explain: '带 * 的是你当前所在的分支。分支本质上只是一张“指向某个提交的便利贴”。'
      };
    }

    if (rename) {
      var oldName = names.length > 1 ? names[0] : repo.HEAD.name;
      var newName = names.length > 1 ? names[1] : names[0];
      if (!has(repo.branches, oldName)) {
        return { ok: false, lines: ['error: 没有名为 ' + oldName + ' 的分支'], explain: '分支名写错了。' };
      }
      repo.branches[newName] = repo.branches[oldName];
      delete repo.branches[oldName];
      if (repo.HEAD.name === oldName) repo.HEAD.name = newName;
      repo.branchOrder = repo.branchOrder.map(function (n) { return n === oldName ? newName : n; });
      return { ok: true, lines: [], explain: '分支改名了：' + oldName + ' → ' + newName + '，它指向的提交没有变。' };
    }

    if (del) {
      var target = names[0];
      if (!has(repo.branches, target)) {
        return { ok: false, lines: ['error: branch ' + target + ' not found.'], explain: '要删除的分支不存在。' };
      }
      if (!repo.HEAD.detached && repo.HEAD.name === target) {
        return {
          ok: false,
          lines: ['error: Cannot delete branch ' + target + ' checked out at ./practice'],
          explain: '你正站在这个分支上，先切到别的分支再删。'
        };
      }
      var headId = repo.HEAD.detached ? repo.HEAD.name : repo.branches[repo.HEAD.name];
      if (!force && !isAncestor(repo, repo.branches[target], headId)) {
        return {
          ok: false,
          lines: [
            'error: The branch ' + target + ' is not fully merged.',
            "If you are sure you want to delete it, run 'git branch -D " + target + "'."
          ],
          explain: '这个分支上还有没被合并的提交，直接删会丢掉它们。想强行删除用 -D。'
        };
      }
      var wasId = repo.branches[target];
      delete repo.branches[target];
      return {
        ok: true,
        lines: ['Deleted branch ' + target + ' (was ' + shortId(wasId) + ').'],
        explain: '分支被删掉了。注意：提交本身还在，只是少了一个名字指向它。'
      };
    }

    var newBranch = names[0];
    if (has(repo.branches, newBranch)) {
      return { ok: false, lines: ["fatal: a branch named '" + newBranch + "' already exists"], explain: '同名分支已经存在。' };
    }
    var head = headCommit(repo);
    var from = names[1] ? resolveRef(repo, names[1]) : (head ? head.id : null);
    if (names[1] && !from) {
      return { ok: false, lines: ['fatal: not a valid object name: ' + names[1]], explain: '指定的起点不存在。' };
    }
    repo.branches[newBranch] = from;
    repo.branchOrder.push(newBranch);
    return {
      ok: true, lines: [],
      explain: '创建了分支 ' + newBranch + '，它指向 ' + shortId(from) + '。注意：你人还留在 ' + headLabel(repo) + ' 上，只是多了一个指针。'
    };
  };

  function switchTo(repo, name, create) {
    var guard = needRepo(repo);
    if (guard) return guard;

    if (create) {
      if (has(repo.branches, name)) {
        return {
          ok: false,
          lines: ["fatal: a branch named '" + name + "' already exists"],
          explain: '同名分支已存在，直接 git switch ' + name + ' 就能切过去。'
        };
      }
      var h = headCommit(repo);
      repo.branches[name] = h ? h.id : null;
      repo.branchOrder.push(name);
      repo.HEAD = { name: name, detached: false };
      repo.index = {};
      pushReflog(repo, 'checkout: moving to ' + name, repo.branches[name]);
      return {
        ok: true, lines: ["Switched to a new branch '" + name + "'"],
        explain: '新建并切换到了分支 ' + name + '。从这一刻起的提交都会记在这个分支上，main 不受影响。'
      };
    }

    if (has(repo.branches, name)) {
      if (!repo.HEAD.detached && repo.HEAD.name === name) {
        return { ok: true, lines: ["Already on '" + name + "'"], explain: '你已经在这个分支上了。' };
      }
      var targetTree = treeOfCommit(repo, repo.branches[name]);
      var st = statusOf(repo);
      if (st.unstaged.length || st.staged.length) {
        var clash = st.unstaged.concat(st.staged).filter(function (s) {
          if (!has(targetTree, s.path)) return true;
          return targetTree[s.path] !== (has(repo.workdir, s.path) ? repo.workdir[s.path] : undefined);
        });
        if (clash.length) {
          return {
            ok: false,
            lines: [
              'error: Your local changes to the following files would be overwritten by checkout:',
              '\t' + clash.map(function (s) { return s.path; }).join('\n\t'),
              'Please commit your changes or stash them before you switch branches.'
            ],
            explain: '你还有没提交的改动，直接切分支会让它们被覆盖，Git 拦住了你。先 git commit 或 git stash 再切。'
          };
        }
      }
      repo.HEAD = { name: name, detached: false };
      repo.workdir = deepClone(targetTree);
      repo.index = {};
      repo.pendingMerge = null;
      repo.conflicts = {};
      pushReflog(repo, 'checkout: moving to ' + name, repo.branches[name]);
      return {
        ok: true, lines: ["Switched to branch '" + name + "'"],
        explain: '切换分支：Git 把工作区的文件换成该分支最后一次提交的样子。这就是为什么“切分支”能让文件夹瞬间变样。'
      };
    }

    var id = resolveRef(repo, name);
    if (id) {
      repo.HEAD = { name: id, detached: true };
      repo.workdir = deepClone(treeOfCommit(repo, id));
      repo.index = {};
      pushReflog(repo, 'checkout: moving to ' + shortId(id), id);
      return {
        ok: true,
        lines: ['Note: switching to ' + shortId(id) + '.', '', 'You are in "detached HEAD" state.'],
        explain: '你现在处于“分离头指针”状态：HEAD 直接指向某个提交，而不是某个分支。此时的新提交不属于任何分支，切走后要靠 reflog 才能找回来。'
      };
    }
    return {
      ok: false,
      lines: ["error: pathspec '" + name + "' did not match any file(s) known to git"],
      explain: '没有这个分支或提交。'
    };
  }

  COMMANDS.checkout = function (repo, args) {
    var create = args.indexOf('-b') >= 0 || args.indexOf('-B') >= 0;
    var names = args.filter(function (a) { return a[0] !== '-'; });
    if (!create && names.length && has(repo.workdir, names[0]) && !has(repo.branches, names[0])) {
      var ht = headTree(repo);
      var unmerged = names.filter(function (p) { return has(repo.conflicts, p); });
      if (unmerged.length) {
        return {
          ok: false,
          lines: [
            "error: path '" + unmerged[0] + "' is unmerged",
            '先手动把冲突解决掉（或 git checkout --ours/--theirs <文件>），再 git add。'
          ],
          explain: 'conflict 状态的文件不能用这种简单方式还原，因为 Git 不确定你想要哪一边。'
        };
      }
      names.forEach(function (p) {
        if (has(ht, p)) repo.workdir[p] = ht[p];
      });
      return {
        ok: true, lines: [],
        explain: '把工作区里这些文件恢复成最后一次提交的样子（会丢弃未提交的修改，真实环境里要小心）。'
      };
    }
    if (!names.length) return { ok: false, lines: ['fatal: missing branch name'], explain: '要写清楚切到哪个分支。' };
    return switchTo(repo, names[0], create);
  };

  COMMANDS.switch = function (repo, args) {
    var create = args.indexOf('-c') >= 0 || args.indexOf('-C') >= 0;
    var names = args.filter(function (a) { return a[0] !== '-'; });
    if (!names.length) return COMMANDS.branch(repo, []);
    return switchTo(repo, names[0], create);
  };

  COMMANDS.restore = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    var staged = args.indexOf('--staged') >= 0;
    var names = args.filter(function (a) { return a[0] !== '-'; });
    if (!names.length) return { ok: false, lines: ['fatal: you must specify path(s)'], explain: '要说明恢复哪些文件。' };
    var ht = headTree(repo);
    names.forEach(function (p) {
      if (staged) {
        if (has(ht, p)) repo.index[p] = ht[p];
        else delete repo.index[p];
      } else if (has(ht, p)) {
        repo.workdir[p] = ht[p];
      }
    });
    return {
      ok: true, lines: [],
      explain: staged
        ? '--staged 把文件从暂存区拿出来（改动还留在工作区），也就是“取消暂存”。'
        : '把工作区文件恢复到已提交的样子。'
    };
  };

  COMMANDS.rm = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    var names = args.filter(function (a) { return a[0] !== '-'; });
    if (!names.length) return { ok: false, lines: ['fatal: pathspec is required'], explain: '要指定删除哪个文件。' };
    names.forEach(function (p) {
      delete repo.workdir[p];
      repo.index[p] = null;
    });
    return {
      ok: true,
      lines: names.map(function (p) { return "rm '" + p + "'"; }),
      explain: 'git rm 同时做了两件事：删除工作区文件，并把“删除”这件事放进暂存区。'
    };
  };

  COMMANDS.merge = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    var raw = args.filter(function (a) { return a[0] !== '-'; });
    if (!raw.length) {
      return { ok: false, lines: ['fatal: specify a branch to merge'], explain: '要说明把哪个分支合并进来，例如 git merge feature/login。' };
    }
    if (Object.keys(repo.conflicts).length) {
      return {
        ok: false,
        lines: ['error: You have not concluded your merge (MERGE_HEAD exists).'],
        explain: '上一次合并还没收尾，先解决冲突并提交。'
      };
    }

    var label = raw[0];
    var otherId = resolveRef(repo, label);
    if (!otherId) {
      return { ok: false, lines: ['merge: ' + label + ' - not something we can merge'], explain: '找不到这个分支或提交。' };
    }
    var head = headCommit(repo);
    if (!head) {
      repo.branches[repo.HEAD.name] = otherId;
      repo.workdir = deepClone(treeOfCommit(repo, otherId));
      return { ok: true, lines: ['Fast-forward'], explain: '当前分支还没有提交，直接把指针指到对方分支即可。' };
    }
    if (otherId === head.id || isAncestor(repo, otherId, head.id)) {
      return { ok: true, lines: ['Already up to date.'], explain: label + ' 上的内容已经在你当前分支里了，不需要合并。' };
    }

    if (isAncestor(repo, head.id, otherId)) {
      var ffTree = treeOfCommit(repo, otherId);
      repo.branches[repo.HEAD.name] = otherId;
      repo.workdir = deepClone(ffTree);
      repo.index = {};
      pushReflog(repo, 'merge ' + label + ': Fast-forward', otherId);
      return {
        ok: true,
        lines: [
          'Updating ' + shortId(head.id) + '..' + shortId(otherId),
          'Fast-forward',
          ' ' + Object.keys(ffTree).length + ' 个文件被更新'
        ],
        explain: '快进合并（Fast-forward）：你当前分支没有任何“对方没有的新提交”，所以 Git 只是把分支指针往前挪一格，不会产生合并提交。'
      };
    }

    var baseId = mergeBase(repo, head.id, otherId);
    var result = threeWayMerge(repo, treeOfCommit(repo, baseId), head.tree, treeOfCommit(repo, otherId));
    var conflictPaths = Object.keys(result.conflicts);

    if (conflictPaths.length) {
      repo.workdir = deepClone(result.merged);
      repo.conflicts = {};
      conflictPaths.forEach(function (p) {
        repo.workdir[p] = conflictContent(
          result.conflicts[p].ours, result.conflicts[p].theirs,
          'HEAD (' + headLabel(repo) + ')', label
        );
        repo.conflicts[p] = result.conflicts[p];
      });
      repo.index = {};
      repo.pendingMerge = { label: label, theirs: otherId };
      return {
        ok: false,
        lines: [
          'Auto-merging ' + conflictPaths.join(' '),
          'CONFLICT (content): Merge conflict in ' + conflictPaths.join(', '),
          'Automatic merge failed; fix conflicts and then commit the result.'
        ],
        explain: '两边都改了同一个文件，Git 不知道该听谁的，于是把两种写法都塞进文件里，用 <<<<<<< ======= >>>>>>> 标出来，等你做决定。这就是“冲突”。'
      };
    }

    repo.workdir = deepClone(result.merged);
    repo.index = {};
    var mergeCommit = createCommit(repo, {
      message: "Merge branch '" + label + "'",
      parents: [head.id, otherId],
      tree: result.merged,
      branch: repo.HEAD.name,
      moveBranch: true,
      reflogAction: 'merge ' + label + ': Merge made by the ort strategy'
    });
    return {
      ok: true,
      lines: [
        'Merge made by the ort strategy.',
        '[' + repo.HEAD.name + ' ' + shortId(mergeCommit.id) + "] Merge branch '" + label + "'"
      ],
      explain: '自动合并成功：Git 发现双方改的是不同的地方，于是把两份改动拼在一起，并生成一个有两个父提交的“合并提交”。'
    };
  };

  COMMANDS.rebase = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    if (repo.HEAD.detached) {
      return { ok: false, lines: ['fatal: 请先切到一个分支上再 rebase'], explain: '分离头指针状态下不要 rebase。' };
    }
    var raw = args.filter(function (a) { return a[0] !== '-'; });
    if (!raw.length) {
      return { ok: false, lines: ['fatal: 要指定目标分支，例如 git rebase main'], explain: 'rebase 需要告诉它“搬到哪条基准上去”。' };
    }
    var targetId = resolveRef(repo, raw[0]);
    if (!targetId) return { ok: false, lines: ['fatal: invalid upstream ' + raw[0]], explain: '目标分支不存在。' };
    var head = headCommit(repo);
    if (!head) return { ok: false, lines: ['fatal: 当前分支还没有提交'], explain: '先提交点东西再 rebase。' };
    if (isAncestor(repo, targetId, head.id) && targetId !== head.id) {
      return { ok: false, lines: ['Current branch ' + repo.HEAD.name + ' is up to date.'], explain: raw[0] + ' 已经在你的历史里了，没什么可搬的。' };
    }

    var baseId = mergeBase(repo, head.id, targetId);
    var replay = [];
    (function walk(id) {
      if (!id || id === baseId) return;
      var c = repo.commits[id];
      walk(c.parents[0]);
      replay.push(c);
    })(head.id);

    if (!replay.length) {
      return { ok: false, lines: ['Current branch ' + repo.HEAD.name + ' is up to date.'], explain: '没有需要搬移的提交。' };
    }

    var cursorTree = deepClone(treeOfCommit(repo, targetId));
    var cursorId = targetId;
    var newIds = [];
    for (var i = 0; i < replay.length; i++) {
      var c = replay[i];
      var applied = applyDelta(treeOfCommit(repo, c.parents[0]), c.tree, cursorTree);
      if (applied.conflicts.length) {
        return {
          ok: false,
          lines: [
            'CONFLICT (content): Merge conflict in ' + applied.conflicts.join(', '),
            'error: could not apply ' + shortId(c.id) + ' ' + c.msg,
            'hint: 练习站已自动回滚，仓库保持原样。'
          ],
          explain: 'rebase 是把你的提交“一个个重新播放”到新基准上，播放时撞车同样会冲突。练习站为了简单，遇到冲突就直接回滚，你可以先用 merge 练习冲突处理。'
        };
      }
      cursorTree = applied.tree;
      var newCommit = {
        id: makeSha(repo, c.msg + '|rebase'),
        msg: c.msg,
        parents: [cursorId],
        tree: deepClone(cursorTree),
        time: repo.clock++,
        branch: repo.HEAD.name,
        author: c.author
      };
      repo.commits[newCommit.id] = newCommit;
      cursorId = newCommit.id;
      newIds.push(newCommit.id);
    }

    repo.branches[repo.HEAD.name] = cursorId;
    repo.workdir = deepClone(cursorTree);
    repo.index = {};
    repo.stats.rebases++;
    pushReflog(repo, 'rebase finished', cursorId);
    return {
      ok: true,
      lines: [
        'Successfully rebased and updated refs/heads/' + repo.HEAD.name + '.',
        '重放了 ' + newIds.length + ' 个提交：' + newIds.map(shortId).join(' → ')
      ],
      explain: 'rebase 把你的提交复制一份、换个“爹”，重新接到目标分支后面。历史因此变成一条直线，代价是提交号全变了 —— 这就是它和 merge 最大的区别。'
    };
  };

  COMMANDS.tag = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    var names = args.filter(function (a) { return a[0] !== '-'; });
    if (!names.length) {
      var list = Object.keys(repo.tags);
      return {
        ok: true, lines: list,
        explain: list.length ? '这里是所有标签。' : '还没有标签。标签用来给某个提交起一个人话名字，比如 v1.0。'
      };
    }
    var name = names[0];
    if (has(repo.tags, name)) return { ok: false, lines: ["fatal: tag '" + name + "' already exists"], explain: '同名标签已存在。' };
    var target = names[1] ? resolveRef(repo, names[1]) : (headCommit(repo) ? headCommit(repo).id : null);
    if (!target) {
      return { ok: false, lines: ["fatal: Failed to resolve '" + (names[1] || 'HEAD') + "' as a valid ref."], explain: '没有可打标签的提交。' };
    }
    repo.tags[name] = target;
    return { ok: true, lines: [], explain: '创建标签 ' + name + ' → ' + shortId(target) + '。标签是给某个提交起的名字，常用于标记版本。' };
  };

  COMMANDS.stash = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;

    if (Object.keys(repo.conflicts).length) {
      return {
        ok: false,
        lines: ['error: 有未解决的冲突，无法 stash'],
        explain: '冲突还没解决时不能把改动收进 stash。先在编辑器里改好文件、删掉 <<<<<<< 标记，git add 之后再继续。'
      };
    }

    if (args[0] === 'pop' || args[0] === 'apply') {
      if (!repo.stash.length) return { ok: false, lines: ['No stash entries found.'], explain: '贮藏栈是空的。' };
      var entry = repo.stash[0];
      Object.keys(entry.files).forEach(function (p) { repo.workdir[p] = entry.files[p]; });
      repo.index = deepClone(entry.index);
      if (args[0] === 'pop') repo.stash.shift();
      return {
        ok: true,
        lines: ['On branch ' + headLabel(repo), 'Changes restored from stash'],
        explain: '把之前收起来的改动重新铺回工作区。'
      };
    }
    if (args[0] === 'list') {
      return {
        ok: true,
        lines: repo.stash.map(function (s, i) { return 'stash@{' + i + '}: ' + s.message; }),
        explain: repo.stash.length ? '这是你收起来的改动列表。' : '还没有任何贮藏。'
      };
    }
    if (args[0] === 'drop') {
      if (!repo.stash.length) return { ok: false, lines: ['No stash entries found.'], explain: '' };
      repo.stash.shift();
      return { ok: true, lines: ['Dropped refs/stash@{0}'], explain: '丢弃了一份贮藏。' };
    }

    var ht = headTree(repo);
    var files = {};
    Object.keys(repo.workdir).forEach(function (p) {
      if (!has(ht, p) || ht[p] !== repo.workdir[p]) files[p] = repo.workdir[p];
    });
    if (!Object.keys(files).length && !Object.keys(repo.index).length) {
      return { ok: false, lines: ['No local changes to save'], explain: '工作区是干净的，没什么可收。' };
    }
    var head = headCommit(repo);
    repo.stash.unshift({
      message: 'WIP on ' + headLabel(repo) + ': ' + shortId(head ? head.id : '') + ' ' + String(files[Object.keys(files)[0]] || '').slice(0, 20),
      files: files,
      index: deepClone(repo.index)
    });
    repo.workdir = deepClone(ht);
    repo.index = {};
    repo.stats.stashes++;
    return {
      ok: true,
      lines: ['Saved working directory and index state WIP on ' + headLabel(repo)],
      explain: 'git stash 把没提交的改动打包收进一个小抽屉，工作区瞬间变干净 —— 常用来临时切分支救火。用完 git stash pop 取回来。'
    };
  };

  COMMANDS.reset = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    var mode = args.indexOf('--hard') >= 0 ? 'hard' : args.indexOf('--soft') >= 0 ? 'soft' : 'mixed';
    var names = args.filter(function (a) { return a[0] !== '-'; });
    if (!names.length) {
      return { ok: false, lines: ['fatal: 请指定要回到哪个提交，例如 git reset --hard HEAD~1'], explain: 'reset 需要目标。' };
    }
    var targetId = resolveRef(repo, names[0]);
    if (!targetId) {
      return { ok: false, lines: ["fatal: ambiguous argument '" + names[0] + "': unknown revision"], explain: '找不到这个提交。' };
    }
    var prevHead = headCommit(repo);
    var prevTree = prevHead ? prevHead.tree : {};

    if (repo.HEAD.detached) repo.HEAD.name = targetId;
    else repo.branches[repo.HEAD.name] = targetId;
    repo.pendingMerge = null;
    repo.conflicts = {};
    repo.stats.resets++;

    var targetTree = treeOfCommit(repo, targetId);
    if (mode === 'hard') {
      repo.workdir = deepClone(targetTree);
      repo.index = {};
    } else if (mode === 'soft') {
      repo.index = Object.assign(deepClone(prevTree), repo.index);
    } else {
      repo.index = {};
    }
    pushReflog(repo, 'reset: moving to ' + names[0], targetId);
    var tc = repo.commits[targetId];
    return {
      ok: true,
      lines: ['HEAD is now at ' + shortId(targetId) + ' ' + (tc ? tc.msg : '')],
      explain: mode === 'hard'
        ? '--hard：分支指针、暂存区、工作区一起回退，那些提交看起来像没发生过（但还能靠 reflog 找回来）。'
        : mode === 'soft'
          ? '--soft：只挪动分支指针，改动全部留在暂存区，重新 commit 就能做一个新的提交。'
          : '默认（mixed）：挪动指针并清空暂存区，改动留在工作区里等你重新 add。'
    };
  };

  COMMANDS.reflog = function (repo) {
    var guard = needRepo(repo);
    if (guard) return guard;
    if (!repo.reflog.length) return { ok: true, lines: ['(还没有任何记录)'], explain: 'reflog 记录 HEAD 的每一次移动。' };
    return {
      ok: true,
      lines: repo.reflog.slice(0, 20).map(function (r, i) {
        return shortId(r.id) + ' HEAD@{' + i + '}: ' + r.action;
      }),
      explain: 'reflog 是“后悔药清单”，记录 HEAD 走过的每一步。误 reset、误删分支以后，靠它能找回提交号。'
    };
  };

  COMMANDS.remote = function (repo, args) {
    var sub = args[0];
    if (sub === 'add') {
      var name = args[1], url = args[2];
      if (!name || !url) {
        return { ok: false, lines: ['usage: git remote add <name> <url>'], explain: '写法：git remote add origin https://github.com/你的名字/仓库.git' };
      }
      if (has(repo.remotes, name)) return { ok: false, lines: ['error: remote ' + name + ' already exists.'], explain: '这个名字的远程已经加过了。' };
      repo.remotes[name] = { url: url, branches: {} };
      return {
        ok: true, lines: [],
        explain: '给远程仓库起了个名字（习惯叫 origin），并记下它的地址。远程就是你放在 GitHub 上的那份副本。'
      };
    }
    if (sub === '-v' || sub === 'v') {
      var out = [];
      Object.keys(repo.remotes).forEach(function (r) {
        out.push(r + '\t' + repo.remotes[r].url + ' (fetch)');
        out.push(r + '\t' + repo.remotes[r].url + ' (push)');
      });
      return { ok: true, lines: out, explain: out.length ? '这是你配置的远程仓库。' : '还没配置远程仓库。' };
    }
    var names = Object.keys(repo.remotes);
    return {
      ok: true, lines: names,
      explain: names.length ? '当前配置的远程名字。' : '还没配置远程仓库，用 git remote add origin <地址> 添加。'
    };
  };

  COMMANDS.push = function (repo, args) {
    var guard = needRepo(repo);
    if (guard) return guard;
    var names = args.filter(function (a) { return a[0] !== '-'; });
    var remoteName = names[0] || Object.keys(repo.remotes)[0] || 'origin';
    var branchName = names[1] || (repo.HEAD.detached ? null : repo.HEAD.name);

    if (!has(repo.remotes, remoteName)) {
      return {
        ok: false,
        lines: ["fatal: '" + remoteName + "' does not appear to be a git repository"],
        explain: '还没有配置这个远程仓库，先 git remote add origin <地址>。'
      };
    }
    if (!branchName) return { ok: false, lines: ['fatal: 请指定要推送的分支'], explain: '分离头指针状态下要写清楚分支名。' };
    var localId = repo.branches[branchName];
    if (!localId) {
      return { ok: false, lines: ['error: src refspec ' + branchName + ' does not match any'], explain: '本地没有这个分支，或者它还没有提交。' };
    }

    var remote = repo.remotes[remoteName];
    var remoteId = remote.branches[branchName];
    if (remoteId && remoteId !== localId && !isAncestor(repo, remoteId, localId)) {
      return {
        ok: false,
        lines: [
          ' ! [rejected]        ' + branchName + ' -> ' + branchName + ' (non-fast-forward)',
          'error: failed to push some refs to ' + remote.url
        ],
        explain: '被拒绝了：远程上有你本地没有的提交（队友先推了）。要先 git pull 把对方的提交合并进来，再 push。'
      };
    }

    var isNew = !remoteId;
    remote.branches[branchName] = localId;
    if (!repo.upstream) repo.upstream = { remote: remoteName, branch: branchName };
    repo.stats.pushes++;
    return {
      ok: true,
      lines: [
        'To ' + remote.url,
        isNew
          ? ' * [new branch]      ' + branchName + ' -> ' + branchName
          : '   ' + shortId(remoteId) + '..' + shortId(localId) + '  ' + branchName + ' -> ' + branchName
      ],
      explain: isNew
        ? '第一次推送：本地分支在 GitHub 上被创建出来了，别人从此能看到你的提交。'
        : '推送成功：把你本地多出来的提交同步到 GitHub。推送 = 本地提交 → 远程仓库。'
    };
  };

  COMMANDS.fetch = function (repo) {
    var guard = needRepo(repo);
    if (guard) return guard;
    var names = Object.keys(repo.remotes);
    if (!names.length) return { ok: false, lines: ['fatal: No remote repository specified.'], explain: '先配置远程仓库。' };
    var remoteName = names[0];
    var branch = repo.HEAD.detached ? 'main' : repo.HEAD.name;
    var remoteId = repo.remotes[remoteName].branches[branch];
    var localId = repo.branches[branch];
    var different = remoteId && remoteId !== localId;
    return {
      ok: true,
      lines: ['From ' + repo.remotes[remoteName].url, ' * branch            ' + branch + '     -> ' + remoteName + '/' + branch],
      explain: different
        ? 'git fetch 只把远程的最新版“下载”到本地的远程跟踪分支原' + remoteName + '/' + branch + '，不会动你的工作区和当前分支。想合并进来，再执行 git merge ' + remoteName + '/' + branch + ' 或 git pull。'
        : 'fetch 完成。远程跟踪分支 ' + remoteName + '/' + branch + ' 已经和本地一致，没有新东西。'
    };
  };

  COMMANDS.pull = function (repo) {
    var guard = needRepo(repo);
    if (guard) return guard;
    var names = Object.keys(repo.remotes);
    if (!names.length) return { ok: false, lines: ['fatal: No remote repository specified.'], explain: '先配置远程仓库。' };
    var remoteName = names[0];
    var branchName = repo.HEAD.detached ? 'main' : repo.HEAD.name;
    var remoteId = repo.remotes[remoteName].branches[branchName];
    var localId = repo.branches[branchName];
    repo.stats.pulls++;

    if (!remoteId || remoteId === localId) {
      return { ok: true, lines: ['Already up to date.'], explain: '本地和远程一样新，没什么可拉的。' };
    }
    if (!localId) {
      repo.branches[branchName] = remoteId;
      repo.workdir = deepClone(treeOfCommit(repo, remoteId));
      return { ok: true, lines: ['Fast-forward'], explain: '把远程的提交直接拉到了本地。' };
    }
    if (isAncestor(repo, localId, remoteId)) {
      repo.branches[branchName] = remoteId;
      repo.workdir = deepClone(treeOfCommit(repo, remoteId));
      repo.index = {};
      return {
        ok: true,
        lines: ['Updating ' + shortId(localId) + '..' + shortId(remoteId), 'Fast-forward'],
        explain: 'pull = fetch + merge。这次是快进，直接把你的分支指针挪到远程最新提交上。'
      };
    }

    var baseId = mergeBase(repo, localId, remoteId);
    var result = threeWayMerge(repo, treeOfCommit(repo, baseId), treeOfCommit(repo, localId), treeOfCommit(repo, remoteId));
    var conflictPaths = Object.keys(result.conflicts);
    if (conflictPaths.length) {
      repo.workdir = deepClone(result.merged);
      conflictPaths.forEach(function (p) {
        repo.workdir[p] = conflictContent(
          result.conflicts[p].ours, result.conflicts[p].theirs,
          'HEAD (' + branchName + ')', remoteName + '/' + branchName
        );
        repo.conflicts[p] = result.conflicts[p];
      });
      repo.index = {};
      repo.pendingMerge = { label: remoteName + '/' + branchName, theirs: remoteId };
      return {
        ok: false,
        lines: [
          'CONFLICT (content): Merge conflict in ' + conflictPaths.join(', '),
          'Automatic merge failed; fix conflicts and then commit the result.'
        ],
        explain: 'pull 之后发现你和队友改了同一处地方，于是产生了冲突。解决方式和普通 merge 冲突一样：改文件 → git add → git commit。'
      };
    }
    repo.branches[branchName] = remoteId;
    repo.workdir = deepClone(result.merged);
    repo.index = {};
    return {
      ok: true,
      lines: [
        'Merge made by the ort strategy.',
        '本地 ' + shortId(localId) + ' 与 ' + remoteName + '/' + branchName + ' ' + shortId(remoteId) + ' 合并完成'
      ],
      explain: 'pull 帮你把远程的改动合并进当前分支，并自动生成了一个合并提交。'
    };
  };

  COMMANDS.help = function () {
    return {
      ok: true,
      lines: [
        '本练习站支持的 git 命令：',
        '  init / status / add <文件|.> / rm <文件>',
        '  commit -m "说明" / commit --amend / log [--oneline] [--all] / diff [--staged]',
        '  branch [名称] [-d|-D] [-m] / switch <名称> [-c] / checkout <分支|提交|文件> [-b]',
        '  merge <分支> / rebase <分支> / tag <名称> / stash [pop|list|drop]',
        '  reset [--hard|--soft] <提交> / reflog / restore [--staged] <文件>',
        '  remote add <名字> <地址> / remote -v / push <远程> <分支> / fetch / pull',
        '',
        '辅助命令：help（看这份说明）、clear（清屏）、ls（看工作区文件）',
        '引用写法：HEAD、HEAD~1、HEAD~2、main、分支名、标签名、前几位提交号'
      ],
      explain: '遇到不认识的命令就输入 help。真实 Git 的命令远不止这些，但日常 90% 的操作都在这几十个里。'
    };
  };

  COMMANDS.clear = function () {
    return { ok: true, lines: [], explain: '', clear: true };
  };

  /* ============================================================ 命令分发 */

  function runGit(repo, toks) {
    var sub = toks[0];
    if (!sub) return COMMANDS.help(repo);
    if (sub === '--version') return { ok: true, lines: ['git version 2.52.0 (练习站模拟版)'], explain: '' };
    var handler = COMMANDS[sub];
    if (!handler) {
      return {
        ok: false,
        lines: ["git: '" + sub + "' is not a git command. See 'git --help'."],
        explain: '练习站没有实现这个命令。输入 help 看看有哪些命令可以练。'
      };
    }
    var result = handler(repo, toks.slice(1)) || { ok: true, lines: [], explain: '' };
    result.kind = sub;
    return result;
  }

  function run(repo, raw) {
    var line = String(raw == null ? '' : raw).trim();
    if (!line) return { ok: true, lines: [], explain: '', kind: 'noop' };

    var toks = tokenize(line);
    if (toks[0] === 'git') return runGit(repo, toks.slice(1));
    if (toks[0] === 'help' || toks[0] === '?') return COMMANDS.help(repo);
    if (toks[0] === 'clear' || toks[0] === 'cls') return COMMANDS.clear(repo);
    if (toks[0] === 'ls') {
      return { ok: true, lines: Object.keys(repo.workdir), explain: '列出工作区里的文件。', kind: 'ls' };
    }
    if (toks[0] === 'touch' || toks[0] === 'new') {
      var p = toks[1];
      if (!p) return { ok: false, lines: ['用法：touch <文件名>'], explain: '给个文件名。', kind: 'touch' };
      if (has(repo.workdir, p)) {
        return { ok: true, lines: ['(文件已存在)'], explain: p + ' 已经在了，直接在文件列表里点它编辑。', kind: 'touch' };
      }
      repo.workdir[p] = '';
      return { ok: true, lines: [], explain: '新建了空文件 ' + p + '，点文件列表里的它可以编辑内容。', kind: 'touch' };
    }
    return {
      ok: false,
      lines: ['练习站不认识这个命令。'],
      explain: '所有命令都要以 git 开头，比如 git status。输入 help 查看支持列表。',
      kind: 'unknown'
    };
  }

  /* 模拟“队友往 GitHub 推了一个提交” */
  function teammatePush(repo, message) {
    if (!repo.initialized) {
      return { ok: false, lines: ['请先 git init 并完成第一次提交。'], explain: '还没有仓库。' };
    }
    var remoteName = Object.keys(repo.remotes)[0];
    if (!remoteName) {
      return { ok: false, lines: ['还没有配置远程仓库，先执行 git remote add origin <地址>。'], explain: '先在远程面板里添加 origin。' };
    }
    var remote = repo.remotes[remoteName];
    var branch = repo.upstream ? repo.upstream.branch : (repo.HEAD.detached ? 'main' : repo.HEAD.name);
    var tip = remote.branches[branch] || repo.branches[branch] || null;
    var tree = tip ? deepClone(treeOfCommit(repo, tip)) : deepClone(headTree(repo));
    tree['docs/notes.md'] = (tree['docs/notes.md'] || '') + '\n- 队友在 GitHub 上补了一条笔记\n';

    var id = makeSha(repo, message);
    repo.commits[id] = {
      id: id,
      msg: message,
      parents: tip ? [tip] : [],
      tree: tree,
      time: repo.clock++,
      branch: remoteName + '/' + branch,
      author: '队友'
    };
    remote.branches[branch] = id;
    return {
      ok: true,
      lines: [remoteName + '/' + branch + ' 上出现了一个新提交：' + shortId(id) + ' ' + message],
      explain: '队友把他本地的提交推送到了 GitHub，现在远程比你的本地更新。接下来试试 git fetch 或 git pull。'
    };
  }

  global.GitSim = {
    createRepo: createRepo,
    seedFiles: seedFiles,
    freshRepo: freshRepo,
    run: run,
    statusOf: statusOf,
    isDirty: isDirty,
    headCommit: headCommit,
    headLabel: headLabel,
    headTree: headTree,
    treeOfCommit: treeOfCommit,
    resolveRef: resolveRef,
    ancestors: ancestors,
    isAncestor: isAncestor,
    mergeBase: mergeBase,
    graphLayout: graphLayout,
    reachableCommits: reachableCommits,
    diffLines: diffLines,
    teammatePush: teammatePush,
    deepClone: deepClone,
    shortId: shortId,
    help: function (repo) { return COMMANDS.help(repo); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
