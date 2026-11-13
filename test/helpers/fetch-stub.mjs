// Test helper: preloaded with `node --import` so tools that call the global fetch never touch the network.
// GFY_PUBHTML_FIXTURE = a file served for any .../pubhtml URL; every other URL fails like an offline machine.
import { readFileSync } from "node:fs";
globalThis.fetch = async url => {
  if (/\/pubhtml(\?|$)/.test(String(url)) && process.env.GFY_PUBHTML_FIXTURE) {
    const body = readFileSync(process.env.GFY_PUBHTML_FIXTURE, "utf8");
    return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => body };
  }
  throw new Error("offline (test stub)");
};
