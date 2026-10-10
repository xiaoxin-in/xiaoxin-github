/*!
 * tasks.js —— 练习关卡定义
 * 每个关卡包含：标题、说明、提示、示例命令，以及一段“判定是否通关”的检查函数。
 * check(ctx) 里的 ctx = { repo: 当前仓库状态, used: 命令使用次数 }
 */
(function (global) {
  'use strict';

  function commitCount(repo) {
    return global.GitSim ? global.GitSim.reachableCommits(repo).length : Object.keys(repo.commits).length;
  }

  function mergeCommits(repo) {
    return Object.keys(repo.commits).filter(function (id) {
      return repo.commits[id].parents.length > 1;
    });
  }

  function branchTips(repo) {
    return Object.keys(repo.branches).map(function (name) {
      return { name: name, tip: repo.branches[name] };
    });
  }

  function hasBranchWithOwnCommit(repo) {
    return branchTips(repo).some(function (b) {
      if (b.name === 'main' || !b.tip) return false;
      var c = repo.commits[b.tip];
      return !!c && c.branch === b.name;
    });
  }

  global.GIT_TASKS = [
    {
      id: 'init',
      group: '基础',
      title: '把目录变成仓库',
      desc: '执行 git init，让这个文件夹从此被 Git 管起来。',
      hint: '初始化完成后，左侧“仓库”面板里会出现 main 分支。',
      example: 'git init',
      check: function (ctx) { return ctx.repo.initialized === true; }
    },
    {
      id: 'first-commit',
      group: '基础',
      title: '完成第一次提交',
      desc: '把已有的文件加入暂存区，再提交一次，留下历史里的第一个快照。',
      hint: '先 git add . 把所有文件放进暂存区，再 git commit -m "初始提交"。',
      example: 'git add .',
      check: function (ctx) { return commitCount(ctx.repo) >= 1; }
    },
    {
      id: 'edit-loop',
      group: '基础',
      title: '走一遍“修改 → 提交”的循环',
      desc: '点击左侧文件编辑内容，保存后 add 再 commit，凑够 2 个提交。',
      hint: '点文件名可以像记事本一样改内容。改完 → 保存 → git add <文件名> → git commit -m "说明"。',
      example: 'git commit -m "更新说明"',
      check: function (ctx) { return commitCount(ctx.repo) >= 2; }
    },
    {
      id: 'inspect',
      group: '基础',
      title: '学会看状态和差异',
      desc: '用 git status 看当前状态，用 git diff 看具体改了哪几行。',
      hint: '先随便改一个文件（别提交），然后 git status、git diff 各来一次。',
      example: 'git diff',
      check: function (ctx) { return !!ctx.used.status && !!ctx.used.diff; }
    },
    {
      id: 'branch',
      group: '分支',
      title: '开一条新分支',
      desc: '创建并切换到新分支，然后在上面做一次属于自己的提交。',
      hint: 'git switch -c feature/hello 创建并切换；提交后左侧“仓库”面板会多出一个分支。',
      example: 'git switch -c feature/hello',
      check: function (ctx) { return hasBranchWithOwnCommit(ctx.repo); }
    },
    {
      id: 'merge',
      group: '分支',
      title: '把分支合并回来',
      desc: '切回 main，把刚才那条分支合并进来，观察提交图上多条线汇聚。',
      hint: 'git switch main 之后 git merge feature/hello。如果 main 自己也有新提交，就会生成一个合并提交。',
      example: 'git merge feature/hello',
      check: function (ctx) { return mergeCommits(ctx.repo).length >= 1; }
    },
    {
      id: 'conflict',
      group: '分支',
      title: '制造并解决一次冲突',
      desc: '让两条分支改同一个文件的同一处，合并时就会冲突；解决它，再提交。',
      hint: '在 feature 分支改 README.md 并提交 → 切回 main 改 README.md 同一处并提交 → git merge。出现 <<<<<<< 后改文件、git add、git commit。',
      example: 'git merge feature/hello',
      check: function (ctx) { return ctx.repo.stats.conflictsResolved >= 1; }
    },
    {
      id: 'tag',
      group: '分支',
      title: '给提交起个名字',
      desc: '打一个 v1.0 标签，把当前提交标记成一个版本。',
      hint: 'git tag v1.0 —— 标签就是贴在某个提交上的便利贴。',
      example: 'git tag v1.0',
      check: function (ctx) { return Object.keys(ctx.repo.tags).length >= 1; }
    },
    {
      id: 'remote',
      group: '协作',
      title: '连接一个远程仓库',
      desc: '添加 GitHub 远程仓库，名字叫 origin。',
      hint: '右侧“远程仓库”面板里可以直接填地址添加，也可以敲 git remote add origin https://github.com/你的名字/仓库.git。',
      example: 'git remote add origin https://github.com/yourname/git-exercise.git',
      check: function (ctx) { return !!ctx.repo.remotes.origin; }
    },
    {
      id: 'push',
      group: '协作',
      title: '把提交推送到 GitHub',
      desc: '执行 git push，让远程分支和你本地一样。',
      hint: '首次推送要写清楚远程和分支：git push origin main。',
      example: 'git push origin main',
      check: function (ctx) {
        var origin = ctx.repo.remotes.origin;
        return !!origin && origin.branches.main === ctx.repo.branches.main && !!origin.branches.main;
      }
    },
    {
      id: 'pull',
      group: '协作',
      title: '把队友的改动拉下来',
      desc: '点“模拟队友提交”让远程多一个提交，再用 git pull 同步到本地。',
      hint: 'git fetch 只看不动，git pull = fetch + merge，会真的把改动并进你的分支。',
      example: 'git pull',
      check: function (ctx) {
        var origin = ctx.repo.remotes.origin;
        if (!origin || !origin.branches.main) return false;
        var local = ctx.repo.branches.main;
        return ctx.repo.stats.pulls >= 1 && !!local && Git_isAncestor(ctx.repo, origin.branches.main, local);
      }
    },
    {
      id: 'undo',
      group: '进阶',
      title: '用 reset 回退，再用 reflog 找回',
      desc: '做一个提交，用 git reset --hard HEAD~1 撤掉它，然后从 reflog 里把提交号找出来。',
      hint: 'git log --oneline 记下提交号 → git reset --hard HEAD~1 回退 → git reflog 或 git checkout <提交号> 找回来。',
      example: 'git reset --hard HEAD~1',
      check: function (ctx) { return ctx.repo.stats.resets >= 1; }
    },
    {
      id: 'stash',
      group: '进阶',
      title: '收起草稿再切分支',
      desc: '改点东西先别提交，用 git stash 收起来，工作区变干净后再 git stash pop 取回来。',
      hint: 'stash 是“小抽屉”：改到一半要救火切分支时特别有用。',
      example: 'git stash',
      check: function (ctx) { return ctx.repo.stats.stashes >= 1; }
    },
    {
      id: 'rebase',
      group: '进阶',
      title: '体验一次 rebase',
      desc: '在分支上做几个提交，然后 git rebase main，把历史拉成一条直线。',
      hint: 'rebase 会重写提交号。对比一下 rebase 前后提交图的变化。',
      example: 'git rebase main',
      check: function (ctx) { return ctx.repo.stats.rebases >= 1; }
    }
  ];

  /* tasks.js 通过一层包装调用引擎里的祖先判断，避免两处实现不一致 */
  function Git_isAncestor(repo, ancestor, id) {
    return !!(global.GitSim && global.GitSim.isAncestor(repo, ancestor, id));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
