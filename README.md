# dsh-unidoc — 通用文档中心（Universal Document Center）

🌐 **中文** | [English](./README.en.md)

> DeepSeek Harness 的文档预览 / 编辑 / 管理插件。在 DSH Web GUI 中提供一个
> VSCode 风格的「文档中心」工作台：左侧文件树，点击即预览，代码与 Markdown
> 支持编辑与 `Ctrl/Cmd+S` 保存；同时为 Agent 暴露 `doc_read` / `doc_edit` /
> `doc_create` 三个文档工具，让模型可以通过自然语言读写工作区文档。

---

## 功能总览

### 1. 文件预览与编辑（验收标准对照）

| 类别 | 格式 | 实现方式 |
| --- | --- | --- |
| 办公文档（只读） | `.docx` `.xlsx` `.pptx` | 元数据 + 「暂不支持在线预览」友好提示卡（Office 预览内核未加载） |
| 代码与配置 | `.py .java .go .rs .cpp .c .js .ts .jsx .tsx .json .yaml .yml .toml .xml .ini .conf` 等 | 轻量语法高亮（关键词/字符串/注释/数字）+ 编辑 + `Ctrl/Cmd+S` 保存 + Tab 缩进 + 括号自动配对 |
| 标记语言与富文本 | `.md` `.html` | Markdown：**编辑/预览双模式**，预览渲染标题/列表/代码块/表格/图片，支持相对图片与相对链接跳转；HTML：**沙箱预览**（CSP 禁脚本 + iframe `sandbox` 属性双重隔离）+ 源码视图 + **新标签页打开**（`unidoc.openExternal`） |
| 静态资源与版式 | `.png .jpg .jpeg .gif .svg .webp .pdf` | 图片自适应缩放；PDF 内嵌浏览器查看器（翻页/缩放由浏览器原生提供） |
| 数据科学（探索性） | `.ipynb` | 只读 Notebook 预览：Markdown 单元渲染 + 代码单元高亮 + 文本输出 |
| 纯文本兜底 | `.log .csv .txt` 及任意未归类文本 | CSV 渲染为表格；其余以**只读纯文本**打开——未知扩展名绝不崩溃 |
| 明确不支持 | 音视频（`.mp4 .mp3` 等）、iWork（`.pages .numbers .key`）、CAD（`.dwg`）、OpenPencil（`.op`） | UI 给出友好「暂不支持预览」提示与文件信息 |

### 2. 界面入口

- **侧边栏底部**「📝 铅笔文件」图标按钮（`sidebar.footer.action`，纯图标无文字，Font Awesome `fa-file-pen`）——打开/关闭工作台；
- **全屏工作台**（`shell.overlay`）：
  - 顶部显示标题与**当前工作区根目录路径**（自动识别当前 DSH 会话工作区，切换 Agent / 会话时自动感知——打开时先刷新根目录并重载文件树，运行期每 15s 感知切换，顶部路径与文件树内容始终一致）；
  - 左侧为文件区：
    - 文件树顶部显示工作区根目录；文件树支持懒加载、点击目录展开/折叠、文件大小，**文件图标按扩展名映射 Font Awesome 标准图标**（代码/文档/图片/PDF/Office/压缩包/音视频等）；
    - **「展开全部」**：一键递归展开工作区全部目录（含 `.git`、`.github`、`.vscode`、`node_modules` 等隐藏目录），异步分批加载并每层让出主线程，超大仓库不卡页面；**「折叠全部」**一键收起并释放缓存；
    - 刷新 / 展开全部 / 折叠全部 / 选项 / 关闭操作键统一排列在文件区下方（左下角），从布局上避免与其他插件悬浮按钮（如 better-sidebar 的折叠侧边栏图标）在右上角位置重合；
  - 右侧为预览/编辑面板：所有视图工具栏均有「外部打开」按钮（**点击 → 浮现编辑器选择菜单 → 选择 → 跳转打开**，并记住上次选择的编辑器），HTML 预览另有「新标签页」按钮（`window.open` raw 路由 URL）；
- **运行卡片**（`tool.view.cordis`）：显示插件激活状态与一键打开按钮；
- **Toast 反馈**：加载 Loading 状态、保存成功/失败提示；
- **选项面板**（会话级内存配置，从文件区下方「⚙ 选项」键向上弹出）：代码编辑开关、Markdown 双模式开关、「暂不支持」提示卡开关、**外部编辑器列表**（增删改，自定义名称与命令，默认 VS Code / Sublime Text / Atom / Notepad++ / Vim / Neovim / Typora）。

