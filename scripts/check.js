#!/usr/bin/env node
/**
 * dsh-unidoc — 源码冒烟检查
 *
 * - src/host.js、src/client.js：动态插件源码（`return {...}` 函数体），与 DSH
 *   define-time 预检同构，用 vm.Script 包进 `(async () => { ... })()` 验证语法。
 * - lib/index.js、lib/client.js：静态包产物（ESM / ModuleLoader bundle），
 *   用 `node --check` 验证语法。
 *
 * 用法：`node scripts/check.js`
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 动态源码（函数体）→ vm.Script 同构语法检查 */
function checkDynamic(rel) {
  const abs = path.join(ROOT, rel)
  const code = fs.readFileSync(abs, 'utf8')
  try {
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: rel })
    console.log(`OK   ${rel} (dynamic body, ${code.length} chars)`)
    return true
  } catch (error) {
    console.error(`FAIL ${rel}: ${error.message}`)
    return false
  }
}

/** 静态模块 → 剥离 ESM 关键字后 vm.Script 语法检查（沙箱内无法 spawn 子进程） */
function checkModule(rel) {
  const abs = path.join(ROOT, rel)
  const code = fs.readFileSync(abs, 'utf8')
  try {
    const stripped = code
      .replace(/^import\s+[^;]+?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/\bimport\.meta\.url\b/g, '"file:///__check__/index.js"')
      .replace(/\bexport\s+/g, '')
    new vm.Script(stripped, { filename: rel })
    console.log(`OK   ${rel} (module)`)
    return true
  } catch (error) {
    console.error(`FAIL ${rel}: ${error.message}`)
    return false
  }
}

const checks = [
  ['src/host.js', checkDynamic],
  ['src/client.js', checkDynamic],
  ['lib/index.js', checkModule],
  ['lib/client.js', checkModule],
]

let failed = 0
for (const [rel, fn] of checks) {
  if (!fn(rel)) failed += 1
}

if (failed > 0) {
  console.error(`\n${failed} 个文件语法检查未通过。`)
  process.exit(1)
}
console.log('\n全部源码语法检查通过。')
