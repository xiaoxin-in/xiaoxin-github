# 真实命令练习清单

练习台是模拟的，这一份是在**真实仓库**里动手的清单。命令在 PowerShell、Git Bash、macOS 终端里都一样。

怎么用：一节一节往下做，每节末尾有「检查点」。做错了不要紧 —— 这正是练习的意义，撤销的办法也写在清单里了。

> 所有命令都在这个项目的根目录（`git-exercise/`）里执行，不要在 `practice/` 子目录里另外 `git init`。
> 这个仓库已经初始化好、也已经推送到 GitHub 了，所以下面第 1、2 节的重点是「观察并理解」，第 9 节的远程配置也已经完成，你照着念一遍命令、看看输出即可。

---

## 0. 开始之前

确认 Git 装好了，并给自己起个名字（只需设置一次，全局生效）：

```bash
git --version
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
git config --global init.defaultBranch main
```

查看当前配置：

```bash
git config --list --show-origin
```

**检查点**：`git --version` 能打印版本号，说明装好了。

---

## 1. 认识这个仓库

这个文件夹已经是 Git 仓库了，先「观察」：

```bash
git status
git log --oneline --graph
ls -Force      # Windows PowerShell，看隐藏的 .git 目录
ls -a          # Git Bash / macOS
```

`.git` 就是仓库本体，所有历史都存在里面。**删掉它，这个文件夹就和 Git 无关了。**

想亲手体验一次「从零开始」的感觉，另开一个空文件夹（别在这个仓库里做）：

```bash
mkdir ../git-init-demo
cd ../git-init-demo
git init
git status
```

新建的目录里，`git status` 会先告诉你 `No commits yet`，文件全部标着 `Untracked`（未跟踪）—— 意思是「我看见了它们，但还没开始管」。体验完 `cd -` 回到本仓库就行。

**检查点**：你能说清楚「仓库 = 项目文件夹 + 隐藏的 .git 目录」。

---

## 2. 提交自己的第一笔改动

仓库里已经有一次初始提交了（`git log` 能看到）。现在动手做一个属于你的提交：

```bash
# 编辑 practice/todo.md，把某个 [ ] 改成 [x]
git status                       # 看到 practice/todo.md 被修改
git diff                         # 看具体改了哪一行
git add practice/todo.md
git status                       # 这时它在「Changes to be committed」里
git commit -m "勾掉一项待办"
git log --oneline
```

体会一下「分批提交」的意思：先只提交 todo.md，再改点别的单独提交一次。

```bash
# 再编辑 practice/quote.txt
git add practice/quote.txt
git commit -m "换一句座右铭"
```

**检查点**：`git log --oneline` 最上面两条是你自己刚写的提交说明。

**常见坑**：只改了文件却忘了 `git add`，`commit` 会说 `nothing to commit`；这时候补一次 `git add` 就好。想撤销一次 `git add`，用 `git restore --staged <文件>`。

---

## 3. 看清状态与差异

改一下 `practice/todo.md`（加一行），然后：

```bash
git status          # 看哪些文件变了
git diff            # 看具体改了哪几行
git diff --staged   # 看已经 add 的内容和上一次提交的差异
```

想放弃这次修改、恢复成上次提交的样子：

```bash
git restore practice/todo.md        # 丢弃工作区的修改（谨慎）
git restore --staged <文件>          # 把文件从暂存区拿出来，改动还在
```

**检查点**：你能说清楚 `working tree`（工作区）、`index`（暂存区）、`HEAD`（最后一次提交）三个词分别指什么。

---

## 4. 分支：开一条平行世界

```bash
git switch -c feature/hello      # 新建并切换
git branch                       # 看一眼所有分支，带 * 的是当前分支
```

在这个分支上干点活并提交：

```bash
# 编辑 practice/quote.txt，换一句你今天想写的话
git add practice/quote.txt
git commit -m "换一句今天的座右铭"
```

回到 main，看看文件变回去了没有：

```bash
git switch main
cat practice/quote.txt
git switch feature/hello
cat practice/quote.txt
```

**检查点**：两个分支下的 `quote.txt` 内容不一样 —— 你亲手体验了「切换分支 = 切换文件夹的样子」。

---

## 5. 合并与冲突：必修课

### 5.1 顺利的合并

```bash
git switch main
git merge feature/hello
git log --oneline --graph
```

如果 main 自己没有新提交，这叫 **Fast-forward（快进）**：只是把指针往前挪了一格。

### 5.2 故意制造一次冲突

```bash
git switch -c feature/banner
# 把 practice/quote.txt 第一行改成「来自 feature 分支」
git add practice/quote.txt
git commit -m "feature 分支改第一行"

git switch main
# 把 practice/quote.txt 第一行改成「来自 main 分支」
git add practice/quote.txt
git commit -m "main 分支改第一行"

git merge feature/banner
```

这时文件里会出现：

```
<<<<<<< HEAD (main)
来自 main 分支
=======
来自 feature 分支
>>>>>>> feature/banner
```

解决它 —— 把文件改成你真正想要的样子（**删掉所有 `<<<<<<<`、`=======`、`>>>>>>>` 标记**），然后：

```bash
git add practice/quote.txt
git commit -m "合并 feature/banner 并解决冲突"
```

不想继续了随时可以撤退：

```bash
git merge --abort
```

**检查点**：`git log --oneline --graph` 里出现一个「分叉又合流」的形状，那个汇合点有两个父提交，就是本次的合并提交。

---

## 6. 撤销三件套

先做一个「要被撤掉」的提交：