### 3. Agent 集成工具

| 工具 | 说明 |
| --- | --- |
| `doc_read` | 按路径读取文档/代码（支持 `offset`/`limit` 按行读取大文件；二进制返回文件信息） |
| `doc_edit` | 将文件中**唯一出现**的 `old_string` 替换为 `new_string` 并原子保存（0 次或多处匹配都会明确报错） |
| `doc_create` | 创建工作区内新文件（默认不覆盖；`overwrite=true` 可覆盖） |

所有路径均相对文档中心根目录（当前会话工作区），并经 `fs.contains` 校验，
杜绝目录穿越。

---

## 技术架构

### 双端结构（DSH 动态 Cordis 插件）

- **Host 半端**（`src/host.js`，运行于 DSH Node 进程）
  - 依赖声明：`inject: ['fs', 'webServer', 'sandboxPolicy']`
  - **根目录解析**（多级候选，取第一个真实存在的目录）：
    1. 当前发起者 Agent 的会话 `cwd`（`agents.currentInitiator()` → `session.header.cwd`）；
    2. 在线 Agent 列表的会话 `cwd`（`agents.list()`）；
    3. 最近会话记录的 `cwd`（`sessionQuery.listSessions()`，newest-first）；
    4. 兜底 `sandboxPolicy.workspaceRoot`。
    工具执行时额外以调用者 Agent（`exec.agent`）的会话 `cwd` 为准，保证精准命中当前工作区；
    `unidoc.root` 支持 `refresh: true` 丢弃缓存重新解析，供 Client 感知工作区切换。
  - **写入策略**：插件上下文中 fs 后端默认沙箱根不是会话工作区，所有写路径（保存/创建/编辑）
    显式传递 `SandboxExecutionPolicy`（`workspaceRoot` = 解析出的工作区；工具调用尊重会话模式覆盖，
    如 `read-only` 会话拒绝写入）；
  - 提供 Client RPC：`unidoc.root` / `unidoc.list` / `unidoc.read` / `unidoc.save` / `unidoc.create`
    / `unidoc.openExternal`（返回 raw 路由 URL，供客户端新标签页打开）/ `unidoc.openWithEditor`
    （`child_process.spawn` 启动外部编辑器：`editorCmd` 严格校验防注入、路径经 `fs.contains`
    防目录穿越、`detached` + `stdio: ignore` + `unref` 不阻塞 Host）
  - 注册 HTTP 路由（前缀随机、经 `ctx.effect` 自动回收）：`GET <rawPrefix>?p=<相对路径>`，
    为图片 / PDF / HTML 提供原始字节，HTML 附带 `Content-Security-Policy`（禁脚本/禁连接）
    与 `X-Content-Type-Options: nosniff`
  - 通过 `harness.defineTool` + `harness.registerTool` 注册 3 个动态工具，注册挂载在
    插件 Fiber（`ctx.effect`）上，停止/更新时自动注销
- **Client 半端**（`src/client.js`，运行于浏览器页面）
  - 依赖声明：`inject: ['slots', 'timer']`
  - 纯 `React.createElement`（无 JSX、无打包器），样式经 `styles.insert` 注入
    并使用 `--dsw-alias-*` 主题 token（自动适配亮/暗主题）
  - 自研轻量 Markdown 渲染器与代码分词高亮器（行内解析全部转义，防 XSS）
  - 文件树图标内嵌 Font Awesome 6 Free Solid 官方 SVG path（按扩展名映射，含入口
    `fa-file-pen` 图标），不依赖 GUI 是否内置 FA 字体
  - 工作区识别：打开工作台时与运行期间（每 15s）经 `unidoc.root(refresh)` 感知工作区切换，
    自动刷新文件树；「展开全部」异步分批递归加载（含隐藏目录），超大仓库不卡页面
  - 所有文件 IO 经 `host.call` 走 Host 半端，不直接触碰页面全局

### 生命周期

- 插件停止 / 更新 / 移除时：工具注册、HTTP 路由、Slot 注册、样式、定时器全部自动回收
  （Cordis Fiber 效应与 disposer 机制）；
- 文档中心打开状态与选项为**会话级内存状态**，随插件卸载消失（动态插件不落盘）。

