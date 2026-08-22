// lib/index.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { defineTool } from "@deepseek-ai/dsh-tools";
var __dirname = fileURLToPath(new URL(".", import.meta.url));
var HOST_SOURCE = readFileSync(new URL("../src/host.js", import.meta.url), "utf8");
var name = "unidoc";
var inject = [
  "webServer",
  "tools",
  "fs",
  "sandboxPolicy",
  "agents",
  "sessionQuery",
  "systemPrompt"
];
var UNIDOC_GUIDANCE = "\u672C\u673A\u5DF2\u5B89\u88C5 dsh-unidoc \u63D2\u4EF6\uFF08\u901A\u7528\u6587\u6863\u4E2D\u5FC3\uFF09\uFF1AAgent \u4FA7\u63D0\u4F9B doc_read / doc_edit / doc_create \u4E09\u4E2A\u6587\u6863\u5DE5\u5177\uFF0C\u53EF\u8BFB\u5199\u5F53\u524D\u5DE5\u4F5C\u533A\u5185\u7684\u6587\u6863/\u4EE3\u7801\u6587\u4EF6\uFF1BGUI \u4FA7\u63D0\u4F9B\u300C\u6587\u6863\u4E2D\u5FC3\u300D\u5DE5\u4F5C\u53F0\uFF08\u6587\u4EF6\u6811 + \u591A\u683C\u5F0F\u9884\u89C8/\u7F16\u8F91\uFF09\u3002\u7528\u6237\u63D0\u5230\u300C\u6587\u6863\u4E2D\u5FC3 / unidoc / doc_read / doc_edit / doc_create\u300D\u65F6\u5373\u6307\u672C\u63D2\u4EF6\uFF0C\u8BF7\u636E\u6B64\u534F\u4F5C\u3002";
var VM_GLOBALS = {
  // 供 unidoc.openWithEditor 使用：spawn 已按需注入（detached + unref 由源码控制），
  // IS_WIN32 仅暴露平台标志，不暴露完整 process 对象。
  spawn,
  IS_WIN32: process.platform === "win32",
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
  decodeURIComponent
};
async function apply(ctx, config = {}) {
  const enabled = config.enabled !== false;
  const announce = config.announceToAgent !== false;
  const rpcPath = config.rpcPath || "/api/dsh-unidoc/rpc";
  if (!enabled) return;
  const handlers = /* @__PURE__ */ new Map();
  const harness = {
    handle(method, fn) {
      if (typeof method !== "string" || typeof fn !== "function") return;
      handlers.set(method, fn);
    },
    defineTool(def) {
      return defineTool(def);
    },
    registerTool(_fakeCtx, tool) {
      if (tool && typeof tool.name === "string") return ctx.tools.register(tool);
      return void 0;
    }
  };
  const fakeCtx = {
    get(name2) {
      const value = ctx[name2];
      return value;
    },
    effect(fn, label) {
      return ctx.effect(fn, label);
    }
  };
  let plugin;
  try {
    const wrapper = vm.runInNewContext(
      `(async () => {
${HOST_SOURCE}
})()`,
      Object.assign(/* @__PURE__ */ Object.create(null), VM_GLOBALS, { harness }),
      { filename: "dsh-unidoc/src/host.js" }
    );
    plugin = wrapper && typeof wrapper.then === "function" ? await wrapper : wrapper;
  } catch (error) {
    console.error("[dsh-unidoc] host source execution failed:", error);
    return;
  }
  if (!plugin || typeof plugin.apply !== "function") {
    console.error("[dsh-unidoc] host source did not return a plugin object");
    return;
  }
  try {
    plugin.apply(fakeCtx);
  } catch (error) {
    console.error("[dsh-unidoc] apply failed:", error);
    return;
  }
  const routeDisposer = ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: rpcPath,
    handler: async (req, res) => {
      const send = (code, body) => {
        try {
          res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(body));
        } catch (e) {
        }
      };
      try {
        let raw = "";
        for await (const chunk of req) raw += String(chunk);
        const payload = raw ? JSON.parse(raw) : {};
        const method = String(payload.method || "");
        const args = payload.args;
        const fn = handlers.get(method);
        if (!fn) return send(404, { ok: false, error: "unknown rpc method: " + method });
        const result = await fn(args, { req });
        send(200, result);
      } catch (error) {
        send(500, { ok: false, error: error && error.message ? String(error.message) : String(error) });
      }
    }
  }), "dsh-unidoc: rpc route");
  let disposeSection;
  if (announce) {
    disposeSection = ctx.systemPrompt.section({
      name: "plugin:dsh-unidoc",
      order: 150,
      text: UNIDOC_GUIDANCE
    });
  }
  ctx.effect(() => () => {
    routeDisposer();
    if (disposeSection) disposeSection();
  }, "dsh-unidoc: teardown");
  console.log("[dsh-unidoc] mounted (static shell): rpc=" + rpcPath + ", tools=doc_read/doc_edit/doc_create");
}
export {
  apply,
  inject,
  name
};
