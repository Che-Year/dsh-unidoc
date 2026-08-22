/* ============================================================================
 * dsh-unidoc — Client half
 * 通用文档中心（Universal Document Center）工作台：
 *   - 侧边栏底部「文档中心」入口（sidebar.footer.action）
 *   - 全屏工作台（shell.overlay）：文件树 + 多格式预览/编辑 + Toast
 *   - 文件树图标：按扩展名映射 Font Awesome 图标（内嵌官方 SVG path）
 *   - HTML 预览「新标签页打开」（unidoc.openExternal）+ 各视图「外部编辑器打开」
 *     （unidoc.openWithEditor，命令可在选项面板配置）
 *   - 运行卡片状态面板（tool.view.cordis key self）
 *
 * 纯 React.createElement（无 JSX），不依赖 window/document 全局；
 * 定时器走 timer 服务；文件 IO 全部经 host.call 到 Host 半端。
 * ========================================================================== */

return {
  name: 'dsh-unidoc',
  inject: ['slots', 'timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    const timer = ctx.get('timer')
    if (!slots || !timer) return

    /* ---------------- 包级样式 ---------------- */
    styles.insert(`
.udc-root{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#1b1f27);color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;line-height:1.5;pointer-events:auto;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
.udc-header{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2f3a);background:var(--dsw-alias-bg-layer-1,#222733);flex:none;position:relative}
.udc-footer-label{font-size:12.5px}
.udc-title{font-weight:600;font-size:14px;white-space:nowrap}
.udc-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#9aa4b2);font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:12px}
.udc-header-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2,#3a4150);color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
.udc-header-btn:hover{background:var(--dsw-alias-bg-layer-2,#2b3240);border-color:var(--dsw-alias-brand-primary,#4f8cff)}
.udc-header-btn-active{background:var(--dsw-alias-bg-layer-2,#2b3240);border-color:var(--dsw-alias-brand-primary,#4f8cff)}
.udc-body{flex:1;display:flex;min-height:0}
.udc-side{width:280px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1,#2a2f3a);background:var(--dsw-alias-bg-layer-1,#222733)}
.udc-tree{flex:1;min-height:0;overflow:auto;background:var(--dsw-alias-bg-layer-1,#222733)}
.udc-actions-bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1,#2a2f3a);position:relative}
.udc-tree-header{padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4b2);border-bottom:1px solid var(--dsw-alias-border-l1,#2a2f3a);display:flex;align-items:center;gap:6px}
.udc-row{display:flex;align-items:center;gap:5px;padding:3px 8px;cursor:pointer;user-select:none;white-space:nowrap}
.udc-row:hover{background:var(--dsw-alias-bg-layer-2,#2b3240)}
.udc-row-active{background:var(--dsw-alias-bg-layer-2,#2b3240);color:var(--dsw-alias-brand-primary,#4f8cff)}
.udc-arrow{width:12px;flex:none;color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:10px}
.udc-ico{flex:none;font-size:12px;display:inline-flex;align-items:center}
.udc-ico svg{display:block}
.udc-name{overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
.udc-size{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa4b2);padding-left:8px}
.udc-loading{color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:12px;padding:12px;text-align:center}
.udc-preview{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#1b1f27)}
.udc-preview-empty,.udc-preview-loading,.udc-preview-error{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:13px;padding:24px;text-align:center}
.udc-preview-error{color:var(--dsw-alias-state-error-primary,#ff6b6b)}
.udc-viewbar{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2f3a);background:var(--dsw-alias-bg-layer-1,#222733);flex:none}
.udc-viewbar-file{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.udc-viewbar-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa4b2);white-space:nowrap}
.udc-viewbar-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2,#3a4150);color:var(--dsw-alias-label-secondary,#9aa4b2);border-radius:6px;padding:2px 10px;font-size:12px;cursor:pointer}
.udc-viewbar-btn:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}
.udc-viewbar-btn-active{color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-brand-primary,#4f8cff);background:var(--dsw-alias-bg-layer-2,#2b3240)}
.udc-save-btn{background:var(--dsw-alias-brand-primary,#4f8cff);border:none;color:#fff;border-radius:6px;padding:2px 12px;font-size:12px;cursor:pointer}
.udc-save-btn:hover{filter:brightness(1.1)}
.udc-save-btn:disabled{opacity:.45;cursor:default}
.udc-editor{flex:1;width:100%;box-sizing:border-box;border:none;outline:none;resize:none;padding:14px;background:var(--dsw-alias-bg-base,#1b1f27);color:var(--dsw-alias-label-primary,#e6e6e6);font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:13px;line-height:1.6;tab-size:2}
.udc-code{flex:1;overflow:auto;padding:12px 0;margin:0;font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:13px;line-height:1.6}
.udc-code-line{display:flex;padding:0 12px}
.udc-code-line:hover{background:var(--dsw-alias-bg-layer-1,#222733)}
.udc-line-no{flex:none;width:42px;text-align:right;padding-right:14px;color:var(--dsw-alias-label-secondary,#9aa4b2);user-select:none}
.udc-tok-keyword{color:#c586c0}
.udc-tok-string{color:#ce9178}
.udc-tok-comment{color:#6a9955;font-style:italic}
.udc-tok-number{color:#b5cea8}
.udc-md{flex:1;overflow:auto;padding:20px 28px;font-size:14px}
.udc-md h1,.udc-md h2,.udc-md h3,.udc-md h4,.udc-md h5,.udc-md h6{margin:1em 0 .5em;line-height:1.3}
.udc-md h1{font-size:1.7em;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2f3a);padding-bottom:.3em}
.udc-md h2{font-size:1.4em}
.udc-md h3{font-size:1.2em}
.udc-md p{margin:.6em 0}
.udc-md ul,.udc-md ol{margin:.6em 0;padding-left:1.6em}
.udc-md li{margin:.2em 0}
.udc-md pre{background:var(--dsw-alias-bg-layer-1,#222733);border:1px solid var(--dsw-alias-border-l1,#2a2f3a);border-radius:8px;padding:12px 14px;overflow:auto;font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:12.5px;line-height:1.55}
.udc-md code{font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:12.5px;background:var(--dsw-alias-bg-layer-1,#222733);padding:1px 5px;border-radius:4px}
.udc-md pre code{background:none;padding:0}
.udc-md blockquote{border-left:3px solid var(--dsw-alias-border-l2,#3a4150);margin:.6em 0;padding:.2em 1em;color:var(--dsw-alias-label-secondary,#9aa4b2)}
.udc-md table{border-collapse:collapse;margin:.8em 0;font-size:13px}
.udc-md th,.udc-md td{border:1px solid var(--dsw-alias-border-l2,#3a4150);padding:5px 12px;text-align:left}
.udc-md th{background:var(--dsw-alias-bg-layer-1,#222733)}
.udc-md hr{border:none;border-top:1px solid var(--dsw-alias-border-l2,#3a4150);margin:1.2em 0}
.udc-md-img{max-width:100%;height:auto;border-radius:6px}
.udc-md-link{color:var(--dsw-alias-brand-primary,#4f8cff);cursor:pointer;text-decoration:none}
.udc-md-link:hover{text-decoration:underline}
.udc-html-frame{flex:1;width:100%;border:none;background:#fff}
.udc-csv-wrap{flex:1;overflow:auto;padding:16px 20px}
.udc-csv-table{border-collapse:collapse;font-size:12.5px;font-family:ui-monospace,Consolas,"Courier New",monospace}
.udc-csv-table th,.udc-csv-table td{border:1px solid var(--dsw-alias-border-l2,#3a4150);padding:4px 12px;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}
.udc-csv-table th{background:var(--dsw-alias-bg-layer-1,#222733);position:sticky;top:0}
.udc-nb{flex:1;overflow:auto;padding:16px 24px}
.udc-nb-cell{margin:0 0 14px}
.udc-nb-cell-code{background:var(--dsw-alias-bg-layer-1,#222733);border:1px solid var(--dsw-alias-border-l1,#2a2f3a);border-radius:8px;overflow:auto;padding:10px 12px;font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:12.5px;line-height:1.55;white-space:pre}
.udc-nb-out{background:var(--dsw-alias-bg-layer-1,#222733);border-left:3px solid var(--dsw-alias-border-l2,#3a4150);padding:6px 12px;white-space:pre-wrap;font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4b2)}
.udc-nb-tag{display:inline-block;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa4b2);margin-bottom:4px}
.udc-card{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px;text-align:center}
.udc-card-ico{font-size:40px}
.udc-card-title{font-size:15px;font-weight:600}
.udc-card-desc{color:var(--dsw-alias-label-secondary,#9aa4b2);max-width:480px}
.udc-card-meta{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4b2);font-family:ui-monospace,Consolas,"Courier New",monospace}
.udc-img-wrap{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:20px}
.udc-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px}
.udc-pdf-wrap{flex:1;display:flex;flex-direction:column;min-height:0}
.udc-pdf-hint{padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4b2);border-bottom:1px solid var(--dsw-alias-border-l1,#2a2f3a);background:var(--dsw-alias-bg-layer-1,#222733)}
.udc-pdf-frame{flex:1;width:100%;border:none;background:#525659}
.udc-plain{flex:1;overflow:auto;padding:16px 20px;white-space:pre-wrap;font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:13px;line-height:1.6;margin:0}
.udc-badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#2b3240);color:var(--dsw-alias-label-secondary,#9aa4b2);border:1px solid var(--dsw-alias-border-l1,#2a2f3a)}
.udc-badge-warn{color:var(--dsw-alias-state-warn-primary,#d9a23f)}
.udc-toasts{position:absolute;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:10;pointer-events:none}
.udc-toast{background:var(--dsw-alias-bg-overlay,#262b36);border:1px solid var(--dsw-alias-border-l2,#3a4150);border-radius:8px;padding:8px 16px;font-size:12.5px;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:360px}
.udc-toast-success{border-left:3px solid var(--dsw-alias-state-success-primary,#3fb950)}
.udc-toast-error{border-left:3px solid var(--dsw-alias-state-error-primary,#ff6b6b)}
.udc-toast-info{border-left:3px solid var(--dsw-alias-brand-primary,#4f8cff)}
.udc-options-pop{position:absolute;bottom:calc(100% + 6px);left:0;background:var(--dsw-alias-bg-overlay,#262b36);border:1px solid var(--dsw-alias-border-l2,#3a4150);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;z-index:20;box-shadow:0 6px 24px rgba(0,0,0,.4);min-width:220px}
.udc-opt-row{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer}
.udc-opt-row input{cursor:pointer}
.udc-opt-input-row{flex-direction:column;align-items:stretch;gap:4px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,#2a2f3a)}
.udc-opt-label{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4b2)}
.udc-opt-input{background:var(--dsw-alias-bg-base,#1b1f27);border:1px solid var(--dsw-alias-border-l2,#3a4150);color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:6px;padding:4px 8px;font-size:12px;outline:none;font-family:ui-monospace,Consolas,"Courier New",monospace}
.udc-opt-input:focus{border-color:var(--dsw-alias-brand-primary,#4f8cff)}
.udc-footer-btn{display:flex;align-items:center;gap:6px;padding:4px 10px;background:transparent;border:none;color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:12.5px;cursor:pointer;border-radius:6px}
.udc-footer-btn:hover{color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-2,#2b3240)}
.udc-footer-btn-active{color:var(--dsw-alias-brand-primary,#4f8cff)}
.udc-footer-ico{font-size:13px}
.udc-runcard{padding:8px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.udc-runcard-title{font-weight:600}
.udc-runcard-btn{border:1px solid var(--dsw-alias-border-l2,#3a4150);background:var(--dsw-alias-bg-layer-2,#2b3240);color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:6px;padding:3px 12px;font-size:12px;cursor:pointer}
.udc-runcard-btn:hover{border-color:var(--dsw-alias-brand-primary,#4f8cff)}
.udc-runcard-hint{color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:12px}
`)

    /* ---------------- 会话级内存状态 ---------------- */
    const store = {
      open: false,
      root: '',
      rawPrefix: '',
      toasts: [],
      options: { codeEdit: true, mdPreview: true, unsupportedNotice: true, editorCmd: 'code' },
      listeners: new Set(),
    }
    let toastSeq = 0
    const notify = () => { for (const fn of [...store.listeners]) fn() }
    const subscribe = (fn) => { store.listeners.add(fn); return () => store.listeners.delete(fn) }
    const setOpen = (v) => { store.open = !!v; notify() }
    const pushToast = (text, type) => {
      const id = ++toastSeq
      store.toasts = [...store.toasts, { id, text, type: type || 'info' }]
      notify()
      timer.timeout(() => {
        store.toasts = store.toasts.filter((t) => t.id !== id)
        notify()
      }, 3200)
    }
    const setOption = (key, value) => { store.options = { ...store.options, [key]: value }; notify() }

    // 启动时获取根目录与原始字节路由前缀（Host 已先于 Client 激活）
    host.call('unidoc.root')
      .then((r) => {
        if (r && r.root) store.root = String(r.root)
        if (r && r.rawPrefix) store.rawPrefix = String(r.rawPrefix)
        notify()
      })
      .catch(() => {})

    const useStore = () => {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => subscribe(force), [])
      return store
    }

    /* ---------------- 工具函数 ---------------- */
    const extOf = (name) => {
      const b = String(name || '').split('/').pop() || ''
      const i = b.lastIndexOf('.')
      return i > 0 ? b.slice(i + 1).toLowerCase() : ''
    }
    const baseName = (name) => String(name || '').split('/').pop() || ''
    const dirOf = (name) => { const p = String(name || '').split('/'); p.pop(); return p.join('/') }
    const rawUrl = (rel) => (store.rawPrefix || '/dsh-unidoc/raw') + '?p=' + encodeURIComponent(String(rel))
    const fmtSize = (n) => (n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
    const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    const CODE_EXT = new Set(['py', 'java', 'go', 'rs', 'cpp', 'c', 'h', 'hpp', 'js', 'ts', 'jsx', 'tsx', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'css', 'scss', 'less', 'vue', 'svelte', 'kt', 'kts', 'rb', 'php', 'cs', 'swift', 'lua', 'r', 'dart'])
    const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown'])
    const HTML_EXT = new Set(['html', 'htm'])
    const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'])
    const OFFICE_EXT = new Set(['docx', 'xlsx', 'pptx'])
    const IWORK_EXT = new Set(['pages', 'numbers', 'key'])
    const CAD_EXT = new Set(['dwg', 'dxf'])
    const MEDIA_EXT = new Set(['mp4', 'mp3', 'mov', 'avi', 'wmv', 'flv', 'webm', 'mkv', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'])
    const UNSUPPORTED_EXT = new Set([...OFFICE_EXT, ...IWORK_EXT, ...CAD_EXT, ...MEDIA_EXT, 'op'])

    const unsupportedReason = (ext) => {
      if (OFFICE_EXT.has(ext)) return 'Office 文档（.' + ext + '）本期仅提供只读文件信息，在线预览需集成 Office 预览内核（暂未加载）。'
      if (ext === 'op') return 'OpenPencil（.op）为探索性集成格式，当前暂不支持预览。'
      if (IWORK_EXT.has(ext)) return 'Apple iWork 套件（.' + ext + '）暂不支持预览。'
      if (CAD_EXT.has(ext)) return 'CAD 工程文件（.' + ext + '）暂不支持预览。'
      if (MEDIA_EXT.has(ext)) return '音视频文件（.' + ext + '）暂不支持在线预览。'
      return '该格式暂不支持预览。'
    }

    /* ---------------- 外部编辑器 / 新标签页 ---------------- */
    const editorCmdOf = () => String(store.options.editorCmd || '').trim() || 'code'
    const openExternal = async (rel) => {
      try {
        const r = await host.call('unidoc.openExternal', { path: rel })
        if (r && r.url) {
          window.open(r.url, '_blank', 'noopener,noreferrer')
          pushToast('已在新标签页打开 ' + baseName(rel), 'success')
        } else {
          pushToast('打开失败：' + ((r && r.error) || '未知错误'), 'error')
        }
      } catch (e) {
        pushToast('打开失败：' + String((e && e.message) || e), 'error')
      }
    }
    const openWithEditor = async (rel) => {
      const cmd = editorCmdOf()
      try {
        const r = await host.call('unidoc.openWithEditor', { path: rel, editorCmd: cmd })
        if (r && r.ok) pushToast('已用外部编辑器打开 ' + baseName(rel), 'success')
        else pushToast('打开失败：' + ((r && r.error) || '未知错误'), 'error')
      } catch (e) {
        pushToast('打开失败：' + String((e && e.message) || e), 'error')
      }
    }
    const extEditorBtn = (rel) => React.createElement('button', {
      className: 'udc-viewbar-btn',
      title: '用外部编辑器打开当前文件（' + editorCmdOf() + '）',
      onClick: () => openWithEditor(rel),
    }, '外部打开')
    const newTabBtn = (rel) => React.createElement('button', {
      className: 'udc-viewbar-btn',
      title: '在新标签页打开当前文件',
      onClick: () => openExternal(rel),
    }, '新标签页')

    /* ---------------- 轻量语法高亮 ---------------- */
    const LANGS = {
      python: {
        kw: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None'.split(' '),
        line: '#', block: null, strings: [["'''", "'''"], ['"""', '"""'], ["'", "'", true], ['"', '"', true]], num: true,
      },
      javascript: {
        kw: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await true false null undefined'.split(' '),
        line: '//', block: ['/*', '*/'], strings: [['"', '"', true], ["'", "'", true], ['`', '`', true]], num: true,
      },
      java: {
        kw: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(' '),
        line: '//', block: ['/*', '*/'], strings: [['"', '"', true], ["'", "'", true]], num: true,
      },
      go: {
        kw: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false iota nil'.split(' '),
        line: '//', block: ['/*', '*/'], strings: [['"', '"', true], ['`', '`', true]], num: true,
      },
      rust: {
        kw: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(' '),
        line: '//', block: ['/*', '*/'], strings: [['"', '"', true], ["'", "'", true]], num: true,
      },
      cpp: {
        kw: 'alignas alignof and and_eq asm auto bitand bitor bool break case catch char class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq'.split(' '),
        line: '//', block: ['/*', '*/'], strings: [['"', '"', true], ["'", "'", true]], num: true,
      },
      c: {
        kw: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Imaginary true false'.split(' '),
        line: '//', block: ['/*', '*/'], strings: [['"', '"', true], ["'", "'", true]], num: true,
      },
      json: {
        kw: 'true false null'.split(' '), line: null, block: null, strings: [['"', '"', true]], num: true,
      },
      yaml: {
        kw: 'true false null yes no on off'.split(' '), line: '#', block: null, strings: [['"', '"', true], ["'", "'", true]], num: true,
      },
      toml: {
        kw: 'true false'.split(' '), line: '#', block: null, strings: [['"', '"', true], ["'", "'", true]], num: true,
      },
      ini: { kw: [], line: ';', block: null, strings: [], num: true },
      xml: {
        kw: [], line: null, block: null, xmlBlock: ['<!--', '-->'], strings: [['"', '"', true], ["'", "'", true]], num: false,
      },
      shell: {
        kw: 'if then else elif fi for while do done case esac function return local export readonly unset echo printf exit test true false'.split(' '),
        line: '#', block: null, strings: [['"', '"', true], ["'", "'", true], ['`', '`', true]], num: true,
      },
      sql: {
        kw: 'select from where insert into values update delete create table alter drop index view join inner left right full outer on group by order having limit as and or not null primary key foreign references unique default'.split(' '),
        line: '--', block: ['/*', '*/'], strings: [["'", "'", true], ['"', '"', true]], num: true,
      },
    }
    const LANG_BY_EXT = {
      py: 'python', js: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
      java: 'java', go: 'go', rs: 'rust', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', c: 'c', h: 'c',
      json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', conf: 'ini', cfg: 'ini',
      xml: 'xml', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell', sql: 'sql', html: 'xml',
    }
    const langFor = (ext) => LANG_BY_EXT[ext] || ''

    const tokenize = (src, lang) => {
      if (!lang) return [{ text: src, cls: '' }]
      const out = []
      let i = 0
      const n = src.length
      const push = (text, cls) => {
        if (!text) return
        const last = out[out.length - 1]
        if (last && last.cls === cls) last.text += text
        else out.push({ text, cls })
      }
      while (i < n) {
        const ch = src[i]
        if (lang.block && src.startsWith(lang.block[0], i)) {
          const end = src.indexOf(lang.block[1], i + lang.block[0].length)
          const j = end < 0 ? n : end + lang.block[1].length
          push(src.slice(i, j), 'comment'); i = j; continue
        }
        if (lang.xmlBlock && src.startsWith(lang.xmlBlock[0], i)) {
          const end = src.indexOf(lang.xmlBlock[1], i + lang.xmlBlock[0].length)
          const j = end < 0 ? n : end + lang.xmlBlock[1].length
          push(src.slice(i, j), 'comment'); i = j; continue
        }
        if (lang.line && src.startsWith(lang.line, i)) {
          const j = src.indexOf('\n', i)
          const k = j < 0 ? n : j
          push(src.slice(i, k), 'comment'); i = k; continue
        }
        let matched = false
        for (let si = 0; si < lang.strings.length; si++) {
          const s = lang.strings[si]
          if (!src.startsWith(s[0], i)) continue
          const esc = s[2] === true
          let j = i + s[0].length
          while (j < n) {
            if (esc && src[j] === '\\') { j += 2; continue }
            if (src.startsWith(s[1], j)) { j += s[1].length; break }
            j++
          }
          push(src.slice(i, Math.min(j, n)), 'string')
          i = j
          matched = true
          break
        }
        if (matched) continue
        if (/[A-Za-z_$]/.test(ch)) {
          let j = i
          while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++
          const word = src.slice(i, j)
          push(word, lang.kwSet && lang.kwSet.has(word) ? 'keyword' : '')
          i = j
          continue
        }
        if (lang.num && /[0-9]/.test(ch)) {
          let j = i
          if (src[j] === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X')) {
            j += 2
            while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++
          } else {
            while (j < n && /[0-9._a-zA-Z]/.test(src[j])) j++
          }
          push(src.slice(i, j), 'number')
          i = j
          continue
        }
        push(ch, '')
        i++
      }
      return out
    }
    // 每个 lang 配置编译一次 kwSet
    for (const key of Object.keys(LANGS)) LANGS[key].kwSet = new Set(LANGS[key].kw)

    // 高亮为「行 html」数组，用于带行号的只读代码视图
    const highlightLines = (code, lang) => {
      const cfg = LANGS[lang] || null
      const segs = tokenize(String(code), cfg)
      const rows = []
      let cur = []
      for (const seg of segs) {
        const parts = seg.text.split('\n')
        for (let p = 0; p < parts.length; p++) {
          if (p > 0) { rows.push(cur); cur = [] }
          if (parts[p]) cur.push({ text: parts[p], cls: seg.cls })
        }
      }
      rows.push(cur)
      return rows.map((row) => row
        .map((s) => (s.cls ? '<span class="udc-tok-' + s.cls + '">' + escapeHtml(s.text) + '</span>' : escapeHtml(s.text)))
        .join(''))
    }

    /* ---------------- Markdown 渲染（行解析 + 行内解析，全部转义防 XSS） ---------------- */
    const mdParse = (src) => {
      const lines = String(src).replace(/\r\n/g, '\n').split('\n')
      const blocks = []
      let i = 0
      const n = lines.length
      const isTableSep = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.indexOf('-') >= 0
      while (i < n) {
        const line = lines[i]
        const t = line.trim()
        if (!t) { i++; continue }
        const fm = t.match(/^```(\S*)\s*$/)
        if (fm) {
          const lang = fm[1]
          const buf = []
          i++
          while (i < n && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
          i++
          blocks.push({ type: 'code', lang, text: buf.join('\n') })
          continue
        }
        const hm = t.match(/^(#{1,6})\s+(.*)$/)
        if (hm) { blocks.push({ type: 'h' + hm[1].length, text: hm[2] }); i++; continue }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { blocks.push({ type: 'hr' }); i++; continue }
        if (/^>\s?/.test(t)) {
          const buf = []
          while (i < n && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
          blocks.push({ type: 'quote', text: buf.join('\n') })
          continue
        }
        if (/^[-*+]\s+/.test(t)) {
          const items = []
          while (i < n && /^[-*+]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-*+]\s+/, '')); i++ }
          blocks.push({ type: 'ul', items })
          continue
        }
        if (/^\d+\.\s+/.test(t)) {
          const items = []
          while (i < n && /^\d+\.\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+\.\s+/, '')); i++ }
          blocks.push({ type: 'ol', items })
          continue
        }
        if (t.indexOf('|') >= 0 && i + 1 < n && isTableSep(lines[i + 1])) {
          const rows = []
          while (i < n && lines[i].trim().indexOf('|') >= 0) { rows.push(lines[i]); i++ }
          const split = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
          const headers = split(rows[0])
          const body = rows.slice(2).map(split)
          blocks.push({ type: 'table', headers, rows: body })
          continue
        }
        const buf = [t]
        i++
        while (i < n) {
          const nx = lines[i].trim()
          if (!nx || /^(#{1,6}\s|```|>|[-*+]\s|\d+\.\s)/.test(nx)) break
          if (nx.indexOf('|') >= 0 && i + 1 < n && isTableSep(lines[i + 1])) break
          buf.push(nx)
          i++
        }
        blocks.push({ type: 'p', text: buf.join(' ') })
      }
      return blocks
    }

    const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|!\[[^\]\n]*\]\([^)\n]+\)|\[[^\]\n]+\]\([^)\n]+\))/g

    const inlineToReact = (text, keyPrefix, onOpenLink, baseDir) => {
      const parts = String(text).split(INLINE_RE)
      const out = []
      let k = 0
      for (const part of parts) {
        if (!part) continue
        const key = keyPrefix + ':' + k++
        if (part.length >= 2 && part[0] === '`' && part[part.length - 1] === '`') {
          out.push(React.createElement('code', { key }, part.slice(1, -1)))
        } else if (part.length >= 4 && part.startsWith('**') && part.endsWith('**')) {
          out.push(React.createElement('strong', { key }, part.slice(2, -2)))
        } else if (part.length >= 2 && part[0] === '*' && part[part.length - 1] === '*') {
          out.push(React.createElement('em', { key }, part.slice(1, -1)))
        } else if (part.startsWith('![')) {
          const m = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
          if (m) {
            const src = /^https?:\/\//i.test(m[2]) ? m[2] : rawUrl(baseDir ? baseDir + '/' + m[2] : m[2])
            out.push(React.createElement('img', { key, src, alt: m[1], className: 'udc-md-img' }))
          } else out.push(part)
        } else if (part.startsWith('[')) {
          const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
          if (m) {
            if (/^https?:\/\//i.test(m[2])) {
              out.push(React.createElement('a', { key, href: m[2], target: '_blank', rel: 'noopener noreferrer' }, m[1]))
            } else {
              out.push(React.createElement('a', {
                key, className: 'udc-md-link',
                onClick: () => { if (onOpenLink) onOpenLink(m[2]) },
              }, m[1]))
            }
          } else out.push(part)
        } else {
          out.push(part)
        }
      }
      return out
    }

    const mdBlockToReact = (b, i, onOpenLink, baseDir) => {
      const key = 'md:' + i
      switch (b.type) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          return React.createElement(b.type, { key }, ...inlineToReact(b.text, key, onOpenLink, baseDir))
        case 'p':
          return React.createElement('p', { key }, ...inlineToReact(b.text, key, onOpenLink, baseDir))
        case 'ul':
          return React.createElement('ul', { key }, b.items.map((it, j) =>
            React.createElement('li', { key: key + ':li:' + j }, ...inlineToReact(it, key + ':li:' + j, onOpenLink, baseDir))))
        case 'ol':
          return React.createElement('ol', { key }, b.items.map((it, j) =>
            React.createElement('li', { key: key + ':li:' + j }, ...inlineToReact(it, key + ':li:' + j, onOpenLink, baseDir))))
        case 'quote':
          return React.createElement('blockquote', { key }, ...inlineToReact(b.text, key, onOpenLink, baseDir))
        case 'code':
          return React.createElement('pre', { key, className: 'udc-md-code' },
            React.createElement('code', null, b.text))
        case 'table':
          return React.createElement('table', { key, className: 'udc-md-table' },
            React.createElement('thead', null,
              React.createElement('tr', null, b.headers.map((h, j) =>
                React.createElement('th', { key: key + ':h:' + j }, ...inlineToReact(h, key + ':h:' + j, onOpenLink, baseDir))))),
            React.createElement('tbody', null, b.rows.map((r, ri) =>
              React.createElement('tr', { key: key + ':r:' + ri }, r.map((c, ci) =>
                React.createElement('td', { key: key + ':c:' + ci }, ...inlineToReact(c, key + ':c:' + ci, onOpenLink, baseDir)))))))
        case 'hr':
          return React.createElement('hr', { key })
        default:
          return null
      }
    }

    const mdToReact = (src, onOpenLink, baseDir) =>
      mdParse(src).map((b, i) => mdBlockToReact(b, i, onOpenLink, baseDir))

    /* ---------------- CSV 解析 ---------------- */
    const parseCsv = (text) => {
      const lines = String(text).replace(/\r\n/g, '\n').split('\n')
      const rows = []
      let cur = []
      let field = ''
      let inQ = false
      const pushField = () => { cur.push(field); field = '' }
      const pushRow = () => { pushField(); rows.push(cur); cur = [] }
      for (const line of lines) {
        if (!inQ && line.trim() === '') continue
        for (let i = 0; i < line.length; i++) {
          const c = line[i]
          if (inQ) {
            if (c === '"') {
              if (line[i + 1] === '"') { field += '"'; i++ } else inQ = false
            } else field += c
          } else if (c === '"') {
            inQ = true
          } else if (c === ',') {
            pushField()
          } else {
            field += c
          }
        }
        pushRow()
      }
      return rows
    }

    /* ---------------- 组件：编辑器 ---------------- */
    const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }
    const CLOSE = { ')': '(', ']': '[', '}': '{' }

    function Editor(props) {
      const { initial, readOnly, innerRef, onSave, onDirty, placeholder } = props
      const [dirty, setDirty] = React.useState(false)
      const syncDirty = () => {
        setDirty(true)
        if (onDirty) onDirty(true)
      }
      const onKeyDown = (e) => {
        const el = innerRef && innerRef.current
        if (!el) return
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault()
          if (!readOnly && onSave) onSave(el.value)
          return
        }
        if (readOnly) return
        if (e.key === 'Tab') {
          e.preventDefault()
          const s = el.selectionStart, t = el.selectionEnd
          const v = el.value
          el.value = v.slice(0, s) + '  ' + v.slice(t)
          el.selectionStart = el.selectionEnd = s + 2
          syncDirty()
          return
        }
        if (e.key.length === 1 && el.selectionStart === el.selectionEnd) {
          const s = el.selectionStart
          const close = PAIRS[e.key]
          if (close) {
            e.preventDefault()
            const v = el.value
            el.value = v.slice(0, s) + e.key + close + v.slice(s)
            el.selectionStart = el.selectionEnd = s + 1
            syncDirty()
            return
          }
          const open = CLOSE[e.key]
          if (open && el.value[s] === e.key) {
            e.preventDefault()
            el.selectionStart = el.selectionEnd = s + 1
            return
          }
        }
      }
      return React.createElement('textarea', {
        ref: innerRef,
        defaultValue: initial,
        readOnly: !!readOnly,
        spellCheck: false,
        className: 'udc-editor',
        placeholder: placeholder || '',
        onKeyDown,
        onChange: syncDirty,
        onBlur: syncDirty,
      })
    }

    /* ---------------- 组件：只读高亮代码视图 ---------------- */
    function CodeViewHighlight(props) {
      const { code, lang } = props
      const rows = highlightLines(code, lang)
      return React.createElement('pre', { className: 'udc-code' },
        rows.map((html, i) =>
          React.createElement('div', { key: i, className: 'udc-code-line' },
            React.createElement('span', { className: 'udc-line-no' }, String(i + 1)),
            React.createElement('code', { dangerouslySetInnerHTML: { __html: html } }))))
    }

    /* ---------------- 组件：纯文本只读视图 ---------------- */
    function PlainText(props) {
      return React.createElement('pre', { className: 'udc-plain' }, props.text)
    }

    /* ---------------- 组件：不可用提示卡 ---------------- */
    function UnsupportedCard(props) {
      const { ext, name, size, reason } = props
      return React.createElement('div', { className: 'udc-card' },
        React.createElement('div', { className: 'udc-card-ico' }, '🚫'),
        React.createElement('div', { className: 'udc-card-title' }, '暂不支持预览'),
        React.createElement('div', { className: 'udc-card-desc' }, reason),
        React.createElement('div', { className: 'udc-card-meta' }, name + (size != null ? ' · ' + fmtSize(size) : '') + ' · .' + ext),
      )
    }

    function BinaryCard(props) {
      const { name, size } = props
      return React.createElement('div', { className: 'udc-card' },
        React.createElement('div', { className: 'udc-card-ico' }, '🗂️'),
        React.createElement('div', { className: 'udc-card-title' }, '无法以文本方式读取'),
        React.createElement('div', { className: 'udc-card-desc' }, '该文件为二进制或非 UTF-8 编码，文档中心未崩溃（纯文本兜底机制已生效）。'),
        React.createElement('div', { className: 'udc-card-meta' }, name + (size != null ? ' · ' + fmtSize(size) : '')),
      )
    }

    /* ---------------- 组件：代码/配置文件视图 ---------------- */
    function CodeView(props) {
      const { doc, current, options, onToast, onSaved } = props
      const [mode, setMode] = React.useState('view')
      const [dirty, setDirty] = React.useState(false)
      const editorRef = React.useRef(null)
      const canEdit = options.codeEdit
      const save = async () => {
        const el = editorRef.current
        const content = el ? el.value : doc.content
        try {
          const r = await host.call('unidoc.save', { path: current, content })
          if (r && r.ok) {
            onToast('已保存 ' + baseName(current), 'success')
            setDirty(false)
            if (onSaved) onSaved(content)
          } else {
            onToast('保存失败：' + ((r && r.error) || '未知错误'), 'error')
          }
        } catch (e) {
          onToast('保存失败：' + String((e && e.message) || e), 'error')
        }
      }
      const lang = langFor(extOf(current))
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'udc-viewbar' },
          React.createElement('span', { className: 'udc-viewbar-file' }, baseName(current)),
          React.createElement('span', { className: 'udc-viewbar-meta' }, fmtSize(doc.size) + ' · ' + (lang || extOf(current))),
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', {
            className: 'udc-viewbar-btn' + (mode === 'view' ? ' udc-viewbar-btn-active' : ''),
            onClick: () => setMode('view'),
          }, '高亮'),
          canEdit ? React.createElement('button', {
            className: 'udc-viewbar-btn' + (mode === 'edit' ? ' udc-viewbar-btn-active' : ''),
            onClick: () => setMode('edit'),
          }, '编辑') : null,
          canEdit ? React.createElement('button', {
            className: 'udc-save-btn',
            disabled: !dirty,
            onClick: save,
          }, '保存') : null,
          canEdit ? React.createElement('span', { className: 'udc-viewbar-meta' }, 'Ctrl/Cmd+S 保存') : null,
          extEditorBtn(current),
        ),
        mode === 'edit' && canEdit
          ? React.createElement(Editor, {
            key: 'edit-' + current,
            initial: doc.content,
            innerRef: editorRef,
            onSave: save,
            onDirty: () => setDirty(true),
            placeholder: '编辑 ' + baseName(current),
          })
          : React.createElement(CodeViewHighlight, { code: doc.content, lang }),
      )
    }

    /* ---------------- 组件：Markdown 视图（编辑/预览双模式） ---------------- */
    function MarkdownView(props) {
      const { doc, current, options, onToast, onOpenLink, onSaved } = props
      const [mode, setMode] = React.useState('preview')
      const [dirty, setDirty] = React.useState(false)
      const editorRef = React.useRef(null)
      const baseDir = dirOf(current)
      const canToggle = options.mdPreview
      const save = async (content) => {
        try {
          const r = await host.call('unidoc.save', { path: current, content })
          if (r && r.ok) {
            onToast('已保存 ' + baseName(current), 'success')
            setDirty(false)
            if (onSaved) onSaved(content)
          } else {
            onToast('保存失败：' + ((r && r.error) || '未知错误'), 'error')
          }
        } catch (e) {
          onToast('保存失败：' + String((e && e.message) || e), 'error')
        }
      }
      const saveFromEditor = () => {
        const el = editorRef.current
        if (el) save(el.value)
      }
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'udc-viewbar' },
          React.createElement('span', { className: 'udc-viewbar-file' }, baseName(current)),
          React.createElement('span', { className: 'udc-viewbar-meta' }, fmtSize(doc.size) + ' · Markdown'),
          React.createElement('span', { style: { flex: 1 } }),
          canToggle ? React.createElement('button', {
            className: 'udc-viewbar-btn' + (mode === 'preview' ? ' udc-viewbar-btn-active' : ''),
            onClick: () => setMode('preview'),
          }, '预览') : null,
          canToggle ? React.createElement('button', {
            className: 'udc-viewbar-btn' + (mode === 'edit' ? ' udc-viewbar-btn-active' : ''),
            onClick: () => setMode('edit'),
          }, '编辑') : null,
          canToggle && mode === 'edit' ? React.createElement('button', {
            className: 'udc-save-btn',
            disabled: !dirty,
            onClick: saveFromEditor,
          }, '保存') : null,
          canToggle && mode === 'edit' ? React.createElement('span', { className: 'udc-viewbar-meta' }, 'Ctrl/Cmd+S 保存') : null,
          extEditorBtn(current),
        ),
        mode === 'edit' && canToggle
          ? React.createElement(Editor, {
            key: 'md-' + current,
            initial: doc.content,
            innerRef: editorRef,
            onSave: save,
            onDirty: () => setDirty(true),
          })
          : React.createElement('div', { className: 'udc-md' }, ...mdToReact(doc.content, onOpenLink, baseDir)),
      )
    }

    /* ---------------- 组件：HTML 沙箱预览 ---------------- */
    function HtmlView(props) {
      const { doc, current } = props
      const [mode, setMode] = React.useState('preview')
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'udc-viewbar' },
          React.createElement('span', { className: 'udc-viewbar-file' }, baseName(current)),
          React.createElement('span', { className: 'udc-viewbar-meta' }, fmtSize(doc.size) + ' · HTML 沙箱预览'),
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', {
            className: 'udc-viewbar-btn' + (mode === 'preview' ? ' udc-viewbar-btn-active' : ''),
            onClick: () => setMode('preview'),
          }, '预览'),
          React.createElement('button', {
            className: 'udc-viewbar-btn' + (mode === 'source' ? ' udc-viewbar-btn-active' : ''),
            onClick: () => setMode('source'),
          }, '源码'),
          newTabBtn(current),
          extEditorBtn(current),
        ),
        mode === 'preview'
          ? React.createElement('iframe', {
            className: 'udc-html-frame',
            src: rawUrl(current),
            sandbox: '',
            title: '沙箱 HTML 预览（脚本已禁用）',
          })
          : React.createElement(CodeViewHighlight, { code: doc.content, lang: 'xml' }),
      )
    }

    /* ---------------- 组件：CSV 表格 ---------------- */
    function CsvView(props) {
      const { doc, current } = props
      const [mode, setMode] = React.useState('table')
      const rows = React.useMemo(() => parseCsv(doc.content), [doc.content])
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'udc-viewbar' },
          React.createElement('span', { className: 'udc-viewbar-file' }, baseName(current)),
          React.createElement('span', { className: 'udc-viewbar-meta' }, fmtSize(doc.size) + ' · CSV · ' + rows.length + ' 行'),
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', {
            className: 'udc-viewbar-btn' + (mode === 'table' ? ' udc-viewbar-btn-active' : ''),
            onClick: () => setMode('table'),
          }, '表格'),
          React.createElement('button', {
            className: 'udc-viewbar-btn' + (mode === 'raw' ? ' udc-viewbar-btn-active' : ''),
            onClick: () => setMode('raw'),
          }, '原文'),
          extEditorBtn(current),
        ),
        mode === 'table'
          ? React.createElement('div', { className: 'udc-csv-wrap' },
            React.createElement('table', { className: 'udc-csv-table' },
              React.createElement('tbody', null, rows.map((r, ri) =>
                React.createElement('tr', { key: ri },
                  r.map((c, ci) =>
                    React.createElement(ri === 0 ? 'th' : 'td', { key: ci, title: c }, c)))))))
          : React.createElement(PlainText, { text: doc.content }),
      )
    }

    /* ---------------- 组件：Jupyter Notebook（只读） ---------------- */
    function NotebookView(props) {
      const { doc, current, onOpenLink } = props
      let nb = null
      try { nb = JSON.parse(doc.content) } catch (e) { nb = null }
      if (!nb || !nb.cells) {
        return React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'udc-viewbar' },
            React.createElement('span', { className: 'udc-viewbar-file' }, baseName(current)),
            React.createElement('span', { className: 'udc-viewbar-meta' }, '· ipynb（JSON 解析失败，按纯文本展示）'),
            React.createElement('span', { style: { flex: 1 } }),
            extEditorBtn(current)),
          React.createElement(PlainText, { text: doc.content }),
        )
      }
      const cells = nb.cells || []
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'udc-viewbar' },
          React.createElement('span', { className: 'udc-viewbar-file' }, baseName(current)),
          React.createElement('span', { className: 'udc-viewbar-meta' }, fmtSize(doc.size) + ' · Jupyter Notebook · ' + cells.length + ' 个单元（只读）'),
          React.createElement('span', { style: { flex: 1 } }),
          extEditorBtn(current)),
        React.createElement('div', { className: 'udc-nb' },
          cells.map((cell, i) => {
            const key = 'nb:' + i
            if (cell.cell_type === 'markdown') {
              const text = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '')
              return React.createElement('div', { key, className: 'udc-nb-cell' },
                React.createElement('span', { className: 'udc-nb-tag' }, 'Markdown 单元'),
                ...mdToReact(text, onOpenLink, dirOf(current)))
            }
            const text = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '')
            const outs = (cell.outputs || []).filter((o) => o && o.text || o && o.data && o.data['text/plain'])
            return React.createElement('div', { key, className: 'udc-nb-cell' },
              React.createElement('span', { className: 'udc-nb-tag' }, '代码单元'),
              React.createElement('div', { className: 'udc-nb-cell-code' },
                React.createElement(CodeViewHighlight, { code: text, lang: langFor('py') })),
              outs.map((o, oi) => {
                const t = o.text ? (Array.isArray(o.text) ? o.text.join('') : String(o.text))
                  : (Array.isArray(o.data['text/plain']) ? o.data['text/plain'].join('') : String(o.data['text/plain']))
                return React.createElement('div', { key: key + ':out:' + oi, className: 'udc-nb-out' }, t)
              }))
          }),
        ),
      )
    }

    /* ---------------- 组件：文件树 ---------------- */
    function Tree(props) {
      const { current, onOpen, refreshKey } = props
      const [cache, setCache] = React.useState({})
      const [expanded, setExpanded] = React.useState({ '': true })
      const [loading, setLoading] = React.useState({})
      const load = async (rel, force) => {
        if (!force && cache[rel]) return
        setLoading((s) => ({ ...s, [rel]: true }))
        try {
          const r = await host.call('unidoc.list', { path: rel })
          if (r && r.ok) {
            const entries = (r.entries || []).slice().sort((a, b) => {
              if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
              return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
            })
            setCache((c) => ({ ...c, [rel]: entries }))
          } else {
            pushToast('加载目录失败：' + ((r && r.error) || '未知错误'), 'error')
          }
        } catch (e) {
          pushToast('加载目录失败', 'error')
        }
        setLoading((s) => ({ ...s, [rel]: false }))
      }
      React.useEffect(() => {
        setCache({})
        setExpanded({ '': true })
        setLoading({})
        load('', true)
      }, [refreshKey])
      const toggle = (rel) => {
        const next = { ...expanded, [rel]: !expanded[rel] }
        setExpanded(next)
        if (next[rel]) load(rel)
      }
      const rows = []
      const walk = (rel, depth) => {
        const entries = cache[rel] || []
        for (const e of entries) {
          const childRel = rel ? rel + '/' + e.name : e.name
          if (e.type === 'dir') {
            rows.push(React.createElement('div', {
              key: childRel,
              className: 'udc-row udc-row-dir',
              style: { paddingLeft: 8 + depth * 14 },
              onClick: () => toggle(childRel),
            },
              React.createElement('span', { className: 'udc-arrow' }, expanded[childRel] ? '▾' : '▸'),
              React.createElement('span', { className: 'udc-ico' }, '📁'),
              React.createElement('span', { className: 'udc-name' }, e.name)))
            if (expanded[childRel]) walk(childRel, depth + 1)
          } else {
            rows.push(React.createElement('div', {
              key: childRel,
              className: 'udc-row' + (current === childRel ? ' udc-row-active' : ''),
              style: { paddingLeft: 8 + depth * 14 },
              onClick: () => onOpen(childRel),
            },
              React.createElement('span', { className: 'udc-arrow' }, ''),
              faIconEl(extOf(e.name)),
              React.createElement('span', { className: 'udc-name' }, e.name),
              e.size != null ? React.createElement('span', { className: 'udc-size' }, fmtSize(e.size)) : null))
          }
        }
      }
      walk('', 0)
      return React.createElement('div', { className: 'udc-tree' },
        React.createElement('div', { className: 'udc-tree-header' },
          React.createElement('span', {}, '📂 工作区文件'),
          React.createElement('span', { style: { flex: 1 } }),
          loading[''] ? React.createElement('span', { className: 'udc-size' }, '加载中…') : null),
        ...rows)
    }

    /* ---------------- 文件树图标：Font Awesome 6 (Free Solid) ---------------- */
    // 映射表：扩展名 → FA 图标类 + 官方 SVG path（viewBox 384x512，file-pdf/file-csv 为 512x512）。
    // GUI 未内置 FA 字体，因此以官方 path 内嵌 SVG 渲染；cls 保留 FA 类名，便于后续接入 FA 字体。
    const FA = {
      file:       { cls: 'fa-solid fa-file', vb: '0 0 384 512', path: 'M0 64C0 28.7 28.7 0 64 0L224 0l0 128c0 17.7 14.3 32 32 32l128 0 0 288c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm384 64l-128 0L256 0 384 128z' },
      fileLines:  { cls: 'fa-solid fa-file-lines', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM112 256l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16z' },
      fileCode:   { cls: 'fa-solid fa-file-code', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM153 289l-31 31 31 31c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0L71 337c-9.4-9.4-9.4-24.6 0-33.9l48-48c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9zM265 255l48 48c9.4 9.4 9.4 24.6 0 33.9l-48 48c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l31-31-31-31c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0z' },
      fileImage:  { cls: 'fa-solid fa-file-image', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM64 256a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm152 32c5.3 0 10.2 2.6 13.2 6.9l88 128c3.4 4.9 3.7 11.3 1 16.5s-8.2 8.6-14.2 8.6l-88 0-40 0-48 0-48 0c-5.8 0-11.1-3.1-13.9-8.1s-2.8-11.2 .2-16.1l48-80c2.9-4.8 8.1-7.8 13.7-7.8s10.8 2.9 13.7 7.8l12.8 21.4 48.3-70.2c3-4.3 7.9-6.9 13.2-6.9z' },
      filePdf:    { cls: 'fa-solid fa-file-pdf', vb: '0 0 512 512', path: 'M0 64C0 28.7 28.7 0 64 0L224 0l0 128c0 17.7 14.3 32 32 32l128 0 0 144-208 0c-35.3 0-64 28.7-64 64l0 144-48 0c-35.3 0-64-28.7-64-64L0 64zm384 64l-128 0L256 0 384 128zM176 352l32 0c30.9 0 56 25.1 56 56s-25.1 56-56 56l-16 0 0 32c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-48 0-80c0-8.8 7.2-16 16-16zm32 80c13.3 0 24-10.7 24-24s-10.7-24-24-24l-16 0 0 48 16 0zm96-80l32 0c26.5 0 48 21.5 48 48l0 64c0 26.5-21.5 48-48 48l-32 0c-8.8 0-16-7.2-16-16l0-128c0-8.8 7.2-16 16-16zm32 128c8.8 0 16-7.2 16-16l0-64c0-8.8-7.2-16-16-16l-16 0 0 96 16 0zm80-112c0-8.8 7.2-16 16-16l48 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0 0 32 32 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0 0 48c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-64 0-64z' },
      fileZipper: { cls: 'fa-solid fa-file-zipper', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM96 48c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16zm0 64c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16zm0 64c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16zm-6.3 71.8c3.7-14 16.4-23.8 30.9-23.8l14.8 0c14.5 0 27.2 9.7 30.9 23.8l23.5 88.2c1.4 5.4 2.1 10.9 2.1 16.4c0 35.2-28.8 63.7-64 63.7s-64-28.5-64-63.7c0-5.5 .7-11.1 2.1-16.4l23.5-88.2zM112 336c-8.8 0-16 7.2-16 16s7.2 16 16 16l32 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-32 0z' },
      fileExcel:  { cls: 'fa-solid fa-file-excel', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM155.7 250.2L192 302.1l36.3-51.9c7.6-10.9 22.6-13.5 33.4-5.9s13.5 22.6 5.9 33.4L221.3 344l46.4 66.2c7.6 10.9 5 25.8-5.9 33.4s-25.8 5-33.4-5.9L192 385.8l-36.3 51.9c-7.6 10.9-22.6 13.5-33.4 5.9s-13.5-22.6-5.9-33.4L162.7 344l-46.4-66.2c-7.6-10.9-5-25.8 5.9-33.4s25.8-5 33.4 5.9z' },
      fileWord:   { cls: 'fa-solid fa-file-word', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM111 257.1l26.8 89.2 31.6-90.3c3.4-9.6 12.5-16.1 22.7-16.1s19.3 6.4 22.7 16.1l31.6 90.3L273 257.1c3.8-12.7 17.2-19.9 29.9-16.1s19.9 17.2 16.1 29.9l-48 160c-3 10-12 16.9-22.4 17.1s-19.8-6.2-23.2-16.1L192 336.6l-33.3 95.3c-3.4 9.8-12.8 16.3-23.2 16.1s-19.5-7.1-22.4-17.1l-48-160c-3.8-12.7 3.4-26.1 16.1-29.9s26.1 3.4 29.9 16.1z' },
      filePpt:    { cls: 'fa-solid fa-file-powerpoint', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM136 240l68 0c42 0 76 34 76 76s-34 76-76 76l-44 0 0 32c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-56 0-104c0-13.3 10.7-24 24-24zm68 104c15.5 0 28-12.5 28-28s-12.5-28-28-28l-44 0 0 56 44 0z' },
      fileVideo:  { cls: 'fa-solid fa-file-video', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM64 288c0-17.7 14.3-32 32-32l96 0c17.7 0 32 14.3 32 32l0 96c0 17.7-14.3 32-32 32l-96 0c-17.7 0-32-14.3-32-32l0-96zM300.9 397.9L256 368l0-64 44.9-29.9c2-1.3 4.4-2.1 6.8-2.1c6.8 0 12.3 5.5 12.3 12.3l0 103.4c0 6.8-5.5 12.3-12.3 12.3c-2.4 0-4.8-.7-6.8-2.1z' },
      fileAudio:  { cls: 'fa-solid fa-file-audio', vb: '0 0 384 512', path: 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zm2 226.3c37.1 22.4 62 63.1 62 109.7s-24.9 87.3-62 109.7c-7.6 4.6-17.4 2.1-22-5.4s-2.1-17.4 5.4-22C269.4 401.5 288 370.9 288 336s-18.6-65.5-46.5-82.3c-7.6-4.6-10-14.4-5.4-22s14.4-10 22-5.4zm-91.9 30.9c6 2.5 9.9 8.3 9.9 14.8l0 128c0 6.5-3.9 12.3-9.9 14.8s-12.9 1.1-17.4-3.5L113.4 376 80 376c-8.8 0-16-7.2-16-16l0-48c0-8.8 7.2-16 16-16l33.4 0 35.3-35.3c4.6-4.6 11.5-5.9 17.4-3.5zm51 34.9c6.6-5.9 16.7-5.3 22.6 1.3C249.8 304.6 256 319.6 256 336s-6.2 31.4-16.3 42.7c-5.9 6.6-16 7.1-22.6 1.3s-7.1-16-1.3-22.6c5.1-5.7 8.1-13.1 8.1-21.3s-3.1-15.7-8.1-21.3c-5.9-6.6-5.3-16.7 1.3-22.6z' },
    }
    // 按类别聚合扩展名（顺序即优先级）；未命中回退默认 file 图标
    const FA_BY_EXT = [
      { icon: FA.fileCode, exts: new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'kt', 'kts', 'rb', 'php', 'swift', 'lua', 'r', 'dart', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'css', 'scss', 'less', 'vue', 'svelte', 'html', 'htm', 'xml', 'json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'ipynb']) },
      { icon: FA.fileLines, exts: new Set(['md', 'markdown', 'mdown', 'txt', 'log', 'tex', 'rst', 'nfo', 'rtf', 'license', 'readme', 'gitignore', 'gitattributes', 'gitmodules', 'editorconfig', 'npmrc', 'dockerignore', 'env']) },
      { icon: FA.fileImage, exts: new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'tif', 'heic', 'psd']) },
      { icon: FA.filePdf, exts: new Set(['pdf']) },
      { icon: FA.fileExcel, exts: new Set(['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers']) },
      { icon: FA.fileWord, exts: new Set(['doc', 'docx', 'odt', 'pages']) },
      { icon: FA.filePpt, exts: new Set(['ppt', 'pptx', 'odp', 'key']) },
      { icon: FA.fileZipper, exts: new Set(['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'bz2', 'xz', 'iso', 'dmg', 'cab', 'jar']) },
      { icon: FA.fileVideo, exts: new Set(['mp4', 'mov', 'avi', 'wmv', 'flv', 'webm', 'mkv', 'm4v', 'mpg', 'mpeg', '3gp']) },
      { icon: FA.fileAudio, exts: new Set(['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'wma', 'mid', 'midi']) },
    ]
    const faFileIcon = (ext) => {
      for (const g of FA_BY_EXT) if (g.exts.has(ext)) return g.icon
      return FA.file
    }
    const faIconEl = (ext) => {
      const ico = faFileIcon(ext)
      return React.createElement('span', { className: 'udc-ico ' + ico.cls, title: ext || '文件' },
        React.createElement('svg', { viewBox: ico.vb, width: 12, height: 12, fill: 'currentColor', 'aria-hidden': true },
          React.createElement('path', { d: ico.path })))
    }

    /* ---------------- 组件：预览面板 ---------------- */
    function PreviewPane(props) {
      const { current, onOpenLink, refreshKey } = props
      const store = useStore()
      const [state, setState] = React.useState({ loading: false, doc: null, error: null })
      React.useEffect(() => {
        if (!current) {
          setState({ loading: false, doc: null, error: null })
          return
        }
        let alive = true
        setState({ loading: true, doc: null, error: null })
        host.call('unidoc.read', { path: current })
          .then((r) => {
            if (!alive) return
            if (r && r.ok) setState({ loading: false, doc: r })
            else setState({ loading: false, error: (r && r.error) || '读取失败' })
          })
          .catch((e) => {
            if (alive) setState({ loading: false, error: String((e && e.message) || e) })
          })
        return () => { alive = false }
      }, [current, refreshKey])

      if (!current) {
        return React.createElement('div', { className: 'udc-preview' },
          React.createElement('div', { className: 'udc-preview-empty' }, '从左侧文件树选择文件即可预览 / 编辑'))
      }
      if (state.loading) {
        return React.createElement('div', { className: 'udc-preview' },
          React.createElement('div', { className: 'udc-preview-loading' }, '⏳ 正在加载 ' + baseName(current) + ' …'))
      }
      if (state.error) {
        return React.createElement('div', { className: 'udc-preview' },
          React.createElement('div', { className: 'udc-preview-error' }, '读取失败：' + state.error))
      }
      const doc = state.doc
      if (!doc) return React.createElement('div', { className: 'udc-preview' })
      const ext = extOf(current)
      const name = baseName(current)

      const updateDocContent = (content) =>
        setState((s) => (s.doc ? { ...s, doc: { ...s.doc, content } } : s))

      let content = null
      if (doc.kind === 'binary') {
        if (IMAGE_EXT.has(ext)) {
          content = React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'udc-viewbar' },
              React.createElement('span', { className: 'udc-viewbar-file' }, name),
              React.createElement('span', { className: 'udc-viewbar-meta' }, fmtSize(doc.size) + ' · 图片（自适应缩放）'),
              React.createElement('span', { style: { flex: 1 } }),
              extEditorBtn(current)),
            React.createElement('div', { className: 'udc-img-wrap' },
              React.createElement('img', { className: 'udc-img', src: rawUrl(current), alt: name })))
        } else if (ext === 'pdf') {
          content = React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'udc-pdf-wrap' },
              React.createElement('div', { className: 'udc-viewbar' },
                React.createElement('span', { className: 'udc-viewbar-file' }, name),
                React.createElement('span', { className: 'udc-viewbar-meta' }, fmtSize(doc.size) + ' · PDF'),
                React.createElement('span', { style: { flex: 1 } }),
                React.createElement('span', { className: 'udc-viewbar-meta' }, '浏览器内置查看器：支持翻页与缩放'),
                extEditorBtn(current)),
              React.createElement('iframe', { className: 'udc-pdf-frame', src: rawUrl(current), title: name })))
        } else if (UNSUPPORTED_EXT.has(ext)) {
          content = React.createElement(UnsupportedCard, { ext, name, size: doc.size, reason: unsupportedReason(ext) })
        } else {
          content = React.createElement(BinaryCard, { name, size: doc.size })
        }
      } else {
        // 文本类
        if (MARKDOWN_EXT.has(ext)) {
          content = React.createElement(MarkdownView, { doc, current, options: store.options, onToast: pushToast, onOpenLink, onSaved: updateDocContent })
        } else if (HTML_EXT.has(ext)) {
          content = React.createElement(HtmlView, { doc, current })
        } else if (ext === 'csv') {
          content = React.createElement(CsvView, { doc, current })
        } else if (ext === 'ipynb') {
          content = React.createElement(NotebookView, { doc, current, onOpenLink })
        } else if (CODE_EXT.has(ext)) {
          content = React.createElement(CodeView, { doc, current, options: store.options, onToast: pushToast, onSaved: updateDocContent })
        } else {
          // 纯文本兜底：所有未归类但可读的文本文件
          content = React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'udc-viewbar' },
              React.createElement('span', { className: 'udc-viewbar-file' }, name),
              React.createElement('span', { className: 'udc-viewbar-meta' }, fmtSize(doc.size) + ' · 文本'),
              React.createElement('span', { style: { flex: 1 } }),
              React.createElement('span', { className: 'udc-badge' }, '只读纯文本'),
              extEditorBtn(current)),
            React.createElement(PlainText, { text: doc.content }))
        }
      }
      return React.createElement('div', { className: 'udc-preview' }, content)
    }

    /* ---------------- 组件：Toast ---------------- */
    function Toasts(props) {
      const { toasts } = props
      return React.createElement('div', { className: 'udc-toasts' },
        toasts.map((t) => React.createElement('div', { key: t.id, className: 'udc-toast udc-toast-' + t.type }, t.text)))
    }

    /* ---------------- 组件：文档中心工作台（shell.overlay） ---------------- */
    function DocumentCenter() {
      const store = useStore()
      const [current, setCurrent] = React.useState(null)
      const [refreshKey, setRefreshKey] = React.useState(0)
      const [showOptions, setShowOptions] = React.useState(false)
      if (!store.open) return null
      const openLink = (rel) => {
        const clean = String(rel || '').replace(/^\.\//, '').replace(/^\//, '')
        if (clean) setCurrent(clean)
      }
      // 布局：头部只保留标题与根目录路径；刷新/选项/关闭统一排列在左侧文件树
      // 下方（左下角），从根本上避免与其他插件悬浮按钮（如 better-sidebar 的
      // 折叠侧边栏图标）在右上角位置重合。
      return React.createElement('div', { className: 'udc-root' },
        React.createElement('div', { className: 'udc-header' },
          React.createElement('span', { className: 'udc-title' }, '📄 通用文档中心'),
          React.createElement('span', { className: 'udc-path', title: store.root }, store.root || '…'),
        ),
        React.createElement('div', { className: 'udc-body' },
          React.createElement('div', { className: 'udc-side' },
            React.createElement(Tree, { current, onOpen: setCurrent, refreshKey }),
            React.createElement('div', { className: 'udc-actions-bar' },
              React.createElement('button', { className: 'udc-header-btn', onClick: () => setRefreshKey((k) => k + 1) }, '↻ 刷新'),
              React.createElement('button', { className: 'udc-header-btn' + (showOptions ? ' udc-header-btn-active' : ''), onClick: () => setShowOptions(!showOptions) }, '⚙ 选项'),
              React.createElement('button', { className: 'udc-header-btn', onClick: () => setOpen(false) }, '✕ 关闭'),
              showOptions ? React.createElement('div', { className: 'udc-options-pop' },
                React.createElement('label', { className: 'udc-opt-row' },
                  React.createElement('input', { type: 'checkbox', checked: store.options.codeEdit, onChange: (e) => setOption('codeEdit', e.target.checked) }),
                  '代码/文本编辑（Ctrl/Cmd+S 保存）'),
                React.createElement('label', { className: 'udc-opt-row' },
                  React.createElement('input', { type: 'checkbox', checked: store.options.mdPreview, onChange: (e) => setOption('mdPreview', e.target.checked) }),
                  'Markdown 编辑/预览双模式'),
                React.createElement('label', { className: 'udc-opt-row' },
                  React.createElement('input', { type: 'checkbox', checked: store.options.unsupportedNotice, onChange: (e) => setOption('unsupportedNotice', e.target.checked) }),
                  '显示「暂不支持」格式提示卡'),
                React.createElement('div', { className: 'udc-opt-row udc-opt-input-row' },
                  React.createElement('label', { className: 'udc-opt-label', htmlFor: 'udc-editor-cmd' }, '外部编辑器命令'),
                  React.createElement('input', {
                    id: 'udc-editor-cmd',
                    className: 'udc-opt-input',
                    type: 'text',
                    value: store.options.editorCmd,
                    placeholder: 'code / notepad / 可执行文件路径',
                    spellCheck: false,
                    onChange: (e) => setOption('editorCmd', e.target.value),
                  })),
              ) : null,
            ),
          ),
          React.createElement(PreviewPane, { current, onOpenLink: openLink, refreshKey })),
        React.createElement(Toasts, { toasts: store.toasts }),
      )
    }

    /* ---------------- 组件：侧边栏底部入口 ---------------- */
    function FooterAction(props) {
      const store = useStore()
      return React.createElement('button', {
        className: 'udc-footer-btn' + (store.open ? ' udc-footer-btn-active' : ''),
        onClick: () => setOpen(!store.open),
        title: '通用文档中心（dsh-unidoc）',
      },
        React.createElement('span', { className: 'udc-footer-ico' }, '📄'),
        props.wide ? React.createElement('span', { className: 'udc-footer-label' }, '文档中心') : null)
    }

    /* ---------------- 组件：运行卡状态面板 ---------------- */
    function RunCard() {
      const store = useStore()
      return React.createElement('div', { className: 'udc-runcard' },
        React.createElement('span', { className: 'udc-runcard-title' }, '📄 dsh-unidoc 通用文档中心'),
        React.createElement('button', { className: 'udc-runcard-btn', onClick: () => setOpen(true) }, store.open ? '文档中心已打开' : '打开文档中心'),
        React.createElement('span', { className: 'udc-runcard-hint' }, '侧边栏底部入口 · Agent 工具 doc_read / doc_edit / doc_create 已注册'),
      )
    }

    /* ---------------- 注册到 Slot ---------------- */
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'unidoc.open', order: 20, label: '文档中心' },
      (props) => React.createElement(FooterAction, { wide: !!(props && props.wide) }),
    ))
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'unidoc.center', order: 60 },
      () => React.createElement(DocumentCenter, null),
    ))
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement(RunCard, null),
    ))

    console.log('dsh-unidoc: 客户端已挂载（sidebar.footer.action / shell.overlay / tool.view.cordis）')
  },
}
