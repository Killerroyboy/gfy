#!/usr/bin/env node
/* §27 SC-PROBE — what is actually deployed at score_endpoint?
   Read-only, stdout-only. GETs the Web App and classifies the DEPLOYMENT, not
   the HTTP call. Apps Script serves an old bound version from the same URL
   after an incomplete redeploy, and the §18 spike stub answers 200 with JSON
   while writing nothing — so a 200 proves the URL resolves and nothing more.
   Exit 0 = REAL. Exit 1 = STUB (a deployment that will silently eat scores).
   Exit 2 = UNCERTAIN/UNREACHABLE — reported as NEITHER pass nor fail (S2), an
   unknown state on a crossing surface being its own answer. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readConfig } from "./presend-check.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));

export const EXPECTED_HANDLER = "gfy-scorer";

/* Pure classifier — the whole decision, so it can be tested without a network.
   `body` is the raw response text; `status`/`contentType` describe the HTTP
   layer. Never infers REAL from shape alone: only the explicit identity
   envelope (SC-IDENT) earns REAL. */
export function classify({ status, contentType = "", body = "", networkError = "" }) {
  if (networkError) return { verdict: "UNREACHABLE", why: `network: ${networkError}` };
  if (status !== 200) return { verdict: "UNREACHABLE", why: `HTTP ${status}` };
  let j = null;
  try { j = JSON.parse(body); } catch { j = null; }
  if (j === null || typeof j !== "object") {
    // Google serves an HTML sign-in/consent interstitial when access is not
    // "Anyone" — a real and common misconfiguration, worth naming precisely.
    const looksHtml = /^\s*</.test(body) || /text\/html/.test(contentType);
    return { verdict: "UNCERTAIN", why: looksHtml
      ? "HTML, not JSON — the deployment is probably not shared with 'Anyone' (consent/sign-in page)"
      : "response was not JSON — cannot tell what is deployed" };
  }
  if (j.handler === EXPECTED_HANDLER && j.writes === true) {
    return { verdict: "REAL", why: `identity envelope present (handler=${j.handler}, contract=${j.contract ?? "?"})`,
             contract: j.contract ?? null, ok: j.ok === true, year: j.year ?? null,
             teams: Array.isArray(j.teams) ? j.teams.length : null };
  }
  if (j.handler !== undefined && j.handler !== EXPECTED_HANDLER) {
    return { verdict: "UNCERTAIN", why: `a DIFFERENT handler answered (handler=${JSON.stringify(j.handler)}) — wrong script project or wrong deployment` };
  }
  if (j.writes === false) {
    return { verdict: "STUB", why: "handler declares writes:false — an echo deployment; scores would be accepted and never written" };
  }
  return { verdict: "STUB", why: "JSON with NO identity envelope — this is the §18 echo stub or a pre-SC-IDENT version; it returns 200 and writes nothing" };
}

export function readEndpoint(configText) {
  // The endpoint lives in the live sheet's Info tab, not in the repo. Accept it
  // as an argument or GFY_SCORE_ENDPOINT; config.js is only a fallback for the
  // day someone pins it there.
  const { pub } = readConfig(configText || "");
  return { pub };
}

async function main() {
  const url = process.argv[2] || process.env.GFY_SCORE_ENDPOINT || "";
  console.log("SC-PROBE — classifies the DEPLOYMENT, never the HTTP status.");
  console.log("A 200 means the URL resolved. It does not mean scores will land.\n");
  if (!url) {
    console.log("UNCERTAIN  no endpoint given.");
    console.log("           usage: npm run check-endpoint -- <score_endpoint url>");
    console.log("           (the URL is Info!score_endpoint on the live sheet)");
    process.exit(2);
  }
  if (!/^https:\/\/script\.google\.com\//.test(url)) {
    console.log(`UNCERTAIN  not a script.google.com URL: ${url}`);
    process.exit(2);
  }
  let r;
  try {
    const res = await fetch(url, { redirect: "follow" });
    r = classify({ status: res.status, contentType: res.headers.get("content-type") || "", body: await res.text() });
  } catch (e) {
    r = classify({ networkError: e.message });
  }
  console.log(`${r.verdict}  ${r.why}`);
  if (r.verdict === "REAL") {
    console.log(`           roster read back: year=${r.year}, ${r.teams} team(s), ok=${r.ok}`);
    if (r.teams === 0) console.log("           NOTE: zero teams — the handler is real but the Field roster is empty for that year.");
    console.log("\nThe real handler is bound. Continue with SC-DRILL step 2 —");
    console.log("and remember the drill passes on a ROW APPEARING in Scores, never on a 200.");
    process.exit(0);
  }
  if (r.verdict === "STUB") {
    console.log("\nDO NOT ARM. Redeploy the real handler onto this SAME deployment URL");
    console.log("(Manage deployments -> Edit -> New version), then re-run this probe.");
    process.exit(1);
  }
  console.log("\nState unknown — neither armed nor proven unarmed. Resolve before drilling.");
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
