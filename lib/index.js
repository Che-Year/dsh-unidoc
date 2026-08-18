/* ============================================================================
 * dsh-unidoc — Host half (static plugin shell)
 *
 * dsh-unidoc 以「动态 Cordis 插件」源码形态开发（src/host.js 为 `return {...}`
 * 函数体，依赖动态 runner 注入的 harness / ctx 假面），本文件是其静态化外壳：
 * 以标准 Cordis 插件（ESM 导出 name / inject / apply）加载，运行时用 vm 执行
 * src/host.js，并把动态插件的 harness / ctx 全局桥接到真实服务：
 *
 *   harness.handle(method, fn)   → 收集 RPC handler，注册 POST /api/dsh-unidoc/rpc
 *   harness.defineTool(def)      → @deepseek-ai/dsh-tools 的 defineTool
 *   harness.registerTool(ctx, t) → ctx.tools.register(t)
 *   ctx.get(name)                → 真实 ctx 的注入服务（fs / webServer / ...）
 *   ctx.effect(fn, label)        → 真实 ctx.effect（Cordis 标准）
 *
 * 桥接后 src/host.js 的 apply(ctx) 原样运行：工具、HTTP 路由、RPC 全部生效，
 * 且随插件 Fiber 自动回收。
 * ========================================================================== */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { defineTool } from '@deepseek-ai/dsh-tools'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const HOST_SOURCE = readFileSync(new URL('../src/host.js', import.meta.url), 'utf8')

/** 静态插件声明：所需 host 服务（与 src/host.js 的 ctx.get 使用一一对应）。 */
export const name = 'unidoc'
export const inject = [
  'webServer',
  'tools',
  'fs',
  'sandboxPolicy',
  'agents',
  'sessionQuery',
  'systemPrompt',
]

/** 面向 Agent 的插件存在通知（工具已注册，模型可感知）。 */
const UNIDOC_GUIDANCE =
  '本机已安装 dsh-unidoc 插件（通用文档中心）：Agent 侧提供 doc_read / doc_edit / doc_create 三个文档工具，' +
  '可读写当前工作区内的文档/代码文件；GUI 侧提供「文档中心」工作台（文件树 + 多格式预览/编辑）。' +
  '用户提到「文档中心 / unidoc / doc_read / doc_edit / doc_create」时即指本插件，请据此协作。'

/** vm 执行所需的全局面（只放安全内置，不给 require / process / 文件系统能力）。 */
const VM_GLOBALS = {
  console,
  Math,
  JSON,
  Date,
  RegExp,
  Set,
  Map,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Promise,
  Uint8Array,
  Buffer,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Symbol,
  Error,
  TypeError,
  RangeError,
  encodeURIComponent,
  decodeURIComponent,
}

/**
 * 挂载 dsh-unidoc。
 * @param ctx - 静态 Cordis 插件上下文（webServer / tools / fs / sandboxPolicy / agents / sessionQuery / systemPrompt）。
 * @param config - 插件配置（schema 默认已应用）。
 */
export async function apply(ctx, config = {}) {
  const enabled = config.enabled !== false
  const announce = config.announceToAgent !== false
  const rpcPath = config.rpcPath || '/api/dsh-unidoc/rpc'

  if (!enabled) return

  /* ---------------- 动态源码的 harness / ctx 假面 ---------------- */
  const handlers = new Map() // method -> fn

  const harness = {
    handle(method, fn) {
      if (typeof method !== 'string' || typeof fn !== 'function') return
      handlers.set(method, fn)
    },
    defineTool(def) {
      return defineTool(def)
    },
    registerTool(_fakeCtx, tool) {
      if (tool && typeof tool.name === 'string') return ctx.tools.register(tool)
      return undefined
    },
  }

  const fakeCtx = {
    get(name) {
      const value = ctx[name]
      return value
    },
    effect(fn, label) {
      return ctx.effect(fn, label)
    },
  }

  /* ---------------- 执行 src/host.js（async 函数体，返回插件对象） ---------------- */
  let plugin
  try {
    const wrapper = vm.runInNewContext(
      `(async () => {\n${HOST_SOURCE}\n})()`,
      Object.assign(Object.create(null), VM_GLOBALS, { harness }),
      { filename: 'dsh-unidoc/src/host.js' },
    )
    // vm realm 的 Promise 与宿主 realm 不同，instanceof 不可靠 → 用 thenable 探测
    plugin = wrapper && typeof wrapper.then === 'function' ? await wrapper : wrapper
  } catch (error) {
    console.error('[dsh-unidoc] host source execution failed:', error)
    return
  }
  if (!plugin || typeof plugin.apply !== 'function') {
    console.error('[dsh-unidoc] host source did not return a plugin object')
    return
  }

  /* ---------------- 运行插件 apply（工具 / HTTP 路由 / RPC 全部挂载） ---------------- */
  try {
    plugin.apply(fakeCtx)
  } catch (error) {
    console.error('[dsh-unidoc] apply failed:', error)
    return
  }

  /* ---------------- RPC HTTP 路由：client 端 host.call 的静态等价物 ---------------- */
  const routeDisposer = ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: rpcPath,
    handler: async (req, res) => {
      const send = (code, body) => {
        try {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(body))
        } catch (e) { /* 忽略响应错误 */ }
      }
      try {
        let raw = ''
        for await (const chunk of req) raw += String(chunk)
        const payload = raw ? JSON.parse(raw) : {}
        const method = String(payload.method || '')
        const args = payload.args
        const fn = handlers.get(method)
        if (!fn) return send(404, { ok: false, error: 'unknown rpc method: ' + method })
        const result = await fn(args)
        send(200, result)
      } catch (error) {
        send(500, { ok: false, error: error && error.message ? String(error.message) : String(error) })
      }
    },
  }), 'dsh-unidoc: rpc route')

  /* ---------------- Agent 通知（可开关） ---------------- */
  let disposeSection
  if (announce) {
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:dsh-unidoc',
      order: 150,
      text: UNIDOC_GUIDANCE,
    })
  }

  /* ---------------- 卸载回收 ---------------- */
  ctx.effect(() => () => {
    routeDisposer()
    if (disposeSection) disposeSection()
  }, 'dsh-unidoc: teardown')

  console.log('[dsh-unidoc] mounted (static shell): rpc=' + rpcPath + ', tools=doc_read/doc_edit/doc_create')
}
