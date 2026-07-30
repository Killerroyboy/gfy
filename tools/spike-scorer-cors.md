# Spike: prove the live scorer's CORS chain works (§18 SC-WRITE spike gate)

**Purpose:** before any client-side scorer work lands, prove that a browser on
`killerroyboy.github.io` can POST JSON to the sheet's Apps Script Web App and read
back a parsed JSON response — the whole reason rev 2 exists (endpoint-confirmed
writes instead of trusting the lagging published CSV). ~20 minutes, Riley's Google
account, live sheet.

If this spike fails, STOP — do not build the client transport (Task 4) against a
broken chain. The fallback is per-team prefilled Google Form links (no site
scorer), not rev 1's form-riding transport. Report back before continuing.

## 1. Deploy the Web App

On the LIVE sheet (the one with `tools/sheet-triggers.gs` pasted in, per the
README's Live scoring setup):

1. **Extensions → Apps Script**.
2. Top right, **Deploy → New deployment**.
3. Click the gear next to "Select type" → **Web app**.
4. Settings:
   - **Execute as: Me** (your Google account — the script runs with your sheet
     access, not the caller's).
   - **Who has access: Anyone** (this is what makes it reachable from a phone on
     the golf course with no Google login — it is NOT a data leak: `doPost`/
     `doGet` only ever return `{ok, verdict, team, round, holes}` / `{ok, year,
     teams}`, never raw rows, and writes are gated by the same roster check as
     the form).
5. **Deploy**. Authorize when prompted (first time only).
6. Copy the **Web app URL** — this is the `exec` URL, e.g.
   `https://script.google.com/macros/s/AKfycb.../exec`. This is what becomes the
   Info tab's `score_endpoint` value later (Task 6/8, not this spike).

## 2. curl probe (proves the deployment itself works, before touching CORS)

Run from a terminal (not the browser — this step just proves the endpoint
answers JSON at all, with the right access settings; curl doesn't enforce CORS
so it can't test the browser cross-origin path — that's step 3):

```bash
curl -s -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"team":"CORS-PROBE-NONTEAM"}' \
  -L "<PASTE-YOUR-EXEC-URL-HERE>"
```

`-L` is required — Apps Script Web Apps answer with a `302` redirect to
`script.googleusercontent.com` before the real response; without `-L` curl
just prints the redirect page.

**Deliberately use a team name that does not exist** (`CORS-PROBE-NONTEAM` or
similar) so this probe can never accidentally write a real score — it only
proves round-trip JSON.

- **PASS**: prints exactly
  `{"ok":false,"verdict":"team not in roster","team":"CORS-PROBE-NONTEAM","round":0,"holes":null}`
- **FAIL**: HTML (a Google sign-in page, usually containing
  `accounts.google.com`) → access isn't set to "Anyone", redo step 1.4. A
  timeout or connection error → wrong URL or deployment not live yet.

Also sanity-check the read side (no write, safe to run anytime):

```bash
curl -s -L "<PASTE-YOUR-EXEC-URL-HERE>"
```

**PASS**: `{"ok":true,"year":2026,"teams":["Duck","Sully",...]}` (real teams
from the Field tab for the current season). If `teams` is empty or `year` is
`null`, check the Info tab's `first_tee` value and the Field tab's `year`
column before going further — the endpoint is reachable but the sheet data
isn't what the scorer expects.

## 3. Browser probe (the actual thing being spiked: cross-origin fetch)

Open **`https://killerroyboy.github.io/gfy/?debug=1`** in a real browser tab
(the live site, not a local copy — the origin is what CORS cares about), open
devtools (F12) → **Console**, paste this (swap in your exec URL), and hit
Enter:

```js
fetch("<PASTE-YOUR-EXEC-URL-HERE>", {method: "POST",
  headers: {"Content-Type": "text/plain;charset=utf-8"},
  body: JSON.stringify({team: "CORS-PROBE-NONTEAM"}), redirect: "follow"})
  .then(r => r.text())
  .then(t => console.log("PARSED:", JSON.parse(t)))
  .catch(e => console.error("FAILED:", e));
```

- **PASS**: the console prints
  `PARSED: {ok: false, verdict: 'team not in roster', team: 'CORS-PROBE-NONTEAM', round: 0, holes: null}`
  — a real parsed object, no red error above it.
- **FAIL**: a red `FAILED: TypeError: Failed to fetch` (CORS blocked, or a
  network/DNS problem) — this is the failure mode that kills rev 1's
  transport approach; if you see this, stop and report it, do not proceed to
  Task 4. **FAIL** also if `JSON.parse` itself throws (`PARSED` line never
  prints, a `SyntaxError` shows instead) — means the response body wasn't
  JSON (usually a Google sign-in page — access isn't "Anyone").

## PASS/FAIL summary

| Check | PASS | FAIL |
|---|---|---|
| curl POST | real JSON verdict | HTML / timeout |
| curl GET | `{ok:true,year,teams:[...]}` with real teams | empty teams / null year |
| browser fetch | parsed JSON object, no thrown error | `Failed to fetch` or `SyntaxError` |

All three PASS → the chain is proven; Task 4's client transport can build
against it with confidence. Any FAIL → stop, report which check failed and the
exact console/curl output, before any client-side work proceeds.

## Redeploy rule — read this before ever touching Deploy again

Once an exec URL has gone out to captains (pasted into the Info tab's
`score_endpoint`, and baked into per-captain scorer links), **that URL must
never change**:

- To ship a code change to `sheet-triggers.gs`: paste the updated code into
  the same Apps Script project, then **Deploy → Manage deployments → click
  the pencil/edit icon on the existing Web app deployment → Version: New
  version → Deploy**. This keeps the same exec URL.
- **NEVER** use **Deploy → New deployment** again once an exec URL is live —
  that mints a brand-new URL and silently orphans every link already texted
  to captains (they'd keep POSTing to a dead URL with no error visible to
  them until someone notices scores aren't landing).
- After any redeploy (new version), re-run the step-2 curl probe once against
  the same exec URL as a cheap smoke check that the new code is live and
  still answers correctly.
