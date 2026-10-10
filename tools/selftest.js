/*!
 * selftest.js —— 用 Node 把 Git 模拟引擎的完整流程跑一遍
 * 用法：node tools/selftest.js
 */
const fs = require('fs');
const path = require('path');

const enginePath = path.join(__dirname, '..', 'assets', 'git-engine.js');
eval(fs.readFileSync(enginePath, 'utf8'));

const GitSim = globalThis.GitSim;
let failures = 0;

function check(label, condition, extra) {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log('[' + mark + '] ' + label + (extra ? '  → ' + extra : ''));
}

function run(repo, command) {
  const result = GitSim.run(repo, command);
  const head = (result.lines || []).join('\n').split('\n')[0] || '';
  console.log('  $ ' + command + '   ' + (result.ok ? '' : '[失败] ') + head);
  return result;
}

console.log('=== 1. init / add / commit ===');
let repo = GitSim.freshRepo();
check('初始状态不是仓库', repo.initialized === false);
check('status 在 init 前报错', run(repo, 'git status').ok === false);
run(repo, 'git init');
check('init 后分支是 main', repo.branches.main === null);
check('第一次 commit 应该失败', run(repo, 'git commit -m "空提交"').ok === false);
run(repo, 'git add .');
check('暂存区有 3 个文件', Object.keys(repo.index).length === 3);
run(repo, 'git commit -m "初始提交"');
check('产生了第一个提交', Object.keys(repo.commits).length === 1);
check('HEAD 指向该提交', !!repo.branches.main);
check('工作区干净', GitSim.isDirty(repo) === false);

console.log('=== 2. 修改文件 -> add -> commit ===');
repo.workdir['README.md'] = '# 我的练习仓库\n\n第二版说明\n';
check('工作区变脏', GitSim.isDirty(repo) === true);
const diff = run(repo, 'git diff');
check('diff 有输出', diff.lines.some((l) => l.startsWith('+第二版说明')));
run(repo, 'git add README.md');
run(repo, 'git commit -m "更新说明"');
check('有 2 个提交', Object.keys(repo.commits).length === 2);

console.log('=== 2b. -am 与 --amend ===');
repo.workdir['practice-marker.txt'] = '这是用 touch 建的新文件\n';
repo.workdir['README.md'] += '\n追加一行\n';
const autoCommit = run(repo, 'git commit -am "快速提交已跟踪文件的改动"');
check('-am 只提交已跟踪文件（新文件仍在未跟踪区）', autoCommit.ok === true);
check('新文件还没被跟踪', GitSim.statusOf(repo).untracked.indexOf('practice-marker.txt') >= 0);
const lastMessage = repo.commits[repo.branches.main].msg;
run(repo, 'git commit --amend');
check('--amend 不带说明时沿用上一条说明', repo.commits[repo.branches.main].msg === lastMessage);
check('可达历史仍然是 3 个提交', GitSim.reachableCommits(repo).length === 3);

console.log('=== 3. 分支与合并 ===');
run(repo, 'git switch -c feature/login');
check('切到新分支', repo.HEAD.name === 'feature/login');
repo.workdir['src/app.js'] += '\nfunction login() { return true; }\n';
run(repo, 'git add src/app.js');
run(repo, 'git commit -m "加上登录函数"');
const beforeMerge = Object.keys(repo.commits).length;
run(repo, 'git switch main');
check('切回 main 后文件回到旧版本', repo.workdir['src/app.js'].indexOf('login') < 0);
const mergeResult = run(repo, 'git merge feature/login');
check('快进合并成功', mergeResult.ok === true && repo.commits[repo.branches.main].parents.length === 1);
check('合并后多了 1 个提交', Object.keys(repo.commits).length === beforeMerge);
check('main 上能看到登录函数', repo.workdir['src/app.js'].indexOf('login') >= 0);

console.log('=== 4. 制造并解决冲突 ===');
run(repo, 'git switch -c feature/banner');
repo.workdir['README.md'] = '# 我的练习仓库\n\n横幅：来自 feature 分支\n';
run(repo, 'git add README.md');
run(repo, 'git commit -m "feature 改 README"');
run(repo, 'git switch main');
repo.workdir['README.md'] = '# 我的练习仓库\n\n横幅：来自 main 分支\n';
run(repo, 'git add README.md');
run(repo, 'git commit -m "main 改 README"');
const conflicted = run(repo, 'git merge feature/banner');
check('合并产生冲突', conflicted.ok === false && Object.keys(repo.conflicts).length === 1);
check('工作区写入了冲突标记', repo.workdir['README.md'].indexOf('<<<<<<<') >= 0);
check('冲突时不允许提交', run(repo, 'git commit -m "x"').ok === false);
repo.workdir['README.md'] = '# 我的练习仓库\n\n横幅：两个分支都保留\n';
run(repo, 'git add README.md');
check('冲突已解决', Object.keys(repo.conflicts).length === 0);
run(repo, 'git commit -m "解决冲突"');
check('产生了合并提交（两个父提交）', repo.commits[repo.branches.main].parents.length === 2);
check('统计里记录了 1 次冲突解决', repo.stats.conflictsResolved === 1);

