# dsh-unidoc — Universal Document Center

🌐 [中文](./README.md) | **English**

> A document preview / edit / management plugin for DeepSeek Harness. It provides a
> VSCode-style "Document Center" workbench inside the DSH Web GUI: a file tree on the
> left, click-to-preview, editable code & Markdown with `Ctrl/Cmd+S` save; and exposes
> three document tools (`doc_read` / `doc_edit` / `doc_create`) to agents, letting
> models read and write workspace documents through natural language.

---

## Feature Overview

### 1. File Preview & Editing (acceptance criteria mapping)

| Category | Formats | Implementation |
| --- | --- | --- |
| Office documents (read-only) | `.docx` `.xlsx` `.pptx` | Metadata + friendly "preview not supported yet" notice card (Office preview kernel not loaded) |
| Code & config | `.py .java .go .rs .cpp .c .js .ts .jsx .tsx .json .yaml .yml .toml .xml .ini .conf` etc. | Lightweight syntax highlighting (keywords / strings / comments / numbers) + editing + `Ctrl/Cmd+S` save + Tab indentation + bracket auto-pairing |
| Markup & rich text | `.md` `.html` | Markdown: **edit/preview dual mode** — preview renders headings, lists, code blocks, tables and images, with support for relative images and relative links; HTML: **sandboxed preview** (CSP disables scripts + iframe `sandbox` attribute, double isolation) + source view |
| Static assets & layout | `.png .jpg .jpeg .gif .svg .webp .pdf` | Images scale to fit; PDF embedded browser viewer (paging / zoom provided natively by the browser) |
| Data science (exploratory) | `.ipynb` | Read-only notebook preview: Markdown cell rendering + code cell highlighting + text output |
| Plain text fallback | `.log .csv .txt` and any unclassified text | CSV rendered as a table; everything else opens as **read-only plain text** — unknown extensions never crash |
| Explicitly unsupported | Audio/video (`.mp4 .mp3` etc.), iWork (`.pages .numbers .key`), CAD (`.dwg`), OpenPencil (`.op`) | Friendly "preview not supported" notice with file info |

### 2. UI Entry Points

- **Sidebar bottom** "📄 Document Center" button (`sidebar.footer.action`) — toggles the workbench;
- **Fullscreen workbench** (`shell.overlay`): top toolbar (root directory, refresh, options, close), left file tree (lazy loading, directory expansion, file size), right preview/edit panel;
- **Runtime card** (`tool.view.cordis`): shows the plugin's activation state with a one-click open button;
- **Toast feedback**: loading state, save success/failure notices;
- **Options panel** (session-level in-memory config): code editing toggle, Markdown dual-mode toggle, "not supported" notice card toggle.

### 3. Agent Tools

| Tool | Description |
| --- | --- |
| `doc_read` | Read a document/code file by path (supports `offset`/`limit` for line-based reads of large files; binary files return file info) |
| `doc_edit` | Replace the **unique** occurrence of `old_string` with `new_string` in a file and save atomically (0 or multiple matches both fail with a clear message) |
| `doc_create` | Create a new file in the workspace (no overwrite by default; `overwrite=true` allows overwriting) |

All paths are relative to the Document Center root (the current session workspace) and
are validated with `fs.contains` to prevent directory traversal.

---

## Technical Architecture

### Dual-end structure (DSH dynamic Cordis plugin)

- **Host side** (`src/host.js`, runs in the DSH Node process)
  - Dependency declaration: `inject: ['fs', 'webServer', 'sandboxPolicy']`
  - **Root directory resolution** (multi-level candidates, first existing directory wins):
    1. The initiating agent's session `cwd` (`agents.currentInitiator()` → `session.header.cwd`);
    2. Session `cwd` from the online agent list (`agents.list()`);
    3. `cwd` from recent session records (`sessionQuery.listSessions()`, newest-first);
    4. Fallback to `sandboxPolicy.workspaceRoot`.
    Tool execution additionally honors the caller agent's (`exec.agent`) session `cwd` to precisely target the current workspace.
  - **Write policy**: the plugin-context fs backend's default sandbox root is not the session workspace, so all write paths (save / create / edit) explicitly pass a `SandboxExecutionPolicy` (`workspaceRoot` = resolved workspace); tool calls respect session-mode overrides, e.g. `read-only` sessions reject writes;
  - Client RPC: `unidoc.root` / `unidoc.list` / `unidoc.read` / `unidoc.save` / `unidoc.create`
  - HTTP routes (random prefix, auto-reclaimed via `ctx.effect`): `GET <rawPrefix>?p=<relative path>` serves raw bytes for images / PDF / HTML, attaching `Content-Security-Policy` (no scripts / no connections) and `X-Content-Type-Options: nosniff` to HTML responses
  - Registers 3 dynamic tools via `harness.defineTool` + `harness.registerTool`, mounted on the plugin Fiber (`ctx.effect`) and auto-unregistered on stop / update
- **Client side** (`src/client.js`, runs in the browser page)
  - Dependency declaration: `inject: ['slots', 'timer']`
  - Pure `React.createElement` (no JSX, no bundler); styles injected via `styles.insert` using `--dsw-alias-*` theme tokens (auto-adapts to light/dark themes)
  - Self-built lightweight Markdown renderer and code tokenizer/highlighter (inline parsing fully escaped, XSS-safe)
  - All file I/O goes through `host.call` to the host side; never touches page globals directly

### Lifecycle

- On plugin stop / update / removal: tool registrations, HTTP routes, slot registrations, styles and timers are all auto-reclaimed (Cordis Fiber effects & disposer mechanism);
- The Document Center's open state and options are **session-level in-memory state**, cleared when the plugin unloads (dynamic plugins are not persisted to disk).

---

## Installation & Running

This repository is the **source & documentation repo** for dsh-unidoc; the plugin itself is
deployed as a DSH **dynamic Cordis plugin** into a running Harness session (managed via
`cordis_define` / `cordis_run`). The source lives in `src/host.js` and `src/client.js`.

```bash
# 1. Syntax smoke check (isomorphic with DSH define-time preflight)
node scripts/check.js

# 2. Deploy into a session: submit both sides' source with cordis_define (code.host / code.client),
#    then activate with cordis_run (client-side activation requires approval on first run)
```

After activation:
- A "📄 Document Center" entry appears at the bottom of the sidebar;
- The `doc_read` / `doc_edit` / `doc_create` tools appear on the agent side.

> Persistent deployment: to auto-load with Harness startup, migrate both sides' source
> into a static plugin package (dsh-web-ui family style), or place it into the
> corresponding preset under `~/.dsh/.agent-presets`.

---

## Development & Testing

- `node scripts/check.js`: syntax smoke test for both sides' source;
- `tests/verification.md`: manual E2E verification checklist (mounting, file tree, per-format preview, saving, Toasts, tool calls, edge cases);
- Development conventions: never modify any official source under `~/.dsh/source/current/`; mount capabilities only through the official dynamic-plugin mechanism; reuse official Service/Slot capabilities (`fs`, `webServer`, `slots`, `timer`).

---

## Origin & License

This plugin builds on / reuses the architecture of `dsh-better-sidebar`; thanks to the original author.

- This plugin is released under the **MIT License**; the `LICENSE` file retains the full copyright notices and license terms of the upstream projects (`dsh-better-sidebar` and the DSH core framework, both MIT-licensed);
- This repository never modifies, copies, or mixes in any official source under `~/.dsh/source/current/`; capabilities are only mounted at runtime through the official DSH dynamic-plugin mechanism, avoiding derivative-work confusion and compliance risks.
