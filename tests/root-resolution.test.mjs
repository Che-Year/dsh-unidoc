#!/usr/bin/env node
/* ============================================================================
 * dsh-unidoc — 根目录解析 / 工作区隔离 自动化测试
 *
 * 用 node:vm 加载 src/host.js（动态插件体），以 mock 的 Cordis 服务
 * （agents / sessionQuery / sandboxPolicy / fs / webServer）驱动 apply(ctx)，
 * 捕获 harness.handle 注册的 RPC handlers 与 harness.defineTool 注册的工具，
 * 验证：
 *   A. hintCwd 权威信号（Client 上报「当前会话工作区」→ Host 优先采用）
 *   B. 候选解析顺序（currentInitiator → agents 新→旧 → live 会话 → 幽灵 → 兜底根）
 *   C. 路径锚定与安全（fs.contains 防目录穿越）
 *   D. Agent 工具（doc_read / doc_edit / doc_create）以调用者会话 cwd 为准
 *
 * 用法：node tests/root-resolution.test.mjs
 * 期望：全部通过（30+ 断言），任一失败 exit 1。
 * ========================================================================== */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST_SRC = fs.readFileSync(path.join(ROOT, 'src', 'host.js'), 'utf8')

/* ---------------- 断言工具 ---------------- */
let passed = 0
let failed = 0
const failures = []
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; failures.push(name); console.log('  ✗ ' + name) }
}
function eq(actual, expected, name) {
  ok(actual === expected, name + '（期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual) + '）')
}

/* ---------------- 内存文件系统 mock ---------------- */
// files: { '/abs/path': { type: 'file', content: '...' } | { type: 'dir' } }
function makeMemFS(files, realDirs) {
  const dirs = new Set(realDirs || [])
  for (const p of Object.keys(files)) {
    let d = path.posix.dirname(p)
    while (d && d !== '/' && !dirs.has(d)) { dirs.add(d); d = path.posix.dirname(d) }
  }
  const norm = (p) => {
    let s = String(p || '')
    if (!s.startsWith('/')) s = '/' + s
    const parts = []
    for (const seg of s.split('/')) {
      if (!seg || seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    return '/' + parts.join('/')
  }
  return {
    resolve: (p, opts) => {
      if (p && typeof p === 'object') return p
      const base = opts && opts.cwd ? norm(opts.cwd) : '/'
      if (p === undefined || p === null || p === '') return base
      if (String(p).startsWith('/')) return norm(p)
      return norm(base + '/' + p)
    },
    stat: async (target) => {
      const t = norm(target)
      if (files[t]) return { type: files[t].type, size: files[t].content != null ? Buffer.byteLength(files[t].content) : 0 }
      if (dirs.has(t)) return { type: 'directory', size: 0 }
      return null
    },
    contains: (root, target) => {
      const r = norm(root), t = norm(target)
      return t === r || t.startsWith(r + '/')
    },
    listDir: async (target) => {
      const t = norm(target)
      if (files[t]) return []
      const out = []
      for (const p of Object.keys(files)) {
        if (p.startsWith(t + '/') && p.slice(t.length + 1).indexOf('/') < 0) {
          out.push({ name: path.posix.basename(p), type: 'file', size: Buffer.byteLength(files[p].content) })
        }
      }
      for (const d of dirs) {
        if (d.startsWith(t + '/') && d.slice(t.length + 1).indexOf('/') < 0 && !files[d]) {
          out.push({ name: path.posix.basename(d), type: 'directory', size: null })
        }
      }
      return out
    },
    readText: async (target) => {
      const t = norm(target)
      const f = files[t]
      if (!f || f.type !== 'file') throw new Error('no such file')
      return f.content
    },
    writeText: async (target, content) => {
      const t = norm(target)
      files[t] = { type: 'file', content: String(content) }
    },
    readBytes: async (target) => {
      const t = norm(target)
      const f = files[t]
      if (!f) throw new Error('no such file')
      return Buffer.from(f.content || '')
    },
  }
}

/* ---------------- 装配 host 插件 ---------------- */
async function makePlugin(cfg) {
  // cfg: { initiator, agentsList, sessions, workspaceRoot, dirs, fs }
  const handlers = new Map()
  const tools = new Map()
  // 自动把「候选来源的 cwd」注册为真实目录（agents / sessions / initiator /
  // workspaceRoot），使 isDir 判定符合「这些工作区存在」的预期；
  // 测试要验证的「不存在目录」（如 /no/such/dir）不注册，自然判为不存在。
  const realDirs = new Set([...(cfg.dirs || []), cfg.workspaceRoot || '/ws-root'])
  if (cfg.initiator && cfg.initiator.session && cfg.initiator.session.header && cfg.initiator.session.header.cwd) {
    realDirs.add(cfg.initiator.session.header.cwd)
  }
  for (const a of (cfg.agentsList || [])) {
    if (a && a.session && a.session.header && a.session.header.cwd) realDirs.add(a.session.header.cwd)
  }
  for (const s of (cfg.sessions || [])) {
    if (s && s.header && s.header.cwd) realDirs.add(s.header.cwd)
  }
  const fsMock = cfg.fs || makeMemFS({}, [...realDirs])
  const agents = {
    currentInitiator: () => (cfg.initiator !== undefined ? cfg.initiator : undefined),
    list: () => (cfg.agentsList || []),
  }
  const sessionQuery = {
    // 真实 DSH：listSessions 按 createdAt 降序（compareSessions）——mock 同样排序
    listSessions: async () => (cfg.sessions || []).slice().sort((a, b) => b.header.createdAt - a.header.createdAt),
  }
  const policy = {
    workspaceRoot: cfg.workspaceRoot || '/ws-root',
    overrideOf: () => undefined,
    resolve: () => ({ mode: 'workspace-write', workspaceRoot: cfg.workspaceRoot || '/ws-root' }),
  }
  const webServer = { register: () => () => {} }
  const harness = {
    handle: (m, fn) => handlers.set(m, fn),
    defineTool: (def) => def,
    registerTool: (_c, tool) => tools.set(tool.name, tool),
  }
  const fakeCtx = {
    get: (name) => {
      if (name === 'fs') return fsMock
      if (name === 'webServer') return webServer
      if (name === 'sandboxPolicy') return policy
      if (name === 'agents') return agents
      if (name === 'sessionQuery') return sessionQuery
      return undefined
    },
    effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
  }
  const vmGlobals = {
    console, Math, JSON, Date, RegExp, Set, Map, Array, Object, String, Number, Boolean, Promise,
    Uint8Array, Buffer, Symbol, Error, TypeError, RangeError, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, setInterval, clearInterval,
    spawn: () => ({ on: () => {}, unref: () => {}, pid: 1 }),
    IS_WIN32: false,
    harness,
  }
  const wrapper = vm.runInNewContext(
    `(async () => {\n${HOST_SRC}\n})()`,
    Object.assign(Object.create(null), vmGlobals),
    { filename: 'src/host.js' },
  )
  let plugin
  if (typeof wrapper.then === 'function') plugin = await wrapper
  else plugin = wrapper
  plugin.apply(fakeCtx)
  return { handlers, tools, fsMock }
}

/* 便捷 helper：构造会话记录 */
const live = (id, cwd, createdAt) => ({ header: { id, cwd, createdAt }, live: true, persisted: false })
const ghost = (id, cwd, createdAt) => ({ header: { id, cwd, createdAt }, live: false, persisted: true })
const agent = (id, cwd) => ({ id, session: { header: { cwd } } })

/* ============================================================================
 * A. hintCwd 权威信号
 * ========================================================================== */
console.log('\n[A] hintCwd 权威信号（Client 上报「当前会话工作区」）')
{
  const { handlers } = await makePlugin({
    // 无在线 Agent：候选主信号为 live 会话 createdAt 降序
    sessions: [live('s1', '/ws-a', 100), live('s2', '/ws-b', 200)],
    workspaceRoot: '/ws-root',
  })
  const root = handlers.get('unidoc.root')

  // 1. hintCwd 有效目录 → 直接采用
  let r = await root({ hintCwd: '/ws-b' })
  eq(r.root, '/ws-b', '1. hintCwd 有效目录优先于候选（/ws-b）')

  // 2. hintCwd 空串 → 清除 hint 走候选（无在线 Agent，live 会话 createdAt 降序 → /ws-b）
  r = await root({ hintCwd: '' })
  eq(r.root, '/ws-b', '2. hintCwd 空串清除 hint，候选命中 live 降序第一个')

  // 3. hintCwd 指向不存在目录 → 忽略，走候选
  r = await root({ hintCwd: '/no/such/dir' })
  eq(r.root, '/ws-b', '3. hintCwd 非目录被忽略，走候选')

  // 4. hintCwd 带空白 → trim 后使用
  r = await root({ hintCwd: '  /ws-a  ' })
  eq(r.root, '/ws-a', '4. hintCwd 首尾空白被 trim')

  // 5. refresh 不清理 hint（hint 仍优先）
  r = await root({ refresh: true, hintCwd: '/ws-a' })
  eq(r.root, '/ws-a', '5. refresh 后 hintCwd 仍优先')

  // 7. hintCwd 变化 → 根目录跟随
  r = await root({ hintCwd: '/ws-a' })
  r = await root({ hintCwd: '/ws-b' })
  eq(r.root, '/ws-b', '7. hintCwd 变化时根目录跟随新值')

  // 8. hint 无效后再次有效 → 恢复
  r = await root({ hintCwd: '/no/such' })
  r = await root({ hintCwd: '/ws-a' })
  eq(r.root, '/ws-a', '8. hint 失效后再次有效即恢复优先')
}

// 6. 无 hintCwd 参数（老客户端 / 异常调用，且无 hint 历史）→ 候选解析
{
  const { handlers } = await makePlugin({
    sessions: [live('s1', '/ws-a', 100), live('s2', '/ws-b', 200)],
    workspaceRoot: '/ws-root',
  })
  const r = await handlers.get('unidoc.root')({ refresh: true })
  eq(r.root, '/ws-b', '6. 无 hintCwd 参数（无 hint 历史）回退候选解析')
}

/* ============================================================================
 * B. 候选解析顺序（无 hint 时）
 * ========================================================================== */
console.log('\n[B] 候选解析顺序')
{
  // 9. 单 live 会话 → 该 cwd
  {
    const { handlers } = await makePlugin({ sessions: [live('s1', '/only-ws', 100)], workspaceRoot: '/ws-root' })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/only-ws', '9. 单 live 会话命中其 cwd')
  }
  // 10. 多 live 会话 createdAt 降序 → 第一个
  {
    const { handlers } = await makePlugin({ sessions: [live('s1', '/old', 100), live('s2', '/new', 300), live('s3', '/mid', 200)] })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/new', '10. live 会话按 createdAt 降序取第一个')
  }
  // 11. live + 幽灵混合 → live 优先
  {
    const { handlers } = await makePlugin({ sessions: [ghost('g1', '/ghost-new', 900), live('s1', '/live-old', 100)] })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/live-old', '11. live 会话优先于 createdAt 更大的幽灵会话')
  }
  // 12. 仅幽灵会话 → 降序第一个
  {
    const { handlers } = await makePlugin({ sessions: [ghost('g1', '/ghost1', 100), ghost('g2', '/ghost2', 900)] })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/ghost2', '12. 仅幽灵会话按 createdAt 降序')
  }
  // 13. agents.list 从后往前（最近注册优先）
  {
    const { handlers } = await makePlugin({ agentsList: [agent('a1', '/old-agent'), agent('a2', '/new-agent')] })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/new-agent', '13. agents.list 从最新注册向旧遍历')
  }
  // 14. 全部为空 → workspaceRoot 兜底
  {
    const { handlers } = await makePlugin({ workspaceRoot: '/fallback-root' })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/fallback-root', '14. 无任何候选时使用 workspaceRoot 兜底')
  }
  // 15. 候选去重（同一 cwd 出现在多个来源）
  {
    const { handlers } = await makePlugin({
      initiator: agent('ai', '/dup-ws'),
      agentsList: [agent('a1', '/dup-ws'), agent('a2', '/other')],
      sessions: [live('s1', '/dup-ws', 100), live('s2', '/other2', 300)],
    })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/dup-ws', '15. 重复 cwd 去重且发起者优先')
  }
  // 16. currentInitiator 优先（工具上下文）
  {
    const { handlers } = await makePlugin({ initiator: agent('ai', '/initiator-ws'), agentsList: [agent('a1', '/other-ws')] })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/initiator-ws', '16. currentInitiator 会话 cwd 优先')
  }
  // 17. 无效候选跳过（第一个存在目录生效）
  {
    const { handlers } = await makePlugin({
      initiator: agent('ai', '/no/exist'),
      agentsList: [agent('a1', '/exists-ws')],
      // 显式 fs：只注册 /exists-ws，/no/exist 判定为不存在
      fs: makeMemFS({}, ['/exists-ws']),
    })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/exists-ws', '17. 不存在的候选被跳过，取第一个真实目录')
  }
  // 18. 幽灵会话在候选最末尾（agents 优先于幽灵）
  {
    const { handlers } = await makePlugin({
      agentsList: [agent('a1', '/agent-ws')],
      sessions: [ghost('g1', '/ghost-ws', 999)],
    })
    const r = await handlers.get('unidoc.root')({})
    eq(r.root, '/agent-ws', '18. 在线 Agent 优先于 createdAt 最大的幽灵会话')
  }
}

/* ============================================================================
 * C. 路径锚定与安全（以 hint / root 为锚）
 * ========================================================================== */
console.log('\n[C] 路径锚定与安全')
{
  const files = {
    '/ws-b/readme.md': { type: 'file', content: '# B' },
    '/ws-b/src/main.py': { type: 'file', content: 'print(1)' },
  }
  const { handlers } = await makePlugin({
    agentsList: [agent('a1', '/ws-a')],
    sessions: [live('s1', '/ws-a', 100), live('s2', '/ws-b', 200)],
    fs: makeMemFS(files, ['/ws-b/src']),
  })
  const rootH = handlers.get('unidoc.root')
  const listH = handlers.get('unidoc.list')
  const readH = handlers.get('unidoc.read')

  // 19. hint 生效后 unidoc.list 以 hint 为锚
  await rootH({ hintCwd: '/ws-b' })
  let r = await listH({ path: '' })
  eq(r.ok, true, '19a. list 根目录成功')
  ok(Array.isArray(r.entries), '19b. list 返回 entries')
  ok(r.entries.some((e) => e.name === 'readme.md'), '19c. entries 含 hint 目录内文件')

  // 20. 子目录列出
  r = await listH({ path: 'src' })
  eq(r.ok, true, '20a. 子目录 src 列出成功')
  ok(r.entries.some((e) => e.name === 'main.py'), '20b. src 内含 main.py')

  // 21. 越界路径被拒绝（hint=/ws-b，访问 /ws-a 文件）
  r = await readH({ path: '../ws-a/readme.md' })
  eq(r.ok, false, '21. 相对越界路径被 fs.contains 拒绝')

  // 22. 绝对越界路径被拒绝
  r = await readH({ path: '/ws-a/readme.md' })
  eq(r.ok, false, '22. 绝对越界路径被拒绝')

  // 23. 正常读取 hint 目录内文件
  r = await readH({ path: 'readme.md' })
  eq(r.ok, true, '23a. hint 目录内文件读取成功')
  eq(r.kind, 'text', '23b. 文本类型识别正确')
  eq(r.content, '# B', '23c. 内容正确')

  // 24. list 目标为文件 → 错误
  r = await listH({ path: 'readme.md' })
  eq(r.ok, false, '24. list 目标为文件时报错')
}

/* ============================================================================
 * D. Agent 工具（以调用者会话 cwd 为准）
 * ========================================================================== */
console.log('\n[D] Agent 工具 doc_read / doc_edit / doc_create')
{
  const files = {
    '/ws-a/notes.md': { type: 'file', content: 'line1\nline2\nline3\n' },
  }
  const { handlers, tools } = await makePlugin({
    agentsList: [agent('a1', '/ws-a')],
    sessions: [live('s1', '/ws-a', 100)],
    fs: makeMemFS(files),
  })
  const toolRead = tools.get('doc_read')
  const toolEdit = tools.get('doc_edit')
  const toolCreate = tools.get('doc_create')
  ok(!!toolRead && !!toolEdit && !!toolCreate, '25. 三个 Agent 工具已注册')

  // 26. doc_read 以调用者 Agent 会话 cwd 为根（即使 hint 指向别处）
  await handlers.get('unidoc.root')({ hintCwd: '/ws-b' }) // 设置 hint=/ws-b（该目录可能不存在，忽略）
  const execAgent = { agent: agent('a1', '/ws-a') }
  let r = await toolRead.execute({ path: 'notes.md' }, execAgent)
  eq(r.ok, true, '26a. doc_read 以 exec.agent 会话 cwd 为根')
  eq(r.root, '/ws-a', '26b. doc_read 返回的 root 为调用者工作区')
  ok(r.content.startsWith('line1'), '26c. doc_read 内容正确')

  // 27. doc_read offset/limit 行读取
  r = await toolRead.execute({ path: 'notes.md', offset: 2, limit: 1 }, execAgent)
  eq(r.content, 'line2', '27. doc_read 按行 offset/limit 读取')

  // 28. doc_edit 原子替换
  r = await toolEdit.execute({ path: 'notes.md', old_string: 'line2', new_string: 'LINE2' }, execAgent)
  eq(r.ok, true, '28a. doc_edit 替换成功')
  const rr = await toolRead.execute({ path: 'notes.md' }, execAgent)
  ok(rr.content.includes('LINE2'), '28b. 替换内容已落盘')

  // 29. doc_edit 重复匹配拒绝
  const dupFiles = { '/ws-a/dup.txt': { type: 'file', content: 'x y x' } }
  const { handlers: h2, tools: t2 } = await makePlugin({ agentsList: [agent('a1', '/ws-a')], fs: makeMemFS(dupFiles) })
  const e2 = await t2.get('doc_edit').execute({ path: 'dup.txt', old_string: 'x', new_string: 'z' }, execAgent)
  eq(e2.ok, false, '29. doc_edit 多处匹配明确报错')

  // 30. doc_create 默认不覆盖 / overwrite 覆盖
  const { handlers: h3, tools: t3, fsMock: f3 } = await makePlugin({ agentsList: [agent('a1', '/ws-a')], fs: makeMemFS({}) })
  let c = await t3.get('doc_create').execute({ path: 'new.txt', content: 'hi' }, execAgent)
  eq(c.ok, true, '30a. doc_create 创建成功')
  c = await t3.get('doc_create').execute({ path: 'new.txt', content: 'hi2' }, execAgent)
  eq(c.ok, false, '30b. 默认不覆盖已存在文件')
  c = await t3.get('doc_create').execute({ path: 'new.txt', content: 'hi2', overwrite: true }, execAgent)
  eq(c.ok, true, '30c. overwrite=true 允许覆盖')
}

/* ============================================================================
 * E. 附加：rawPrefix / 工具越界
 * ========================================================================== */
console.log('\n[E] 附加')
{
  const { handlers } = await makePlugin({ agentsList: [agent('a1', '/ws-a')] })
  const r = await handlers.get('unidoc.root')({ hintCwd: '/ws-a' })
  ok(typeof r.rawPrefix === 'string' && r.rawPrefix.startsWith('/dsh-unidoc/raw-'), '31. rawPrefix 随机路由前缀返回')
  // 32. 工具调用也做 fs.contains 防护
  const { tools } = await makePlugin({ agentsList: [agent('a1', '/ws-a')], fs: makeMemFS({}) })
  const execAgent = { agent: agent('a1', '/ws-a') }
  const t = await tools.get('doc_read').execute({ path: '../../etc/passwd' }, execAgent)
  eq(t.ok, false, '32. 工具路径穿越被拒绝')
}

/* ---------------- 汇总 ---------------- */
console.log('\n========================================')
console.log('通过: ' + passed + ' / ' + (passed + failed) + ' 断言')
if (failed > 0) {
  console.log('失败项:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
} else {
  console.log('全部通过 ✓')
  process.exit(0)
}
