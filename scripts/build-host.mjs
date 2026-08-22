#!/usr/bin/env node
/* ============================================================================
 * dsh-unidoc — host half builder (esbuild)
 *
 * 用 esbuild 把静态 host 外壳 lib/index.js 重新打包为 lib/index.js：
 *   - platform=node / format=esm：产物保持 Node ESM，可直接被 DSH Cordis 加载
 *   - @deepseek-ai/dsh-tools 保持 external：运行时由 DSH 自身的模块图提供，
 *     避免把未发布的私有包内联进产物
 *   - 运行期 src/host.js 仍通过 new URL('../src/host.js', import.meta.url)
 *     读取（产物位于 lib/，因此 src/ 随包发布）
 *
 * 用法：node scripts/build-host.mjs
 * 产物：lib/index.js（esbuild bundle）
 * ========================================================================== */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = path.join(ROOT, 'lib', 'index.js')

await build({
  entryPoints: [ENTRY],
  outfile: ENTRY,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external: ['@deepseek-ai/dsh-tools'],
  allowOverwrite: true,
  sourcemap: false,
  logLevel: 'info',
})

console.log('OK   lib/index.js (esbuild bundle)')
