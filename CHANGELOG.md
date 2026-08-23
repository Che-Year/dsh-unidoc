# Changelog

## [0.3.6] - 2026-08-23

### Fixed

- **修复工作区切换后文件树 / 根目录不刷新（固定显示旧工作区）**。症状：切换工作区后 `unidoc.root` 仍解析到固定目录（如 PunctFlow），无论当前选中哪个工作区。修复要点：
  - **根因 1（Client 权威信号时序）**：`currentSessionCwd()` 依赖 DSH 客户端运行时 `sessions` 服务，插件激活瞬间该服务可能尚未就绪，启动时的首次上报拿到空值；现改为**启动后延迟 1.5s 重试上报**，且 `unidoc.root` 每次调用（打开工作台 / 5s 轮询 / 手动刷新）都携带 hintCwd，确保权威信号最终送达 Host；
  - **根因 2（Host 候选恒命中 createdAt 最大的会话）**：多个已存在会话并存时，`listSessions`（按 `createdAt` 降序）与「当前选中会话」无关——即使切到已创建的历史会话，候选仍命中创建最晚的工作区；`hintCwd` 权威信号（`sessions.list.getSnapshot().current` → `byId[id].cwd`，官方 `useSessions` 数据源）一旦生效即彻底解决；
  - **可观测性**：Host 端 `unidoc.root` 新增 hintCwd 收付诊断日志（仅在值变化时打印，避免 5s 轮询刷屏），排障时可直接从终端确认「Client 的当前会话工作区是否到达 Host」；
  - **自动化测试**：新增 `tests/root-resolution.test.mjs`（42 项断言，`node tests/root-resolution.test.mjs`）——覆盖 hintCwd 权威信号（有效 / 空串 / 非目录 / 空白 / 变化跟随 / 持久性）、候选解析顺序（发起者 → 在线 Agent 新→旧 → live 会话 → 幽灵会话 → 兜底根）、路径锚定与防目录穿越、Agent 工具（doc_read / doc_edit / doc_create）以调用者会话 cwd 为准。

## [0.3.5] - 2026-08-23

### Fixed

- **修复 v0.3.4 回归：DSH 页面侧边栏插件图标消失（Client 半端崩溃）**。v0.3.4 将静态 bundle 的 `fakeCtx.get` 从「白名单写死」改为「全量转发 `ctx[name]`」——而 DSH **客户端运行时没有 `timer` 服务**（`dsh-client-runtime` 仅提供 slots / sessions 等，timer 由静态桥接以 `setTimeout` 提供）。Cordis 的 `ctx` 是 Proxy，对未提供/未注入的服务属性访问会**抛错**（`cannot get property "timer" without inject`）；由于 `const value = ctx[name]` 位于第一行，`ctx.get('timer')` 在 `client.js` apply 顶层**未受保护**地抛错，导致整个 Client 半端加载失败——侧边栏入口图标与文档中心工作台全部消失。修复要点：
  - `scripts/build-client.mjs` 的 `fakeCtx.get` 改为：**`timer` 写死返回桥接实现**（恢复 v0.3.3 行为，绝不访问 `ctx.timer`）；slots / sessions 等服务用 **try/catch 包裹的安全转发**，未提供时返回 `undefined`（调用方容错回退），绝不抛出；
  - 保留 v0.3.4 的 hintCwd 工作区隔离能力（`ctx.get('sessions')` 仍尽力读取，失败自动回退 Host 候选解析）；
  - 重新构建 `lib/client.js`，并同步修复版到已安装插件的运行目录（刷新页面即恢复图标）。

## [0.3.4] - 2026-08-23

### Fixed

