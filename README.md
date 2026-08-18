# dsh-unidoc — 通用文档中心（Universal Document Center）

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
| 标记语言与富文本 | `.md` `.html` | Markdown：**编辑/预览双模式**，预览渲染标题/列表/代码块/表格/图片，支持相对图片与相对链接跳转；HTML：**沙箱预览**（CSP 禁脚本 + iframe `sandbox` 属性双重隔离）+ 源码视图 |
| 静态资源与版式 | `.png .jpg .jpeg .gif .svg .webp .pdf` | 图片自适应缩放；PDF 内嵌浏览器查看器（翻页/缩放由浏览器原生提供） |
| 数据科学（探索性） | `.ipynb` | 只读 Notebook 预览：Markdown 单元渲染 + 代码单元高亮 + 文本输出 |
| 纯文本兜底 | `.log .csv .txt` 及任意未归类文本 | CSV 渲染为表格；其余以**只读纯文本**打开——未知扩展名绝不崩溃 |
| 明确不支持 | 音视频（`.mp4 .mp3` 等）、iWork（`.pages .numbers .key`）、CAD（`.dwg`）、OpenPencil（`.op`） | UI 给出友好「暂不支持预览」提示与文件信息 |

### 2. 界面入口

- **侧边栏底部**「📄 文档中心」按钮（`sidebar.footer.action`）——打开/关闭工作台；
- **全屏工作台**（`shell.overlay`）：顶部工具栏（根目录、刷新、选项、关闭）、左侧文件树（懒加载、目录展开、文件大小）、右侧预览/编辑面板；
- **运行卡片**（`tool.view.cordis`）：显示插件激活状态与一键打开按钮；
- **Toast 反馈**：加载 Loading 状态、保存成功/失败提示；
- **选项面板**（会话级内存配置）：代码编辑开关、Markdown 双模式开关、「暂不支持」提示卡开关。

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
    工具执行时额外以调用者 Agent（`exec.agent`）的会话 `cwd` 为准，保证精准命中当前工作区。
  - **写入策略**：插件上下文中 fs 后端默认沙箱根不是会话工作区，所有写路径（保存/创建/编辑）
    显式传递 `SandboxExecutionPolicy`（`workspaceRoot` = 解析出的工作区；工具调用尊重会话模式覆盖，
    如 `read-only` 会话拒绝写入）；
  - 提供 Client RPC：`unidoc.root` / `unidoc.list` / `unidoc.read` / `unidoc.save` / `unidoc.create`
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
  - 所有文件 IO 经 `host.call` 走 Host 半端，不直接触碰页面全局

### 生命周期

- 插件停止 / 更新 / 移除时：工具注册、HTTP 路由、Slot 注册、样式、定时器全部自动回收
  （Cordis Fiber 效应与 disposer 机制）；
- 文档中心打开状态与选项为**会话级内存状态**，随插件卸载消失（动态插件不落盘）。

---

## 安装与运行

本仓库是 dsh-unidoc 的**源码与文档仓库**；插件本体以 DSH **动态 Cordis 插件**形式
部署在正在运行的 Harness 会话中（由 `cordis_define` / `cordis_run` 管理），
源码即为 `src/host.js` 与 `src/client.js`。

```bash
# 1. 语法冒烟检查（与 DSH define-time 预检同构）
node scripts/check.js

# 2. 在会话中部署：使用 cordis_define 提交两端源码（code.host / code.client），
#    再 cordis_run 激活（Client 端首次激活需要批准）
```

激活后：
- 侧边栏底部出现「📄 文档中心」入口；
- Agent 侧出现 `doc_read` / `doc_edit` / `doc_create` 工具。

> 持久化部署：如需随 Harness 启动自动加载，可将两端源码迁移为静态插件包
> （`dsh-web-ui` 全家桶风格），或放入 `~/.dsh/.agent-presets` 对应的预设中。

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