```bash
git switch main
# 随便改点东西
git add .
git commit -m "准备被撤销的提交"
git log --oneline     # 记下最上面那条的提交号，后面要用
```

| 想要的效果 | 命令 |
| --- | --- |
| 回退到上一个提交，改动**全部丢掉** | `git reset --hard HEAD~1` |
| 回退提交，但改动**留在暂存区** | `git reset --soft HEAD~1` |
| 回退提交，改动**留在工作区** | `git reset HEAD~1` |
| 用**新提交**抵消某次提交（更安全，适合已推送的提交） | `git revert <提交号>` |

`reset --hard` 之后如果后悔了，靠 **reflog** 找回来：

```bash
git reflog
git reset --hard <刚刚看到的提交号>
```

**检查点**：你成功用 `reflog` 救回了被 `reset --hard` 干掉的提交。这个技能在真实工作中能救命。

---

## 7. stash：改到一半要救火

```bash
# 改点东西，先别提交
git stash          # 收进小抽屉，工作区立刻变干净
git status
git switch main    # 现在可以自由切分支了
git switch -       # 回到刚才的分支
git stash pop      # 把草稿取回来
```

`git stash list` 看抽屉里有什么；`git stash drop` 丢掉一份。

**检查点**：`git stash` 之后 `git status` 是干净的，`git stash pop` 之后改动又回来了。

---

## 8. rebase：把历史拉直

```bash
git switch -c feature/straight
# 改 practice/todo.md 并提交两次
git add practice/todo.md && git commit -m "待办 A"
git add practice/todo.md && git commit -m "待办 B"

git switch main
# 改 practice/quote.txt 并提交一次（让 main 往前走）
git add practice/quote.txt && git commit -m "main 往前走一步"

git switch feature/straight
git rebase main
git log --oneline --graph --all
```

对比一下：`merge` 会留下分叉和合并提交，`rebase` 把你的提交「换个爹」，历史变成一条直线，代价是**提交号全变了**。

**规矩**：只对**还没推送给别人**的提交做 rebase。

---

## 9. 连接 GitHub

这一步在本仓库里**已经做完了**，你照着念一遍、看看输出即可：

```bash
git remote -v
git branch -vv              # 看 main 跟踪的是哪个远程分支
git log --oneline -1 origin/main
```

当初用的命令是这三条，换成你自己的仓库地址就是同一套流程：

```bash
git remote add origin https://github.com/你的名字/仓库名.git
git branch -M main
git push -u origin main     # -u 记住对应关系，以后直接 git push / git pull
```

新建 GitHub 仓库时**不要**勾选 "Add a README file"，否则第一次 push 会因为远程已有提交而被拒绝。

以后再改点东西，推送就是一个字：

```bash
git push
```

如果提示要密码：GitHub 早就不接受账号密码了，请使用 **Personal Access Token**（Settings → Developer settings → Personal access tokens）或者配置 SSH key。

**检查点**：刷新 [仓库页面](https://github.com/xiaoxin-in/xiaoxin-github)，能看到你刚在本地做的提交。

---

## 10. 协作流程：分支 → PR → 合并

真实团队里基本都这么走，一个人也能练：

```bash
git switch -c feature/readme-polish
# 改 README.md
git add README.md
git commit -m "完善 README 的说明"
git push -u origin feature/readme-polish
```

然后到 GitHub 页面上：

1. 点 **Compare & pull request**，写清楚这次改了什么、为什么改；
2. 在 **Files changed** 里给自己做一次 code review（留一条 comment 试试）；
3. 点 **Merge pull request**；
4. 回到本地同步：

```bash
git switch main
git pull
git branch -d feature/readme-polish       # 删除已经合并的本地分支
git push origin --delete feature/readme-polish   # 删除远程分支
```

还可以练：**Issues**（提一个待办）、**Labels**、**Milestones**、**Draft PR**。

**检查点**：你在 GitHub 上完成了人生第一个 Pull Request，并且本地 main 和远程保持一致。

---

## 11. 保持同步：和「别人」的改动共存

一个人练习时，可以直接在 GitHub 网页上编辑文件来模拟队友提交。

在网页上改一个文件并提交，然后本地：

```bash
git fetch              # 只看不动：把远程最新版下载到 origin/main
git log HEAD..origin/main --oneline    # 看看对方多了哪些提交
git pull               # = fetch + merge
```

本地也有提交、两边分叉时，`pull` 会产生一个合并提交（或者冲突）。想让历史干净些，可以：

```bash
git pull --rebase
```

如果 rebase 之后推送被拒绝（因为你改写了历史）：

```bash
git push --force-with-lease
```

`--force-with-lease` 比 `--force` 安全：它会先确认远程没有你不知道的新提交。

---

## 12. 继续进阶的清单

想更进一步，按顺序挑着练：

- `.gitignore` 的写法与「已经提交过的大文件怎么删」
- `git commit --amend` 修正上一次提交的说明或内容
- `git cherry-pick <提交号>` 把某个提交摘到当前分支
- `git log -p`、`git blame`、`git show`：查历史、查责任、看某次提交
- `git bisect` 二分定位「哪个提交引入了 bug」
- 标签与发布：`git tag -a v1.0 -m "第一版"` + `git push origin v1.0` + GitHub Releases
- GitHub Actions：写一个 `on: [push]` 的 workflow，让每次推送自动跑测试
- PR 模板、Issue 模板、CODEOWNERS、分支保护规则

练到这一步，你已经能覆盖日常开发里 95% 的 Git 操作了。
