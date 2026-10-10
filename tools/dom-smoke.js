/*!
 * dom-smoke.js —— 在没有浏览器的环境里执行页面脚本
 * 用最小 DOM 桩加载 index.html 里声明的 id，然后依次执行 app.js 的渲染路径，
 * 用来抓“元素 id 写错”“渲染函数报错”这类问题。
 * 用法：node tools/dom-smoke.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + label + (extra ? '  → ' + extra : ''));
}

/* ---------------------------------------------------------------- 最小 DOM */

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    dataset: {},
    listeners: {},
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    placeholder: '',
    type: '',
    scrollTop: 0,
    scrollHeight: 0,
    parentNode: null
  };
  Object.defineProperties(node, {
    firstChild: { get() { return this.children[0] || null; } },
    childElementCount: { get() { return this.children.length; } },
    clientWidth: { get() { return 880; } }
  });
  node.appendChild = function (child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  };
  node.removeChild = function (child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    return child;
  };
  node.setAttribute = function (k, v) { this.attributes[k] = String(v); };
  node.getAttribute = function (k) { return this.attributes[k]; };
  node.addEventListener = function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
  node.dispatch = function (type, event) { (this.listeners[type] || []).forEach((fn) => fn(event || {})); };
  node.focus = function () {};
  node.querySelectorAll = function () { return []; };
  return node;
}

/* 从 HTML 里收集所有 id，保证脚本用到的元素都真实存在 */
const ids = [];
const idRe = /id="([^"]+)"/g;
let match;
while ((match = idRe.exec(html)) !== null) ids.push(match[1]);

const registry = new Map();
ids.forEach((id) => registry.set(id, makeNode('div')));

const missing = [];
const document = {
  readyState: 'complete',
  createElement: (tag) => makeNode(tag),
  createElementNS: (ns, tag) => makeNode(tag),
  getElementById(id) {
    if (!registry.has(id)) {
      missing.push(id);
      registry.set(id, makeNode('div'));
    }
    return registry.get(id);
  },
  addEventListener: () => {}
};

const store = new Map();
globalThis.document = document;
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

/* ---------------------------------------------------------------- 加载脚本 */

try {
  eval(fs.readFileSync(path.join(root, 'assets', 'git-engine.js'), 'utf8'));
  eval(fs.readFileSync(path.join(root, 'assets', 'tasks.js'), 'utf8'));
  eval(fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8'));
  check('三个脚本都能加载并启动', true);
} catch (err) {
  check('三个脚本都能加载并启动', false, err.message);
  console.log(err.stack);
  process.exit(1);
}

check('页面里没有缺失的元素 id', missing.length === 0, missing.join(', '));
check('任务定义已注册', Array.isArray(globalThis.GIT_TASKS) && globalThis.GIT_TASKS.length >= 10, globalThis.GIT_TASKS.length + ' 个关卡');
check('引擎已注册', !!globalThis.GitSim);

/* ---------------------------------------------------------------- 模拟操作 */

const termInput = document.getElementById('term-input');
const termForm = document.getElementById('term-form');

function type(cmd) {
  termInput.value = cmd;
  termForm.dispatch('submit', { preventDefault() {} });
}

const script = [
  'git init',
  'git status',
  'git add .',
  'git commit -m "初始提交"',
  'git log --oneline',
  'git switch -c feature/hello',
  'git branch',
  'git switch main',
  'git tag v1.0',
  'git remote add origin https://github.com/example/git-exercise.git',
  'git push origin main',
  'git fetch',
  'git pull',
  'git stash',
  'git stash list',
  'git reflog',
  'git rebase main',
  'git reset --hard HEAD~1',
  'help',
  'clear',
  'this-is-not-a-command'
];

let crashed = null;
try {
  script.forEach(type);
} catch (err) {
  crashed = err;
}
check('执行一整套命令时渲染没有抛错', !crashed, crashed ? crashed.message : '');
if (crashed) console.log(crashed.stack);

const graphWrap = document.getElementById('graph-wrap');
check('提交图画出了 SVG 与节点', graphWrap.children.length === 1 && graphWrap.children[0].children.length > 3,
  graphWrap.children.length ? graphWrap.children[0].children.length + ' 个图形元素' : '没有 svg');

const output = document.getElementById('term-output');
check('终端输出了历史记录', output.children.length > 0, output.children.length + ' 条记录');

const files = document.getElementById('files-list');
check('工作区文件列表已渲染', files.children.length >= 3, files.children.length + ' 行');

const indexList = document.getElementById('index-list');
check('暂存区面板已渲染', indexList.children.length >= 1);

const tasks = document.getElementById('tasks-list');
check('关卡列表已渲染', tasks.children.length > 5, tasks.children.length + ' 个节点');

const legend = document.getElementById('graph-legend');
check('分支图例已渲染', legend.children.length >= 2, legend.children.length + ' 项');

const repoInfo = document.getElementById('repo-info');
check('仓库信息面板已渲染', repoInfo.children.length >= 2);

/* 编辑器路径 */
let editorError = null;
try {
  const row = document.getElementById('files-list').children.find((child) => child.children.length >= 3);
  if (row) row.dispatch('click');
  const textarea = document.getElementById('editor-textarea');
  textarea.value = '# 手改的内容\n';
  document.getElementById('editor-save').dispatch('click');
} catch (err) {
  editorError = err;
}
check('点文件 → 编辑 → 保存 不报错', !editorError, editorError ? editorError.message : '');
if (editorError) console.log(editorError.stack);

/* 撤销与重置 */
let buttonError = null;
try {
  document.getElementById('btn-undo').dispatch('click');
  document.getElementById('btn-reset').dispatch('click');
  document.getElementById('btn-help').dispatch('click');
} catch (err) {
  buttonError = err;
}
check('撤销 / 重置 / 帮助按钮不报错', !buttonError, buttonError ? buttonError.message : '');
if (buttonError) console.log(buttonError.stack);

check('重置后回到未初始化状态', globalThis.GitSim !== undefined && document.getElementById('status-pill').textContent.indexOf('尚未') >= 0,
  document.getElementById('status-pill').textContent);

console.log('');
console.log(failures === 0 ? '页面脚本自检通过 ✅' : failures + ' 项失败 ❌');
process.exit(failures === 0 ? 0 : 1);
