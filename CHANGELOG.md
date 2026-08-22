# Changelog

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