---

## 安装与运行

本仓库是 dsh-unidoc 的**源码与文档仓库**；插件以 DSH **静态 Cordis 插件包**发布（`lib/` 为构建产物，已随包提交），
也可直接作为 DSH profile 依赖安装：

```bash
# 作为 DSH profile 依赖安装（lib/ 已包含在包内，prepare 也会自动构建）
npm install git+https://github.com/Che-Year/dsh-unidoc
```

开发调试（源码 → 产物）：

```bash
# 1. 安装构建依赖（esbuild）
npm install

# 2. 语法冒烟检查（与 DSH define-time 预检同构）
npm run check

# 3. 构建产物到 lib/（esbuild 打包 host + 自定义 bundler 打包 client）
npm run build

# 4. 在会话中部署：使用 cordis_define 提交两端源码（code.host / code.client），
#    再 cordis_run 激活（Client 端首次激活需要批准）
```

激活后：
- 侧边栏底部出现纯图标入口（Font Awesome 铅笔文件图标，悬停显示说明）；
- Agent 侧出现 `doc_read` / `doc_edit` / `doc_create` 工具。

> 持久化部署：如需随 Harness 启动自动加载，可将两端源码迁移为静态插件包
> （`dsh-web-ui` 全家桶风格），或放入 `~/.dsh/.agent-presets` 对应的预设中。

---

## 配置说明

外部编辑器以**列表**形式配置（会话级内存状态，随插件卸载消失）：

- 打开文档中心 → 左下角「⚙ 选项」→「外部编辑器列表」；
- 默认内置：VS Code（`code`）、Sublime Text（`subl`）、Atom（`atom`）、
  Notepad++（`notepad++`）、Vim（`vim`）、Neovim（`nvim`）、Typora（`typora`）；
- 支持**增删改**：每一行可修改名称与命令，✕ 删除，末行「＋」添加新编辑器；
- 点击视图工具栏「外部打开」时弹出选择菜单，选择后调用 `unidoc.openWithEditor`
  打开文件，并**记住上次选择的编辑器**作为下次默认；
- 命令约束：仅允许命令名或可执行文件路径（不含空格、不含 shell 元字符），
  且需在系统 `PATH` 中（如 VSCode 的 `code` 命令需先执行「Install 'code' command」）；
  目标文件路径一律经 `fs.contains` 校验，杜绝目录穿越。

---

## 更新日志

| 版本 | 说明 |
| --- | --- |
| v0.3.1 | **修复工作区切换后文件树不刷新的问题**：切换 Agent / 会话后重新打开文档中心，文件树自动重置并加载新工作区文件结构，不再残留旧工作区数据；顶部路径与文件树保持一致 |
| v0.3.0 | 工作区识别与展示；文件树「展开全部/折叠全部」（含隐藏目录）；外部编辑器选择菜单与列表配置；侧边栏入口精简为纯图标并更换为 Font Awesome `fa-file-pen` 图标 |
| v0.2.0 | HTML 预览新标签页打开；外部编辑器集成（RPC + 命令配置）；文件树按扩展名映射 Font Awesome 图标；修复 git 安装缺少 `lib/` 导致启动报错 |
| v0.1.0 | 初始版本：文档中心工作台（文件树 + 多格式预览/编辑 + 保存）、Agent 工具 `doc_read` / `doc_edit` / `doc_create` |

完整变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 开发与测试

- `node scripts/check.js`：两端源码语法冒烟测试；
- `tests/verification.md`：手工 E2E 验证清单（挂载、文件树、各格式预览、保存、
  Toast、工具调用、边界用例）；
- 开发规范：不修改 `~/.dsh/source/current/` 下任何官方源码；只通过动态插件
  机制挂载；复用官方 Service/Slot 能力（`fs`、`webServer`、`slots`、`timer`）。

---

## 来源与许可

本插件基于/复用了 `dsh-better-sidebar` 的架构能力，感谢原作者的贡献。

- 本插件采用 **MIT 许可证**发布，`LICENSE` 文件中保留上游（`dsh-better-sidebar`
  及 DSH 核心框架，均遵循 MIT 许可证）的完整版权声明与许可条款；
- 本仓库绝不修改、复制或混入 `~/.dsh/source/current/` 下的任何官方源码，
  仅在运行时通过 DSH 官方动态插件机制挂载能力，避免衍生品混淆与合规风险。