- **修复「无论打开哪个工作区都显示旧工作区 A」的工作区隔离问题（权威信号级修复）**：v0.3.3 的「最近创建会话优先」候选在**切回早已创建的历史会话**（resume 持久化会话）时失效——`sessionQuery.listSessions()` 按 `createdAt` 降序返回**全部会话（含持久化「幽灵」记录）**，历史会话的 `createdAt` 可能最大而永远排第一，导致根目录恒命中旧工作区。修复要点：
  - **Client 端权威信号**：通过 DSH 客户端运行时 `sessions` 服务读取「当前选中会话」的工作区 `cwd`（`sessions.manager.selected` → `sessions.list.getSnapshot().byId[id].cwd`），随每次 `unidoc.root(hintCwd)` 上报 Host——无论切换到新建会话还是早已创建的历史会话，都能精确命中当前工作区；
  - **Host 端 hintCwd 优先**：`unidoc.root` 接收 `hintCwd`（校验为目录后）直接作为根目录，`unidoc.list / read / save / create` 等全部 RPC 以它为锚；传空串则清除 hint 走候选兜底；
  - **候选兜底增强**：无 hint 时，`collectCandidates` 改为「在线 Agent 从最新注册向旧遍历」优先，`sessionQuery.listSessions()` 中 **live 会话**按 `createdAt` 降序排在**持久化幽灵会话**之前，兜底 `sandboxPolicy.workspaceRoot` 动态读取；
  - **静态包形态桥接**：`build-client.mjs` 的 `fakeCtx.get` 改为转发真实 ctx 服务（含 `sessions`），使静态 bundle 形态也能读取当前会话工作区。
- **RPC 传输错误缓解**：修复根目录解析后，不再因「请求了错误工作区路径」触发 `Failed to fetch` 类错误；切换工作区瞬间的路由窗口期竞态由 Client 容错（静默重试），若问题根源涉及 DSH 框架层（会话切换时插件上下文重挂载），属后端框架行为。

## [0.3.3] - 2026-08-22

### Fixed

- **修复切换工作区后文件树仍显示旧工作区的问题（根因级修复）**：浏览器 RPC（Client→Host）位于 Agent 驱动链（initiator 边界）之外，`agents.currentInitiator()` 在 `unidoc.root` 中返回 `undefined`；而 `agents.list()` 按注册顺序返回**所有在线 Agent**（旧在前、新在后），切换工作区后旧会话 Agent 仍在线且排在前面，导致根目录解析命中**旧工作区**——文件树随之显示旧结构，手动刷新也无效。修复要点：
  - `collectCandidates` 候选顺序重排为「最近会话优先」：发起者 Agent（工具调用场景）→ **最近创建的会话**（`sessionQuery.listSessions()`，newest-first，按 `createdAt` 降序）→ 在线 Agent 列表（**从最新注册向旧遍历**）→ 兜底 `sandboxPolicy.workspaceRoot`（改为每次动态读取，不再于激活时缓存）；
  - 候选去重：同一 `cwd` 只保留一次，避免重复 `fs.stat`。
- **文件树 / 路径状态在刷新与工作区切换时完全重置**：配合上述根目录修正，打开文档中心、手动刷新与运行期 5s 轮询检测到根目录变化时，文件树自动清空缓存、重置展开状态与滚动位置到根目录、关闭旧文件预览并重载当前工作区文件结构，顶部路径与文件树内容始终一致，不再残留任何旧工作区状态。

## [0.3.2] - 2026-08-22

### Fixed

- **工作区切换感知更及时**：运行期感知轮询间隔由 15s 缩短为 **5s**（`unidoc.root(refresh)` 对比根目录），切换 Agent / 会话（工作区）后文档中心更快自动检测变化、重置文件树并重新加载当前工作区的文件结构。
- **文件树重置不再残留任何旧状态**：工作区切换 / 文件树刷新时，除清空树数据、懒加载缓存与展开状态外，**文件树滚动位置一并重置到顶部**，当前选中的文件/目录路径重置（关闭预览，显示空状态），默认所有目录折叠，界面状态与当前工作区完全一致。
- **Toast 提示文案统一**：工作区切换时提示「工作区已切换，文件树已刷新」，顶部工作区路径与文件树内容保持同步一致。

## [0.3.1] - 2026-08-22

### Fixed

- **修复工作区切换后文件树不刷新的问题**：切换 Agent / 会话（工作区）后重新打开文档中心时，文件树不再残留上一个工作区的文件结构。修复要点：
  - 文件树的数据生命周期与**根目录绑定**：`Tree` 的重置/重载依赖从 `[refreshKey]` 扩展为 `[refreshKey, root]`，`unidoc.root` 感知到工作区变化（更新 `store.root`）时，自动清空树数据、懒加载缓存与展开状态，并以新工作区根目录重新加载；
  - **打开时先刷新根、再无条件重载**：打开工作台的瞬间文件树会以 Host 缓存旧根挂载，现改为先经 `unidoc.root(refresh)` 重新解析根目录，再无条件触发一次文件树重载，杜绝「顶部路径已更新、文件树残留旧数据」；
  - 运行期间（每 15s）感知到工作区切换时：清空选中文件（避免预览残留）、重置并重载文件树、Toast 提示「工作区已切换」，顶部路径与文件树内容保持一致。

