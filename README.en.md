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
| Markup & rich text | `.md` `.html` | Markdown: **edit/preview dual mode** — preview renders headings, lists, code blocks, tables and images, with support for relative images and relative links; HTML: **sandboxed preview** (CSP disables scripts + iframe `sandbox` attribute, double isolation) + source view + **open in new tab** (`unidoc.openExternal`) |
| Static assets & layout | `.png .jpg .jpeg .gif .svg .webp .pdf` | Images scale to fit; PDF embedded browser viewer (paging / zoom provided natively by the browser) |
| Data science (exploratory) | `.ipynb` | Read-only notebook preview: Markdown cell rendering + code cell highlighting + text output |
| Plain text fallback | `.log .csv .txt` and any unclassified text | CSV rendered as a table; everything else opens as **read-only plain text** — unknown extensions never crash |
| Explicitly unsupported | Audio/video (`.mp4 .mp3` etc.), iWork (`.pages .numbers .key`), CAD (`.dwg`), OpenPencil (`.op`) | Friendly "preview not supported" notice with file info |

### 2. UI Entry Points

- **Sidebar bottom** icon-only button (`sidebar.footer.action`, Font Awesome `fa-file-pen`) — toggles the workbench;
- **Fullscreen workbench** (`shell.overlay`):
  - Top toolbar shows the title and the **current workspace root path** (auto-detected from the DSH session; switching agents/sessions is sensed — on open the root is refreshed first and the tree reloads, then a 5s poll keeps them in sync; after a switch the tree is **fully reset**: cache cleared, expanded state, selected path and scroll position reset to the root, preview closed, so the top path and the tree always match);
  - Left file area: the file tree shows the workspace root at the top; lazy loading, click-to-expand directories, file sizes, **Font Awesome file icons by extension**; **"Expand All"** recursively opens every directory including hidden ones (`.git`, `.github`, `.vscode`, `node_modules` …), loading asynchronously in batches without freezing the page; **"Collapse All"** collapses everything and frees the cache; refresh / expand-all / collapse-all / options / close buttons sit below the tree (bottom-left);
  - Right preview/edit panel: every toolbar has an "Open Externally" button (**click → editor picker menu → choose → open**, remembering your last choice); HTML preview also has an "Open in New Tab" button (`unidoc.openExternal`);
- **Runtime card** (`tool.view.cordis`): shows the plugin's activation state with a one-click open button;
- **Toast feedback**: loading state, save success/failure notices;
- **Options panel** (session-level in-memory config): code editing toggle, Markdown dual-mode toggle, "not supported" notice card toggle, and an **editable external editor list** (add / remove / rename; defaults: VS Code, Sublime Text, Atom, Notepad++, Vim, Neovim, Typora).

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
  - **Root directory resolution** (multi-level candidates, duplicate `cwd` collapsed, first existing directory wins):
    1. The initiating agent's session `cwd` (`agents.currentInitiator()` → `session.header.cwd`) — only valid in agent tool-call contexts; browser RPCs run outside the initiator boundary and yield `undefined`;
    2. **The most recently created session's** `cwd` (`sessionQuery.listSessions()`, newest-first, ordered by `createdAt` desc) — the primary signal for browser RPCs: after a workspace switch (new/activated session) the newest session is the current workspace;
    3. Session `cwd` from the online agent list (`agents.list()`, registration order — old first, new last) — iterated **newest-registered first**, consistent with "recent session first", avoiding a stale online agent from the workspace you just left;
    4. Fallback to `sandboxPolicy.workspaceRoot` (re-read dynamically each time).
    Tool execution additionally honors the caller agent's (`exec.agent`) session `cwd` to precisely target the current workspace;
    `unidoc.root` accepts `refresh: true` to drop the cache and re-resolve, letting the client sense workspace switches.
  - **Write policy**: the plugin-context fs backend's default sandbox root is not the session workspace, so all write paths (save / create / edit) explicitly pass a `SandboxExecutionPolicy` (`workspaceRoot` = resolved workspace); tool calls respect session-mode overrides, e.g. `read-only` sessions reject writes;
  - Client RPC: `unidoc.root` / `unidoc.list` / `unidoc.read` / `unidoc.save` / `unidoc.create`
    / `unidoc.openExternal` (returns a raw-route URL for opening in a new tab) / `unidoc.openWithEditor`
    (`child_process.spawn` for the external editor: `editorCmd` strictly validated, path guarded by `fs.contains`,
    `detached` + `stdio: ignore` + `unref` so the host is never blocked)
  - HTTP routes (random prefix, auto-reclaimed via `ctx.effect`): `GET <rawPrefix>?p=<relative path>` serves raw bytes for images / PDF / HTML, attaching `Content-Security-Policy` (no scripts / no connections) and `X-Content-Type-Options: nosniff` to HTML responses
  - Registers 3 dynamic tools via `harness.defineTool` + `harness.registerTool`, mounted on the plugin Fiber (`ctx.effect`) and auto-unregistered on stop / update
