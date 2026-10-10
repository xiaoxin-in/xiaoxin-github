# Git 练习台（git-exercise）

一个专门用来练 Git 和 GitHub 的小项目。它有两个部分：

1. **可视化练习台**（`index.html`）：把 Git 的内部状态画出来 —— 工作区、暂存区、提交图、远程仓库，你在页面里敲命令，画面上立刻能看到发生了什么，还带 14 个闯关任务。
2. **真实命令练习**（`docs/practice-plan.md`）：一份从 `git init` 到 GitHub 拉取请求（PR）的分步练习清单，配了 `practice/` 里的几个小文件给你改着玩。

## 怎么打开

直接双击 `index.html` 就能用 —— 零依赖、不用装任何东西、不联网。

> 练习台是纯前端模拟，所有操作都只发生在这个页面里，**不会**动到你电脑上的任何真实文件；进度会自动存在浏览器本地。

## 练习建议的路线

1. 先在可视化练习台里把 14 个关卡打通。每个关卡下面都有「提示 / 示例命令」，卡住了就点开看。
2. 感觉顺手了，就照着 `docs/practice-plan.md` 在这个文件夹里敲真实命令。
3. 真实的 Git 练习不需要一开始就上 GitHub，本地把提交、分支、合并、撤销练熟，剩下的就是「同步」那一步。

## 目录结构

```
git-exercise/
├── index.html              练习台页面（双击打开）
├── assets/
│   ├── styles.css          练习台样式
│   ├── git-engine.js       Git 模拟引擎：状态模型 + 命令解析 + 中文解释
│   ├── tasks.js            14 个关卡的判定规则
│   └── app.js              界面渲染与交互（文件编辑、提交图、终端）
├── docs/
│   └── practice-plan.md    真实命令练习清单（含 GitHub 协作部分）
├── practice/               给你改着玩的小文件，冲突练习用得上
│   ├── todo.md
│   └── quote.txt
├── tools/
│   ├── selftest.js         引擎全流程自检（node tools/selftest.js）
│   └── dom-smoke.js        页面脚本渲染自检（node tools/dom-smoke.js）
├── .gitattributes          统一 LF 换行符，避免“整文件假改动”
└── .gitignore
```

这个文件夹已经是一个真正的 Git 仓库，并且已经推送到了
[github.com/xiaoxin-in/xiaoxin-github](https://github.com/xiaoxin-in/xiaoxin-github)（远程名 `origin`）。
如果你还想亲手体验一次 `git init`，另建一个空文件夹去练，不要在这里重复初始化。

## 练习台支持的命令

```
git init                                  把目录变成仓库
git status / git diff / git log [--oneline] [--all]
git add <文件|.> / git rm <文件>
git commit -m "说明" / git commit --amend
git branch [名称] [-d|-D] [-m] / git switch <名称> [-c] / git checkout <分支|提交|文件> [-b]
git merge <分支> / git rebase <分支> / git tag <名称>
git stash [pop|list|drop] / git reset [--hard|--soft] <提交> / git reflog
git remote add <名字> <地址> / git remote -v / git push <远程> <分支> / git fetch / git pull
```

辅助命令：`help`（命令列表）、`clear`（清屏）、`ls`（看工作区文件）、`touch <文件>`（新建文件）。
引用写法：`HEAD`、`HEAD~1`、`HEAD~2`、`main`、分支名、标签名、提交号前几位。

## 它是怎么“画”出来的

- **模拟引擎**（`assets/git-engine.js`）用一份纯数据描述仓库：`workdir`（工作区文件内容）、`index`（暂存区）、`commits`（提交图，含父提交）、`branches` / `tags`（指针）、`remotes`（远程副本）。
- 每条命令都只做两件事：改这份数据、返回一段人类可读的输出 + 一句中文解释。
- **提交图**把每个提交按“它诞生时所在的分支”排进一条泳道，父提交之间画连线；合并提交画成方块，指向第二条父提交的线画成虚线。
- **工作区 / 暂存区 / 仓库**三个面板，就是三种状态的实时快照对比 —— Git 里最容易混淆的部分，看一眼就懂了。

想改行为？`assets/tasks.js` 里的关卡判定最直观，改完刷新页面就生效。

## 已知的简化

刻意做简，方便理解主线；真实 Git 的细节比这多：

- 文件内容用字符串模拟，没有真正的 blob / tree / 哈希计算（提交号只是“看起来像 sha”）。
- `git rebase` 遇到冲突时会直接回滚，不进入交互式解决流程；冲突练习请用 `merge`。
- `git add -p`、`git bisect`、`git cherry-pick`、`git commit --amend` 的部分细节未实现。
- 不支持多远程、`git worktree`、子模块等。

## 自检

改过引擎或页面后，可以跑：

```bash
node tools/selftest.js    # 引擎全流程（init → 冲突 → 远程 → rebase …）
node tools/dom-smoke.js   # 页面脚本在模拟 DOM 里跑一遍，抓 id 写错、渲染报错
```
