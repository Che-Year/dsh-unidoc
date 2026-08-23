/* ============================================================================
 * dsh-unidoc — Host half
 * 通用文档中心（Universal Document Center）for DeepSeek Harness（动态 Cordis 插件）
 *
 * 能力：
 *   - Client RPC：unidoc.root / unidoc.list / unidoc.read / unidoc.save / unidoc.create
 *     / unidoc.openExternal（返回 raw 路由 URL 供新标签页打开）/ unidoc.openWithEditor
 *     （detached+unref 启动外部编辑器，editorCmd 严格校验、路径经 fs.contains）
 *   - HTTP 路由：GET /dsh-unidoc/raw?p=<相对路径>（图片 / PDF / HTML 原始字节，含安全响应头）
 *   - 动态 Agent 工具：doc_read / doc_edit / doc_create
 *
 * 根目录解析（优先级从高到低）：
 *   0) **Client hintCwd**（权威信号）：Client 端从运行时 sessions 服务读取
 *      「当前选中会话」的工作区 cwd，随 unidoc.root RPC 传入，Host 校验为目录后
 *      直接作为根目录——无论切换到新建会话还是早已创建的历史会话，都能精确命中
 *      当前工作区，杜绝「永远显示旧工作区 A」
 *   1) 当前发起者 Agent 的会话 cwd（agents.currentInitiator()）
 *      —— 仅在 Agent 工具调用上下文有效；浏览器 RPC（Client→Host）位于
 *         Agent 驱动链（initiator 边界）之外，此候选返回 undefined
 *   2) 在线 Agent 列表的会话 cwd（agents.list()，注册顺序）——
 *      从最新注册（末尾）向旧（开头）遍历，刚激活的会话最可能是当前工作区
 *   3) sessionQuery.listSessions() 中 **live 会话** 按 createdAt 降序——
 *      排除持久化「幽灵」会话（历史会话 createdAt 可能最大，却早已不是当前工作区）
 *   4) sessionQuery.listSessions() 全部（含 persisted）按 createdAt 降序
 *   5) 兜底：sandboxPolicy.workspaceRoot（每次动态读取，部署级 fallback）
 * 工具执行时额外以调用者 Agent（exec.agent）的会话 cwd 为准，保证精准命中当前工作区。
 *
 * 安全边界：所有路径解析都以工作区根目录为锚，经 fs.contains 校验，杜绝目录穿越；
 * 未知扩展名按文本尝试读取，读取失败一律降级为 binary，绝不崩溃。
 * ========================================================================== */