## [0.3.0] - 2026-08-22

### Added

- **工作区识别与展示**：Host 端 `unidoc.root` 新增 `refresh: true`（丢弃缓存重新解析根目录，候选：发起者 Agent 会话 `cwd` → 在线 Agent 列表 → 最近会话记录 → 兜底 `workspaceRoot`）；Client 在打开工作台时与运行期间（每 15 秒）经 `unidoc.root(refresh)` 感知工作区切换，标题栏与文件树顶部清晰展示当前工作区根目录，工作区变化自动刷新文件树并提示。
- **文件树「展开全部 / 折叠全部」**：一键递归展开工作区全部目录（`unidoc.list` 天然包含 `.git`、`.github`、`.vscode`、`node_modules` 等隐藏目录），异步分批并发加载（每批 8 个目录）并在每层让出主线程，超大仓库不卡页面；目录数超过上限（3000）自动停止并提示；「折叠全部」一键收起并释放缓存；文件树顶部新增工作区根目录展示。
- **外部编辑器选择菜单**：点击「外部打开」改为「点击 → 浮现编辑器选择菜单 → 选择 → 跳转打开」；菜单默认列出 VS Code / Sublime Text / Atom / Notepad++ / Vim / Neovim / Typora；选择后调用 `unidoc.openWithEditor` 并**记住上次选择的编辑器**作为默认（菜单中标记「上次使用」）。
- **外部编辑器列表配置**：选项面板的「外部编辑器命令」单输入升级为**编辑器列表**（增删改，每项名称 + 命令），支持自定义编辑器，命令仍受严格校验（无空格 / 无 shell 元字符）且路径经 `fs.contains` 防目录穿越。
- **新图标**：插件入口（侧边栏底部按钮）与运行卡、工作台标题更换为 Font Awesome `fa-file-pen`（铅笔字迹的文件图标，内嵌官方 SVG path，`--dsw-alias-*` 主题 token 着色，亮/暗主题自适应）。

### Changed

- **界面精简**：侧边栏底部入口移除「文档中心」文字，仅保留图标（悬停 title 仍显示说明），按钮可点击性不受影响。

## [0.2.0] - 2026-08-22

### Added

- **HTML 预览支持新标签页打开**：Host 新增 `unidoc.openExternal` RPC（复用 raw 路由返回可访问的 HTTP URL，优先组装绝对 URL、无请求头时退化为相对 URL），HTML 预览工具栏新增「新标签页」按钮。
- **外部编辑器集成**：Host 新增 `unidoc.openWithEditor` RPC（`child_process.spawn` 启动，`detached` + `stdio: ignore` + `unref`，绝不阻塞 Host 进程）；选项面板新增「外部编辑器命令」输入框（会话级内存配置，默认 `code`，如 `notepad` / 可执行文件路径）；所有预览/编辑视图工具栏新增「外部打开」按钮。
- **文件树标准图标**：文件树图标按扩展名映射 Font Awesome 图标（`fa-solid fa-file-*`），覆盖代码 / 文档 / 图片 / PDF / Office / 压缩包 / 音视频等常见类别；GUI 未内置 FA 字体，以官方 SVG path 内嵌渲染（保留 FA 类名便于后续接入字体）。
- **构建与发布管线**：`package.json` 新增 `build`（esbuild 打包 host + 自定义 bundler 打包 client）、`prepublishOnly`（发布前自动构建）、`prepare`（git 安装时自动构建）脚本；新增 `scripts/build-host.mjs`；新增 `devDependencies: esbuild`。
- 新增 `CHANGELOG.md`。

### Fixed

- **修复从 GitHub 安装时 client bundle 缺失**：`.gitignore` 不再忽略 `lib/`（仅保留 `*.tsbuildinfo` 等构建缓存忽略），`lib/client.js` 随包提交发布；`files` 字段明确包含 `lib`（含 `src` / `scripts`），确保 `npm install git+https://github.com/Che-Year/dsh-unidoc` 得到包含完整 `lib/` 的可用包。
- **外部编辑器启动安全与生命周期**：`editorCmd` 仅接受命令名或可执行文件路径（无空格、无 shell 元字符，防注入）；目标路径一律经 `fs.contains` 校验防目录穿越；编辑器进程 detached + unref，Host 退出不残留句柄、编辑器独立运行。