console.log('=== 5. 标签 / 远程 / push ===');
run(repo, 'git tag v1.0');
check('标签指向 main', repo.tags['v1.0'] === repo.branches.main);
run(repo, 'git remote add origin https://github.com/example/git-exercise.git');
check('远程已添加', !!repo.remotes.origin);
const pushResult = run(repo, 'git push origin main');
check('push 成功', pushResult.ok === true && repo.remotes.origin.branches.main === repo.branches.main);

console.log('=== 6. 队友提交 -> fetch / pull ===');
const mate = GitSim.teammatePush(repo, '队友的文档补充');
check('远程多了队友的提交', mate.ok === true && repo.remotes.origin.branches.main !== repo.branches.main);
check('本地落后于远程', GitSim.isAncestor(repo, repo.branches.main, repo.remotes.origin.branches.main));
run(repo, 'git fetch');
const pullResult = run(repo, 'git pull');
check('pull 成功（快进）', pullResult.ok === true);
check('本地已追上远程', repo.branches.main === repo.remotes.origin.branches.main);
check('工作区拿到了队友的改动', repo.workdir['docs/notes.md'].indexOf('队友') >= 0);

console.log('=== 7. push 被拒绝（分叉）===');
repo.workdir['docs/notes.md'] += '- 我本地又加了一行\n';
run(repo, 'git add docs/notes.md');
run(repo, 'git commit -m "本地新提交"');
GitSim.teammatePush(repo, '队友又提交了一条');
const rejected = run(repo, 'git push origin main');
check('push 被拒绝', rejected.ok === false);
const pullConflict = run(repo, 'git pull');
check('pull 产生冲突（双方都改了 docs/notes.md）', pullConflict.ok === false && Object.keys(repo.conflicts).length === 1);
check('冲突状态下 stash 被拒绝', run(repo, 'git stash').ok === false);
repo.workdir['docs/notes.md'] = '# 随手记\n\n- 今天学会了 git add\n- 我本地又加了一行\n- 队友在 GitHub 上补了一条笔记\n';
run(repo, 'git add docs/notes.md');
run(repo, 'git commit -m "解决 pull 冲突"');
check('pull 冲突解决后产生了合并提交', repo.commits[repo.branches.main].parents.length === 2);
check('再次 push 成功', run(repo, 'git push origin main').ok === true);

console.log('=== 8. stash 与 reset ===');
const mainBefore = repo.branches.main;
repo.workdir['README.md'] += '\n临时改动\n';
run(repo, 'git stash');
check('stash 后工作区干净', GitSim.isDirty(repo) === false);
check('仓库里有 1 条贮藏', repo.stash.length === 1);
run(repo, 'git stash pop');
check('取回后工作区又变脏', GitSim.isDirty(repo) === true);
run(repo, 'git checkout README.md');
check('恢复文件后工作区干净', GitSim.isDirty(repo) === false);

run(repo, 'git commit -m "再做一个提交"');
run(repo, 'git add README.md');
repo.workdir['README.md'] += '\n这一行要被 reset 丢掉\n';
run(repo, 'git add README.md');
run(repo, 'git commit -m "准备被撤销的提交"');
const toUndo = repo.branches.main;
run(repo, 'git reset --hard HEAD~1');
check('reset 后 HEAD 回到上一个提交', repo.branches.main !== toUndo);
check('统计里记录了 1 次 reset', repo.stats.resets === 1);
check('提交图里不再出现被撤销的提交', GitSim.reachableCommits(repo).indexOf(toUndo) < 0);
const reflog = run(repo, 'git reflog');
check('reflog 能找回被撤销的提交号', reflog.lines.join('\n').indexOf(GitSim.shortId(toUndo)) >= 0);

console.log('=== 9. rebase ===');
run(repo, 'git switch -c feature/rebase-demo');
repo.workdir['docs/notes.md'] += '- rebase 演示行\n';
run(repo, 'git add docs/notes.md');
run(repo, 'git commit -m "feature 上的提交 A"');
repo.workdir['src/app.js'] += '\n// feature 上的另一处改动\n';
run(repo, 'git add src/app.js');
run(repo, 'git commit -m "feature 上的提交 B"');
run(repo, 'git switch main');
repo.workdir['README.md'] += '\nmain 自己往前走了一步\n';
run(repo, 'git add README.md');
run(repo, 'git commit -m "main 上的新提交"');
run(repo, 'git switch feature/rebase-demo');
const rebaseResult = run(repo, 'git rebase main');
check('rebase 成功', rebaseResult.ok === true && repo.stats.rebases === 1);
check('rebase 后是线性历史', GitSim.mergeBase(repo, repo.branches.main, repo.branches['feature/rebase-demo']) === repo.branches.main);

console.log('=== 10. 提交图布局 ===');
const graph = GitSim.graphLayout(repo);
check('图里有提交节点（只画可达历史）', graph.rows.length === GitSim.reachableCommits(repo).length, graph.rows.length + ' 个节点，仓库里共 ' + Object.keys(repo.commits).length + ' 个对象');
check('每个节点都有泳道', graph.rows.every((r) => r.lane >= 0));
check('有分支泳道', graph.lanes.length >= 2, graph.lanes.map((l) => l.name).join(' / '));
check('画出了父提交连线', graph.edges.length >= graph.rows.length - 1);

console.log('');
console.log(failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌');
process.exit(failures === 0 ? 0 : 1);