return {
  name: 'dsh-unidoc',
  inject: ['fs', 'webServer', 'sandboxPolicy'],
  apply(ctx) {
    const fs = ctx.get('fs')
    const webServer = ctx.get('webServer')
    const policy = ctx.get('sandboxPolicy')
    if (!fs || !webServer || !policy) {
      console.error('dsh-unidoc: 缺少必需服务（fs / webServer / sandboxPolicy）')
      return
    }

    // 兜底根目录每次解析时动态读取 policy.workspaceRoot（部署级 fallback，
    // 不随会话变化；不在此缓存，避免激活时捕获陈旧值）
    const RAW_PREFIX = '/dsh-unidoc/raw-' + Math.random().toString(36).slice(2, 8)

    /* ---------------- 常量与工具 ---------------- */
    // 明确为二进制的扩展名：直接返回 binary，不尝试按文本读取
    const BINARY_EXT = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'op',
      'pages', 'numbers', 'key', 'dwg', 'dxf', 'step', 'stp', 'iges', 'igs',
      'mp4', 'mp3', 'mov', 'avi', 'wmv', 'flv', 'webm', 'mkv', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus',
      'zip', 'tar', 'gz', '7z', 'rar', 'bz2', 'xz', 'iso', 'dmg',
      'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'sqlite3', 'class', 'jar', 'wasm',
      'pyc', 'pyd', 'woff', 'woff2', 'ttf', 'otf', 'eot',
    ])
    const MAX_RAW_BYTES = 64 * 1024 * 1024 // 原始路由单文件读取上限 64MB

    const extOf = (name) => {
      const base = String(name || '').split('/').pop() || ''
      const i = base.lastIndexOf('.')
      return i > 0 ? base.slice(i + 1).toLowerCase() : ''
    }

    /* ---------------- 根目录解析 ---------------- */
    // 候选顺序（同一 cwd 去重，取第一个真实存在的目录）——仅供浏览器 RPC 无
    // hintCwd（Client 未读到当前会话）时兜底：
    //   1) 当前发起者 Agent（仅 Agent 工具调用上下文有效）
    //   2) 在线 Agent 列表（注册顺序旧在前、新在后）——从最新注册向旧遍历，
    //      「刚激活的会话」最可能是当前工作区
    //   3) sessionQuery.listSessions() 中 **live 会话**（在线 Agent 所属）按
    //      createdAt 降序——排除持久化「幽灵」会话（历史会话可能 createdAt 最大，
    //      却早已不是当前工作区）
    //   4) sessionQuery.listSessions() 全部（含 persisted）按 createdAt 降序
    //   5) 兜底：sandboxPolicy.workspaceRoot（每次动态读取）
    const collectCandidates = async () => {
      const out = []
      const seen = new Set()
      const add = (p) => {
        if (!p || typeof p !== 'string') return
        const t = p.trim()
        if (t && !seen.has(t)) { seen.add(t); out.push(t) }
      }
      // 1) 当前发起者 Agent（仅 Agent 工具调用上下文有效；
      //    浏览器 RPC 位于 initiator 边界外，currentInitiator() 返回 undefined）
      try {
        const agentsSvc = ctx.get('agents')
        if (agentsSvc && typeof agentsSvc.currentInitiator === 'function') {
          const initiator = agentsSvc.currentInitiator()
          if (initiator && initiator.session && initiator.session.header) add(initiator.session.header.cwd)
        }
      } catch (e) { /* 忽略 */ }
      // 2) 在线 Agent 列表（注册顺序：旧在前、新在后）——
      //    从最新注册向旧遍历：刚激活 / 刚创建的会话 Agent 排在末尾
      try {
        const agentsSvc = ctx.get('agents')
        if (agentsSvc && typeof agentsSvc.list === 'function') {
          const list = agentsSvc.list()
          if (Array.isArray(list)) {
            for (let i = list.length - 1; i >= 0; i--) {
              const a = list[i]
              if (a && a.session && a.session.header) add(a.session.header.cwd)
            }
          }
        }
      } catch (e) { /* 忽略 */ }
      // 3) + 4) 最近创建的会话（newest-first，按 createdAt 降序）——
      //    live 在线会话优先，持久化「幽灵」会话排后（历史会话的 createdAt 可能
      //    最大，直接全量取第一条会命中早已不是当前工作区的旧会话）
      try {
        const q = ctx.get('sessionQuery')
        if (q && typeof q.listSessions === 'function') {
          const records = await q.listSessions()
          if (Array.isArray(records)) {
            const live = records.filter((r) => r && r.live && r.header)
            const rest = records.filter((r) => r && !r.live && r.header)
            for (const r of live) add(r.header.cwd)
            for (const r of rest) add(r.header.cwd)
          }
        }
      } catch (e) { /* 忽略 */ }
      // 5) 兜底：部署级 workspaceRoot（每次动态读取）
      try { add(policy.workspaceRoot) } catch (e) { /* 忽略 */ }
      return out
    }

    const isDir = async (path) => {
      try {
        const target = await fs.resolve(path)
        const info = await fs.stat(target)
        return !!(info && info.type === 'directory')
      } catch (e) {
        return false
      }
    }

    // 根目录缓存：hintRoot 为 Client 显式声明的「当前会话工作区」（权威信号，优先使用）；
    // rootPromise 为候选解析结果缓存（无 hint 时使用），unidoc.root(refresh) 会清空
    let rootPromise = null
    let hintRoot = null
    const getRoot = () => {
      if (hintRoot) return Promise.resolve(hintRoot)
      if (!rootPromise) {
        rootPromise = (async () => {
          const candidates = await collectCandidates()
          for (const c of candidates) {
            if (await isDir(c)) {
              console.log('dsh-unidoc: 文档中心根目录 =', c)
              return c
            }
          }
          let fallback = ''
          try { fallback = policy.workspaceRoot } catch (e) { /* 忽略 */ }
          console.log('dsh-unidoc: 未找到有效工作区，使用兜底根目录 =', fallback)
          return fallback
        })()
      }
      return rootPromise
    }

    // 解析客户端相对路径（'/' 分隔，可为空 = 根目录）为工作区内的 FsTarget；
    // 传入 agent 时（工具调用）优先使用该 Agent 会话的工作区 cwd
    const resolveInRoot = async (rel, agent) => {
      let root = await getRoot()
      if (agent && agent.session && agent.session.header && agent.session.header.cwd) {
        const agentCwd = agent.session.header.cwd
        if (await isDir(agentCwd)) root = agentCwd
      }
      const rootTarget = await fs.resolve(root)
      const target = rel ? await fs.resolve(String(rel), { cwd: root }) : rootTarget
      if (!fs.contains(rootTarget, target)) {
        throw new Error('路径超出文档中心根目录')
      }
      return { root, rootTarget, target }
    }

    const errResult = (error) => ({
      ok: false,
      error: error && error.message ? String(error.message) : String(error),
    })
    const okResult = (extra) => Object.assign({ ok: true }, extra)

    // 为写入构造沙箱策略：以解析出的工作区为根（插件上下文中 fs 默认根不是会话工作区，
    // 必须显式传递），工具调用时尊重调用者会话的模式覆盖（如 read-only 则拒绝写入）
    const buildWritePolicy = async (agent, root) => {
      let mode = 'workspace-write'
      try {
        const override = agent && agent.session ? policy.overrideOf(agent.session) : undefined
        if (override) mode = override
      } catch (e) { /* 保持 workspace-write */ }
      return { mode, workspaceRoot: root }
    }

    /* ---------------- RPC：unidoc.root ---------------- */
    // refresh=true 时丢弃已缓存根目录并重新解析；hintCwd 为 Client 显式声明的
    // 「当前会话工作区」（来自 Client 运行时 sessions 服务的权威信号，优先使用；
    // 传空串则清除 hint 走候选兜底），供 Client 感知工作区切换——即使切换到的
    // 是早已创建的历史会话，也能精确命中当前工作区，杜绝「永远显示 A」。
    // 诊断日志：hintCwd 收付情况仅在值变化时打印（避免 5s 轮询刷屏），
    // 用于确证 Client 的权威信号是否到达 Host（排障工作区切换不刷新）。
    let lastHintLog = null
    harness.handle('unidoc.root', async (args) => {
      if (args && args.refresh) rootPromise = null
      if (args && typeof args.hintCwd === 'string') {
        const t = String(args.hintCwd).trim()
        hintRoot = (t && (await isDir(t))) ? t : null
        const log = hintRoot || '(none)'
        if (log !== lastHintLog) {
          lastHintLog = log
          console.log('dsh-unidoc: hintCwd =', log)
        }
      }
      return { root: await getRoot(), rawPrefix: RAW_PREFIX }
    })

    /* ---------------- RPC：unidoc.list ---------------- */
    harness.handle('unidoc.list', async (args) => {
      try {
        const rel = args && args.path ? String(args.path) : ''
        const { target } = await resolveInRoot(rel)
        const info = await fs.stat(target)
        if (!info) return errResult(new Error('路径不存在'))
        if (info.type !== 'directory') return errResult(new Error('不是目录'))
        const entries = await fs.listDir(target)
        const items = entries.map((e) => ({
          name: e.name,
          type: e.type === 'directory' ? 'dir' : 'file',
          size: typeof e.size === 'number' ? e.size : null,
        }))
        return okResult({ path: rel, entries: items })
      } catch (error) {
        return errResult(error)
      }
    })

    /* ---------------- RPC：unidoc.read ---------------- */
    harness.handle('unidoc.read', async (args) => {
      try {
        const rel = args && args.path ? String(args.path) : ''
        const { target } = await resolveInRoot(rel)
        const info = await fs.stat(target)
        if (!info) return errResult(new Error('路径不存在'))
        if (info.type === 'directory') {
          return okResult({ kind: 'dir', size: typeof info.size === 'number' ? info.size : null })
        }
        const size = typeof info.size === 'number' ? info.size : null
        const ext = extOf(rel)
        if (BINARY_EXT.has(ext)) return okResult({ kind: 'binary', size, ext })
        try {
          const content = await fs.readText(target)
          return okResult({ kind: 'text', content, size, ext })
        } catch (error) {
          // 无法按 UTF-8 文本读取 → 一律降级为 binary，绝不崩溃
          return okResult({ kind: 'binary', size, ext })
        }
      } catch (error) {
        return errResult(error)
      }
    })

    /* ---------------- RPC：unidoc.save ---------------- */
    harness.handle('unidoc.save', async (args) => {
      try {
        const rel = args && args.path ? String(args.path) : ''
        const content = args && typeof args.content === 'string' ? args.content : ''
        if (!rel) return errResult(new Error('path 不能为空'))
        const resolved = await resolveInRoot(rel)
        const target = resolved.target
        const info = await fs.stat(target)
        if (info && info.type === 'directory') return errResult(new Error('目标是一个目录'))
        const writePolicy = await buildWritePolicy(undefined, resolved.root)
        await fs.writeText(target, content, undefined, undefined, writePolicy)
        return okResult({ size: content.length })
      } catch (error) {
        return errResult(error)
      }
    })

    /* ---------------- RPC：unidoc.create ---------------- */
    harness.handle('unidoc.create', async (args) => {
      try {
        const rel = args && args.path ? String(args.path) : ''
        const content = args && typeof args.content === 'string' ? args.content : ''
        const overwrite = !!(args && args.overwrite)
        if (!rel) return errResult(new Error('path 不能为空'))
        const resolved = await resolveInRoot(rel)
        const target = resolved.target
        const info = await fs.stat(target)
        if (info && info.type === 'directory') return errResult(new Error('目标是一个目录'))
        if (info && !overwrite) return errResult(new Error('文件已存在，如需覆盖请设置 overwrite=true'))
        const writePolicy = await buildWritePolicy(undefined, resolved.root)
        await fs.writeText(target, content, undefined, undefined, writePolicy)
        return okResult({ path: rel, size: content.length })
      } catch (error) {
        return errResult(error)
      }
    })

    /* ---------------- RPC：unidoc.openExternal ---------------- */
    // 返回当前文件的可访问 HTTP URL（复用 raw 路由），供客户端 window.open 新标签页打开；
    // 能拿到请求头时组装绝对 URL（含协议/端口），否则退化为相对 URL。
    harness.handle('unidoc.openExternal', async (args, meta) => {
      try {
        const rel = args && args.path ? String(args.path) : ''
        if (!rel) return errResult(new Error('path 不能为空'))
        const { target } = await resolveInRoot(rel)
        const info = await fs.stat(target)
        if (!info) return errResult(new Error('路径不存在'))
        if (info.type === 'directory') return errResult(new Error('目标是一个目录'))
        let base = ''
        try {
          const req = meta && meta.req
          const hostHeader = req && req.headers && req.headers.host
          if (hostHeader) {
            const fwd = req.headers['x-forwarded-proto']
            const proto = fwd || (req.socket && req.socket.encrypted ? 'https' : 'http')
            base = proto + '://' + hostHeader
          }
        } catch (e) { /* 保持相对 URL */ }
        const url = base + RAW_PREFIX + '?p=' + encodeURIComponent(rel)
        return okResult({ path: rel, url })
      } catch (error) {
        return errResult(error)
      }
    })

    /* ---------------- RPC：unidoc.openWithEditor ---------------- */
    // 用外部编辑器（VSCode 等）打开工作区内文件：editorCmd 仅允许命令名或
    // 可执行文件路径（无空格、无 shell 元字符），路径经 fs.contains 校验后
    // 以 JSON 字符串引用传给 shell；进程 detached + stdio ignore + unref，
    // 编辑器独立运行，绝不阻塞 / 拖住 Host 进程。
    const EDITOR_CMD_RE = /^[A-Za-z0-9_.\-\\/:]+$/
    harness.handle('unidoc.openWithEditor', async (args, meta) => {
      try {
        const rel = args && args.path ? String(args.path) : ''
        const editorCmd = args && typeof args.editorCmd === 'string' ? args.editorCmd.trim() : ''
        if (!rel) return errResult(new Error('path 不能为空'))
        if (!editorCmd) return errResult(new Error('editorCmd 不能为空（如 code / notepad / 可执行文件路径）'))
        if (editorCmd.length > 1024 || !EDITOR_CMD_RE.test(editorCmd)) {
          return errResult(new Error('editorCmd 含非法字符，仅允许命令名或可执行文件路径'))
        }
        const { target } = await resolveInRoot(rel)
        const info = await fs.stat(target)
        if (!info) return errResult(new Error('路径不存在'))
        if (info.type === 'directory') return errResult(new Error('目标是一个目录'))
        const filePath = target && (target.displayPath || target.targetKey)
          ? String(target.displayPath || target.targetKey)
          : ''
        if (!filePath) return errResult(new Error('无法解析文件的系统路径'))
        // Windows 上 code / notepad 等多为 .cmd / .exe，统一走 shell 以兼容；
        // 命令已被严格校验（无空白 / 无元字符），路径按平台规则加引号，杜绝注入。
        const quoteArg = (s) => {
          const v = String(s)
          if (IS_WIN32) return '"' + v + '"' // Windows 文件名不允许出现双引号，无需转义
          return "'" + v.replace(/'/g, "'\\''") + "'"
        }
        const child = spawn(editorCmd + ' ' + quoteArg(filePath), {
          shell: true,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
        child.on('error', (e) => {
          console.error('dsh-unidoc: 外部编辑器启动失败:', e && e.message ? String(e.message) : String(e))
        })
        child.on('exit', (code) => {
          if (code !== 0) console.error('dsh-unidoc: 外部编辑器进程退出码非 0（' + code + '），请检查编辑器命令是否已安装并在 PATH 中')
        })
        child.unref()
        return okResult({ path: rel, editor: editorCmd, file: filePath, pid: child.pid || null })
      } catch (error) {
        return errResult(error)
      }
    })

    /* ---------------- HTTP 路由：/dsh-unidoc/raw ---------------- */
    const MIME = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
      avif: 'image/avif', pdf: 'application/pdf',
      html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    }
    const mimeFor = (ext) => MIME[ext] || 'application/octet-stream'
    const parseQuery = (qs) => {
      const out = {}
      if (!qs) return out
      for (const part of qs.split('&')) {
        if (!part) continue
        const i = part.indexOf('=')
        const k = i >= 0 ? part.slice(0, i) : part
        const v = i >= 0 ? part.slice(i + 1) : ''
        try { out[decodeURIComponent(k)] = decodeURIComponent(v) } catch (e) { /* 忽略无法解码的参数 */ }
      }
      return out
    }

    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: RAW_PREFIX,
      handler: async (req, res) => {
        try {
          const url = String(req.url || '')
          const qi = url.indexOf('?')
          const query = qi >= 0 ? url.slice(qi + 1) : ''
          const params = parseQuery(query)
          const rel = params.p || ''
          if (!rel) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('missing ?p=')
            return
          }
          const { target } = await resolveInRoot(rel)
          const info = await fs.stat(target)
          if (!info || info.type !== 'file') {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
          }
          const ext = extOf(rel)
          const bytes = await fs.readBytes(target, undefined, MAX_RAW_BYTES)
          const headers = {
            'Content-Type': mimeFor(ext),
            'Content-Length': String(bytes.length),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          }
          // HTML 预览安全头：禁脚本 / 禁连接，配合客户端 iframe sandbox 属性双重隔离
          if (ext === 'html' || ext === 'htm') {
            headers['Content-Security-Policy'] =
              "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; media-src 'self'"
          }
          res.writeHead(200, headers)
          res.write(bytes)
          res.end()
        } catch (error) {
          try {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('unavailable: ' + (error && error.message ? String(error.message) : String(error)))
          } catch (e) { /* 忽略响应错误 */ }
        }
      },
    }))

    /* ---------------- 动态工具：doc_read / doc_edit / doc_create ---------------- */
    const readLines = (content, offset, limit) => {
      const lines = content.split('\n')
      const start = offset && offset > 0 ? offset - 1 : 0
      const end = limit && limit > 0 ? start + limit : lines.length
      return { lines: lines.slice(start, end), total: lines.length, start }
    }

    const toolDocRead = harness.defineTool({
      name: 'doc_read',
      description:
        '读取文档中心（dsh-unidoc）工作区内的文档/代码文件。文本与代码文件返回内容，二进制文件返回文件信息。' +
        '路径相对文档中心根目录（当前工作区），可用 offset/limit 按行读取大文件。',
      parameters: {
        path: { type: 'string', required: true, description: '文件路径，相对当前工作区，如 src/main.py；子目录用 / 分隔' },
        offset: { type: 'integer', description: '可选：起始行号（从 1 开始，默认 1）' },
        limit: { type: 'integer', description: '可选：最大读取行数（默认全部）' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            path: { type: 'string', description: '文件路径' },
            root: { type: 'string', description: '本次解析的文档中心根目录' },
            rawPrefix: { type: 'string', description: '本次激活的原始字节路由前缀' },
            kind: { type: 'string', description: 'text | binary' },
            size: { type: 'integer', description: '文件字节数' },
            lines: { type: 'integer', description: '本次返回的行数' },
            totalLines: { type: 'integer', description: '文件总行数（文本）' },
            startLine: { type: 'integer', description: '起始行号（文本，从 1 开始）' },
            content: { type: 'string', description: '文件内容（文本）' },
            error: { type: 'string', description: '失败原因' },
          },
          additionalProperties: false,
        },
        render(args, value) {
          const header = 'doc_read: ' + (value.path || '') + (value.ok ? '' : '（失败：' + (value.error || '未知错误') + '）')
          if (!value.ok) return [{ type: 'text', text: header }]
          if (value.kind === 'text') {
            const start = value.startLine || 0
            const text =
              header + '\n' +
              '根目录: ' + (value.root || '') + ' | 路由: ' + (value.rawPrefix || '') + ' | 类型: 文本 | 大小: ' + value.size + ' 字节 | 共 ' + value.totalLines + ' 行（显示第 ' + (start + 1) + '-' + (start + (value.lines || 0)) + ' 行）\n' +
              '---\n' +
              value.content
            return [{ type: 'text', text }]
          }
          return [{ type: 'text', text: header + '\n根目录: ' + (value.root || '') + ' | 路由: ' + (value.rawPrefix || '') + ' | 类型: 二进制 | 大小: ' + value.size + ' 字节 | 该文件无法按文本读取' }]
        },
      },
      execute: async (args, exec) => {
        let usedRoot = null
        try {
          const rel = String(args.path || '')
          if (!rel) return { ok: false, error: 'path 不能为空', path: rel }
          const agent = exec && exec.agent
          const resolved = await resolveInRoot(rel, agent)
          usedRoot = resolved.root
          const target = resolved.target
          const info = await fs.stat(target)
          if (!info) return { ok: false, error: '路径不存在', path: rel, root: usedRoot }
          if (info.type === 'directory') return { ok: false, error: '目标是一个目录', path: rel, root: usedRoot }
          const size = typeof info.size === 'number' ? info.size : null
          const ext = extOf(rel)
          if (BINARY_EXT.has(ext)) return { ok: true, path: rel, kind: 'binary', size, root: usedRoot, rawPrefix: RAW_PREFIX }
          try {
            const content = await fs.readText(target)
            const offset = typeof args.offset === 'number' ? args.offset : undefined
            const limit = typeof args.limit === 'number' ? args.limit : undefined
            const { lines, total, start } = readLines(content, offset, limit)
            return {
              ok: true, path: rel, kind: 'text', size, root: usedRoot, rawPrefix: RAW_PREFIX,
              content: lines.join('\n'), lines: lines.length, totalLines: total, startLine: start,
            }
          } catch (e) {
            return { ok: true, path: rel, kind: 'binary', size, root: usedRoot, rawPrefix: RAW_PREFIX }
          }
        } catch (error) {
          return { ok: false, error: error && error.message ? String(error.message) : String(error), path: String(args.path || ''), root: usedRoot || '' }
        }
      },
    })

    const toolDocEdit = harness.defineTool({
      name: 'doc_edit',
      description:
        '编辑文档中心工作区内的文本/代码文件：将文件中唯一出现的 old_string 替换为 new_string 并原子保存。' +
        'old_string 必须包含足够上下文以唯一匹配（出现 0 次或多次都会失败并给出提示）。',
      parameters: {
        path: { type: 'string', required: true, description: '文件路径（相对工作区）' },
        old_string: { type: 'string', required: true, description: '要替换的原文，必须在文件中恰好出现一次' },
        new_string: { type: 'string', required: true, description: '替换后的新文本' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            path: { type: 'string', description: '文件路径' },
            size: { type: 'integer', description: '保存后的字节数' },
            error: { type: 'string', description: '失败原因' },
          },
          additionalProperties: false,
        },
        render(args, value) {
          if (value.ok) return [{ type: 'text', text: 'doc_edit: 已更新 ' + value.path + '（' + value.size + ' 字节）' }]
          return [{ type: 'text', text: 'doc_edit: 编辑 ' + (value.path || '') + ' 失败 — ' + (value.error || '未知错误') }]
        },
      },
      execute: async (args, exec) => {
        try {
          const rel = String(args.path || '')
          const oldS = String(args.old_string || '')
          const newS = String(args.new_string || '')
          if (!rel) return { ok: false, error: 'path 不能为空', path: rel }
          if (!oldS) return { ok: false, error: 'old_string 不能为空', path: rel }
          const agent = exec && exec.agent
          const resolved = await resolveInRoot(rel, agent)
          const target = resolved.target
          const info = await fs.stat(target)
          if (!info) return { ok: false, error: '路径不存在', path: rel }
          if (info.type === 'directory') return { ok: false, error: '目标是一个目录', path: rel }
          let content
          try {
            content = await fs.readText(target)
          } catch (e) {
            return { ok: false, error: '文件不是 UTF-8 文本，无法编辑', path: rel }
          }
          const idx = content.indexOf(oldS)
          if (idx < 0) return { ok: false, error: '未找到匹配的 old_string', path: rel }
          const last = content.lastIndexOf(oldS)
          if (idx !== last) return { ok: false, error: 'old_string 在文件中出现多次，请提供更精确的上下文', path: rel }
          const updated = content.slice(0, idx) + newS + content.slice(idx + oldS.length)
          const writePolicy = await buildWritePolicy(agent, resolved.root)
          await fs.writeText(target, updated, undefined, undefined, writePolicy)
          return { ok: true, path: rel, size: updated.length }
        } catch (error) {
          return { ok: false, error: error && error.message ? String(error.message) : String(error), path: String(args.path || '') }
        }
      },
    })

    const toolDocCreate = harness.defineTool({
      name: 'doc_create',
      description:
        '在文档中心工作区内创建新文件（默认不覆盖已存在文件，父目录必须已存在）。',
      parameters: {
        path: { type: 'string', required: true, description: '新文件路径（相对工作区），如 docs/note.md' },
        content: { type: 'string', description: '文件内容（默认空字符串）' },
        overwrite: { type: 'boolean', description: '是否允许覆盖已存在的文件（默认 false）' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            path: { type: 'string', description: '文件路径' },
            size: { type: 'integer', description: '写入的字节数' },
            error: { type: 'string', description: '失败原因' },
          },
          additionalProperties: false,
        },
        render(args, value) {
          if (value.ok) return [{ type: 'text', text: 'doc_create: 已创建 ' + value.path + '（' + value.size + ' 字节）' }]
          return [{ type: 'text', text: 'doc_create: 创建 ' + (value.path || '') + ' 失败 — ' + (value.error || '未知错误') }]
        },
      },
      execute: async (args, exec) => {
        try {
          const rel = String(args.path || '')
          const content = typeof args.content === 'string' ? args.content : ''
          const overwrite = args.overwrite === true
          if (!rel) return { ok: false, error: 'path 不能为空', path: rel }
          const agent = exec && exec.agent
          const resolved = await resolveInRoot(rel, agent)
          const target = resolved.target
          const info = await fs.stat(target)
          if (info && info.type === 'directory') return { ok: false, error: '目标是一个目录', path: rel }
          if (info && !overwrite) return { ok: false, error: '文件已存在，如需覆盖请设置 overwrite=true', path: rel }
          const writePolicy = await buildWritePolicy(agent, resolved.root)
          await fs.writeText(target, content, undefined, undefined, writePolicy)
          return { ok: true, path: rel, size: content.length }
        } catch (error) {
          return { ok: false, error: error && error.message ? String(error.message) : String(error), path: String(args.path || '') }
        }
      },
    })

    // 工具注册挂到插件 Fiber：插件停止/更新时自动注销
    ctx.effect(() => harness.registerTool(ctx, toolDocRead))
    ctx.effect(() => harness.registerTool(ctx, toolDocEdit))
    ctx.effect(() => harness.registerTool(ctx, toolDocCreate))
  },
}
