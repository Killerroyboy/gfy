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

/* Pure operator decision — deliberately NOT folded into classify().
   classify() answers "which code is bound to this URL", and it is right to call
   a bound-but-erroring handler REAL: the real code IS deployed (SC27-2 pins
   this, and doGet's catch branch emits the identity envelope on purpose so a
   broken real handler can never be mistaken for the echo stub).
   This answers the different question the operator is actually asking at 11pm:
   "may I drill against this?" A handler that throws on every request is the
   real handler and is still not drillable — and every runbook treats a REAL
   print as the green light, so the green light has to be able to say no. */
export function advise({ verdict, ok } = {}) {
  if (verdict === "REAL" && ok !== true) {
    return {
      proceed: false, exit: 2,
      headline: "REAL but FAILING",
      why: "the real handler is bound — and it answered with ok:false, so it is throwing on every request",
      // The remedy differs from the stub's, which is the whole reason this is
      // not exit 1: redeploying fixes a stub and does nothing for a throw.
      remedy: [
        "This is NOT the stub — do not redeploy to fix it; the right code is already bound.",
        "doGet only reports ok:false from its catch branch, so something it touches is failing:",
        "  - the script is not container-bound to the sheet (SpreadsheetApp.getActive() is null)",
        "    — it must live in the SHEET's own Apps Script project, not a standalone one;",
        "  - the deployment's 'Execute as' is not you, so it cannot read the sheet;",
        "  - authorization was never granted (open the editor and run doGet once by hand).",
        "Fix the binding, then re-run this probe. Do NOT start the drill.",
      ],
    };
  }
  if (verdict === "REAL") {
    return { proceed: true, exit: 0, headline: "REAL", why: "the real handler is bound and answering cleanly", remedy: [] };
  }
  if (verdict === "STUB") {
    return {
      proceed: false, exit: 1, headline: "STUB", why: "an echo deployment — scores would be accepted and never written",
      remedy: [
        "DO NOT ARM. Redeploy the real handler onto this SAME deployment URL",
        "(Manage deployments -> Edit -> New version), then re-run this probe.",
      ],
    };
  }
  return {
    proceed: false, exit: 2, headline: verdict || "UNCERTAIN",
    why: "neither armed nor proven unarmed",
    remedy: ["State unknown — neither armed nor proven unarmed. Resolve before drilling."],
  };
}

/* Only ONE verdict is indeterminate. STUB, REAL and UNCERTAIN are answers —
   retrying them would launder a real result, and STUB is the single verdict
   this whole tool exists to catch, so it must never be re-rolled. */
export function shouldRetry(verdict) { return verdict === "UNREACHABLE"; }

/* Network layer, kept out of classify() so the decision stays pure.
   MEASURED 2026-09-28: 1 run in 4 against the live deployment returned
   "UNREACHABLE HTTP 404" while the endpoint was healthy. Apps Script answers
   /exec with a 302 to a googleusercontent echo URL carrying a short-lived
   user_content_key; following a stale one 404s. Unretried, that reads as a
   dead endpoint and sends the operator into deployment settings that were
   never wrong. Bounded retries + a visible attempt count keep it honest (S2):
   a persistent failure still reports UNREACHABLE. */
export async function probeUrl(url, { attempts = 3, fetchImpl, sleep } = {}) {
  const doFetch = fetchImpl || ((u) => fetch(u, { redirect: "follow" }));
  const nap = sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  let r;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await doFetch(url);
      r = classify({ status: res.status, contentType: res.headers.get("content-type") || "", body: await res.text() });
    } catch (e) { r = classify({ networkError: e.message }); }
    r.attempts = i;
    if (!shouldRetry(r.verdict)) return r;
    if (i < attempts) await nap(400 * i);
  }
  return r;
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
  const r = await probeUrl(url);
  console.log(`${r.verdict}  ${r.why}${r.attempts > 1 ? `  (after ${r.attempts} attempts)` : ""}`);
  const a = advise(r);
  if (r.verdict === "REAL") {
    console.log(`           roster read back: year=${r.year}, ${r.teams} team(s), ok=${r.ok}`);
    if (r.teams === 0) console.log("           NOTE: zero teams — the handler is real but the Field roster is empty for that year.");
  }
  if (a.proceed) {
    console.log("\nThe real handler is bound. Continue with SC-DRILL step 2 —");
    console.log("and remember the drill passes on a ROW APPEARING in Scores, never on a 200.");
    process.exit(a.exit);
  }
  // Everything below is a refusal. Name the state first, then the remedy for
  // THAT state — a stub and a throwing handler look alike on the wire and are
  // fixed by opposite actions.
  console.log(`\n${a.headline} — ${a.why}`);
  for (const line of a.remedy) console.log(line);
  process.exit(a.exit);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