- **Client side** (`src/client.js`, runs in the browser page)
  - Dependency declaration: `inject: ['slots', 'timer']`
  - Pure `React.createElement` (no JSX, no bundler); styles injected via `styles.insert` using `--dsw-alias-*` theme tokens (auto-adapts to light/dark themes)
  - Self-built lightweight Markdown renderer and code tokenizer/highlighter (inline parsing fully escaped, XSS-safe)
  - File-tree icons embed official Font Awesome 6 Free Solid SVG paths mapped by extension (no FA font required in the GUI); the entry icon is `fa-file-pen`
  - Workspace awareness: syncs via `unidoc.root(refresh)` on open and every 5s, fully resetting the tree (cache, expanded state, selected path, scroll position) and reloading the current workspace's files on switches; the host candidate order was reworked to "recent session first", fixing the case where `agents.currentInitiator()` is unavailable to browser RPCs and the root resolved to a stale online agent from the old workspace; "Expand All" loads recursively in async batches (hidden directories included) without freezing on huge repos
  - All file I/O goes through `host.call` to the host side; never touches page globals directly

### Lifecycle

- On plugin stop / update / removal: tool registrations, HTTP routes, slot registrations, styles and timers are all auto-reclaimed (Cordis Fiber effects & disposer mechanism);
- The Document Center's open state and options are **session-level in-memory state**, cleared when the plugin unloads (dynamic plugins are not persisted to disk).

---

## Installation & Running

This repository is the **source & documentation repo** for dsh-unidoc; the plugin is published as a DSH
**static Cordis plugin package** (`lib/` build artifacts are committed with the repo), and can also be
installed directly as a DSH profile dependency:

```bash
# Install as a DSH profile dependency (lib/ ships in the package; prepare also builds automatically)
npm install git+https://github.com/Che-Year/dsh-unidoc
```

Development (source → artifacts):

```bash
# 1. Install build deps (esbuild)
npm install

# 2. Syntax smoke check (isomorphic with DSH define-time preflight)
npm run check

# 3. Build artifacts into lib/ (esbuild bundles the host + custom bundler for the client)
npm run build

# 4. Deploy into a session: submit both sides' source with cordis_define (code.host / code.client),
#    then activate with cordis_run (client-side activation requires approval on first run)
```

After activation:
- An icon-only entry (Font Awesome file-pen) appears at the bottom of the sidebar;
- The `doc_read` / `doc_edit` / `doc_create` tools appear on the agent side.

> Persistent deployment: to auto-load with Harness startup, migrate both sides' source
> into a static plugin package (dsh-web-ui family style), or place it into the
> corresponding preset under `~/.dsh/.agent-presets`.

---

## Configuration

External editors are configured as a **list** (session-level in-memory state, cleared when the plugin unloads):

- Open the Document Center → "⚙ Options" (bottom-left) → "External editor list";
- Built-in defaults: VS Code (`code`), Sublime Text (`subl`), Atom (`atom`), Notepad++ (`notepad++`), Vim (`vim`), Neovim (`nvim`), Typora (`typora`);
- Add / remove / rename entries freely: edit name & command per row, ✕ removes, the bottom "＋" adds a new editor;
- Clicking "Open Externally" on any toolbar pops up the editor picker; choosing one calls `unidoc.openWithEditor` and **remembers your last choice** as the default for next time;
- Command constraints: a bare command name or an executable path only (no spaces, no shell metacharacters), and it must be on the system `PATH` (e.g. VSCode's `code` requires "Install 'code' command" first); target file paths are always guarded by `fs.contains` against directory traversal.

---

## Changelog

| Version | Highlights |
| --- | --- |
| v0.3.3 | **Fixed: tree still showing the old workspace after a switch (root cause)** — browser RPCs run outside the agent initiator boundary, so `agents.currentInitiator()` was unavailable and `agents.list()` hit a stale online agent from the workspace you just left; the host root resolution was reworked to "recent session first" (newest session → online agents newest-first → dynamic fallback root), and the tree / path state is fully reset on refresh and workspace switches |
| v0.3.2 | **Faster workspace-switch sensing + full tree reset** — runtime polling shortened to 5s; after a workspace switch the tree is fully reset (cache cleared, expanded state, selected path and scroll position reset to the root, preview closed) with a "workspace switched, tree refreshed" toast |
| v0.3.1 | **Fixed: file tree not refreshing after a workspace switch** — reopening the Document Center after switching agents/sessions now resets and reloads the tree with the new workspace's files, with no stale data left behind; the top path and the tree stay consistent |
| v0.3.0 | Workspace detection & display; file-tree "Expand All / Collapse All" (hidden dirs included); external editor picker menu with an editable editor list; icon-only sidebar entry with the Font Awesome `fa-file-pen` icon |
| v0.2.0 | Open HTML preview in a new tab; external editor integration (RPC + command config); Font Awesome file icons by extension in the tree; fixed missing `lib/` on git install that broke startup |
| v0.1.0 | Initial release: Document Center workbench (file tree + multi-format preview/edit + save), agent tools `doc_read` / `doc_edit` / `doc_create` |

Full details in [CHANGELOG.md](./CHANGELOG.md).

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
