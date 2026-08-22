# Changelog

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
