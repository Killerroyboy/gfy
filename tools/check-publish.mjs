#!/usr/bin/env node
/* CHECK-PUBLISH (WO-ONE-FILE): the safety net for keeping private tabs (Contacts, Replies, RSVP, SendLog,
   Dashboard, Admin READ ME) in the SAME spreadsheet as the published tournament tabs. Fetches
   https://docs.google.com/spreadsheets/d/e/<PUB_ID>/pubhtml, lists the published tab names and:
     FAIL (exit 1)        a private tab is published - names it
     WARN (exit 0)        a tab that is neither private nor one the site reads - names it
     UNVERIFIED (exit 2)  fetch failed / page not parseable - nothing was verified (never a clean result)
   PUB_ID comes from config.js. Read-only; no writes anywhere. Run: npm run check-publish */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRIVATE_TABS, EXTRA_PUBLIC_TABS } from "./private-tabs.mjs";
import { readConfig } from "./presend-check.mjs";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const normTab = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();

const unesc = s => String(s)
  .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\(.)/g, "$1");
const unent = s => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Two shapes of pubhtml (the second is the older/menu markup): the JS array `items.push({name: "...", gid: "..."})`
// and `<li id="sheet-button-<gid>"><a>Name</a></li>`. A single published tab is the same shapes with one entry.
// Names that are present in BOTH shapes are listed once.
export function parsePublishedTabs(html) {
  const text = String(html == null ? "" : html);
  const names = [];
  const add = n => { const t = String(n).trim(); if (t && !names.some(x => normTab(x) === normTab(t))) names.push(t); };
  for (const m of text.matchAll(/items\.push\(\{\s*name:\s*"((?:[^"\\]|\\.)*)"/g)) add(unesc(m[1]));
  for (const m of text.matchAll(/<li\b[^>]*\bid="sheet-button-[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) add(unent(m[1].replace(/<[^>]*>/g, "")));
  return { names };
}

export function expectedPublic(gids) {
  const s = new Set();
  Object.keys(gids || {}).forEach(k => { s.add(normTab(k)); s.add(normTab(k.replace(/_/g, " "))); });
  EXTRA_PUBLIC_TABS.forEach(n => s.add(normTab(n)));
  return s;
}

export function publishVerdict({ html, gids }) {
  const { names } = parsePublishedTabs(html);
  if (!names.length) return { level: "UNVERIFIED", tabs: [], private: [], unknown: [], message: "could not read the published tab list from pubhtml - NOTHING verified (a tool failure, not a clean result)" };
  const priv = new Set(PRIVATE_TABS.map(normTab)), pub = expectedPublic(gids);
  const bad = names.filter(n => priv.has(normTab(n)));
  const unknown = names.filter(n => !priv.has(normTab(n)) && !pub.has(normTab(n)));
  if (bad.length) return { level: "FAIL", tabs: names, private: bad, unknown, message: "PRIVATE TAB PUBLISHED: " + bad.join(", ") };
  if (unknown.length) return { level: "WARN", tabs: names, private: [], unknown, message: "published tab(s) the site does not read: " + unknown.join(", ") };
  return { level: "OK", tabs: names, private: [], unknown: [], message: "OK - private tabs not published" };
}

// For `npm run event-ready`: the verdict as event-ready result rows ({level, detail}). A FAIL for a published private
// tab AND for "could not read it" (an unverified publish state is not a clean one); WARN for an unknown public tab.
export function eventReadyResults({ html, error, gids }) {
  if (error || html == null) return [{ level: "FAIL", detail: `publish check: could not read pubhtml (${error || "no page"}) - cannot confirm the private tabs are unpublished` }];
  const v = publishVerdict({ html, gids });
  if (v.level === "FAIL") return [{ level: "FAIL", detail: `publish check: ${v.message}` }];
  if (v.level === "UNVERIFIED") return [{ level: "FAIL", detail: `publish check: ${v.message}` }];
  if (v.level === "WARN") return [{ level: "WARN", detail: `publish check: ${v.message}` }];
  return [{ level: "PASS", detail: `publish check: ${v.message}` }];
}

export async function fetchPubhtml(pub, fetchFn = fetch) {
  const res = await fetchFn(`https://docs.google.com/spreadsheets/d/e/${pub}/pubhtml`);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

async function main() {
  const { pub, gids } = readConfig(readFileSync(path.join(REPO, "config.js"), "utf8"));
  if (!pub) { console.log("config.js has no PUB_ID - is the sheet wired?"); process.exitCode = 2; return; }
  let html;
  try { html = await fetchPubhtml(pub); }
  catch (e) { console.log(`could not fetch pubhtml (${e.message}) - NOTHING verified`); process.exitCode = 2; return; }
  const v = publishVerdict({ html, gids });
  console.log(`published tabs (${v.tabs.length}): ${v.tabs.join(", ")}`);
  console.log(`${v.level === "OK" ? "PASS" : v.level}  publish check: ${v.message}`);
  process.exitCode = v.level === "FAIL" ? 1 : v.level === "UNVERIFIED" ? 2 : 0;
}

// Import-safe CLI guard (same realpath pattern as gid-check / presend-check).
const invoked = process.argv[1] && (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (invoked) main();
