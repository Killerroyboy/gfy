# GFY — team scramble site

A one-page site for the GFY golf weekend — now a 2-day team scramble. The
page is static; all live data comes from one Google Sheet that anyone in the
group can edit. Publish the sheet once, paste a few ids into `config.js`,
and the site updates itself every 60 seconds.

No servers, no accounts, no build step. If you can edit a spreadsheet, you
can run this site.

The site is **tabbed** — the sticky nav bar is the tab list (Home, Board,
Field, Calcutta, Money, Next Year, Rooms, Schedule, Pairings, Rules,
Champions, Shame, Photos). Switching tabs doesn't reload the page, and each
tab has its own deep link (`yoursite.com/#calcutta`, `#nextyear`, `#rooms`,
…) — safe to bookmark or text someone straight to a section.

---

## One-time setup

### 1. Create the sheet from the template

1. Go to [drive.google.com](https://drive.google.com) and upload
   `tools/gfy-template.xlsx` (drag it into the window).
2. Double-click the uploaded file, then **File > Save as Google Sheets**.
   Work in the Google Sheets copy from here on; the .xlsx can be deleted.
3. **Run the polish script** to set up checkboxes, dropdowns, and colors —
   the template ships its checkbox columns as plain TRUE/FALSE text (only
   possible to fix now that you're in a Google Sheet; an xlsx file can't
   hold a real Sheets checkbox). In the Google Sheet: **Extensions > Apps
   Script**, clear the placeholder code, paste in the full contents of
   `tools/sheet-polish.gs` from this repo as `Code.gs`, then run `polish()`
   from the function dropdown and click **Run**. Authorize when prompted.
   `polish()` **applies checkbox validation** to the checkbox columns — the
   `deposit` column on Field, the `settled` column on Ledger, the
   `collected` column on Calcutta, and the `invited`/`responded`/`committed`
   columns on Invites (**NOT `handicap`** — that column is a typed number, not a
   checkbox; the polish script repairs it if a broad column-conversion swept
   it up by mistake) — **without changing any cell values**. It also sets up
   the warn-mode status dropdowns, Field/Rooms coloring, and builds the
   START HERE tab, all in the same run. (Rooms has no checkbox columns —
   no checkbox step needed there.) Safe to re-run any time (see **Polish script**,
   below, for re-running after edits).

   While you're in the script editor, also add the **GFY menu**: **File >
   New > Script file** (do **not** paste over `Code.gs`), paste in
   `tools/gfy-promote.gs`, save, and reload the sheet's browser tab — a
   **GFY** menu appears with **Promote committed → Field** (the one-click
   accept flow — see **The invite list**, below) and a shortcut to
   `polish()`.

   **If the boxes come in unticked after `polish()` runs** — whether Sheets
   renders an imported TRUE/FALSE string as a ticked box depends on the
   xlsx→Sheets import and hasn't been checked against the real thing — select
   the data cells of the affected column(s), one at a time, and **Insert >
   Checkbox** by hand. **Never** the `handicap` column.
4. The sheet has 14 tabs along the bottom (Info, Course, Field, Scores, …,
   Invites, Rooms, Announce). Each has a bold header row and a few sample rows
   showing the shape.
   **Keep the header rows exactly as they are.** Replace the sample rows
   with real data.
5. **Teams, captains, and the `team` column.** Each row's `team` cell holds
   its **captain's name** — including the captain's own row, which names
   himself (so a captain's row always reads `player == team`). That's how
   the site knows who's on whose team: every row sharing a `team` value is
   one roster; the player whose name matches the team value is the captain.
   `since` is the player's first GFY year — it powers seniority badges and
   the rookie tag, and only needs to be filled once, the year they join.

### 2. Publish the sheet to the web

1. In the Google Sheet: **File > Share > Publish to web**.
2. In the dialog, set the first dropdown to **Entire document** and the
   second to **Comma-separated values (.csv)**. (Both matter.)
3. Click **Publish**, confirm, and **copy the link Google shows you**.

### 3. Find your PUB_ID  ← the step people get wrong

The link from step 2 looks like:

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vTxAMPLEtoken.../pub?output=csv
                                       ^^^^^^^^^^^^^^^^^^^^^^^^
                                       this long token is PUB_ID
```

`PUB_ID` is everything between `/d/e/` and `/pub`. It always starts with
`2PACX-`.

**This is NOT the id in your browser's address bar when you're editing the
sheet.** The edit URL (`/spreadsheets/d/1AbCd…/edit`) contains a different,
shorter id that will not work. If the site ever shows an empty leaderboard
while the sheet clearly has data, this mix-up is the cause 90% of the time.
If your PUB_ID doesn't start with `2PACX-`, you copied the wrong one.

### 4. Find each tab's gid

1. In the normal editing view of the sheet, click a tab at the bottom
   (say, **Course**).
2. Look at the browser address bar. It ends with `#gid=` followed by a
   number, e.g. `…/edit#gid=1837552901`.
3. That number is the gid for the tab you have selected. Click each of the
   14 tabs in turn and write down each number. The first tab is usually `0`.

### 5. Share the photo folder (optional)

1. Create a folder in Google Drive for the weekend's photos.
2. Right-click it > **Share** > under *General access* choose
   **Anyone with the link** as **Viewer**.
3. Open the folder; the address bar reads `…/drive/folders/1aB2cD3e…`.
   The token after `/folders/` is your `DRIVE_FOLDER_ID`.

If the folder is *not* shared this way, the site's Album section shows a
Google permission error inside the frame — it will not fail loudly. Open the
live site in a private/incognito window to check it the way guests see it.

### 6. Paste it all into `config.js`

Open `config.js` — every field has a comment showing the exact expected
format. Fill in:

- `PUB_ID` — from step 3
- `GID` — one number per tab, from step 4
- `DRIVE_FOLDER_ID` — from step 5, or leave `""`

Easiest way to edit without any tools: open the file on github.com, click
the pencil icon, paste, **Commit changes**. The live site updates itself
about a minute later.

### 7. Check your work

**Start with the health strip** — it's the first thing to check, no URL
tricks required. A one-line strip fixed at the bottom-right of the live
site (collapsed by default; tap to expand) calls out anything the sheet
gets wrong: unmatched score captains, duplicate captains, blank years,
cells it can't parse as a price or handicap, and similar. It only ever
appears when there's something real to flag — an unconfigured or fully
offline site shows no strip at all rather than a fabricated warning. If a
team is missing from the board or a number looks off, check the strip
before anything else.

For the full picture, open the live site with `?debug=1` on the end of the
address:

```
https://<your-pages-url>/?debug=1
```

A panel appears listing every tab as `OK` (with a row count), `EMPTY`, or
`FAILED` with the reason, plus the same health warnings as the strip above.
Fourteen `OK` lines means the plumbing is done (the site reads its 14
configured tabs; extra tabs like START HERE and Form Responses are ignored
by it). Remove `?debug=1` and hand out the link.

**Phones:** open the link in Safari/Chrome, then *Share > Add to Home
Screen*. It installs like an app, icon and all.

---

## The Admin vault (emails)

Everything published from the main GFY sheet is public — that's the whole
mechanism this site runs on (see the warning under "The invite list,"
below). Two kinds of information can never go on that sheet: **email
addresses**, and **why someone isn't getting invited back**. Both live in
**one place**: a second, completely separate Google Sheet — the **GFY Admin** sheet (its
template: `tools/gfy-admin-template.xlsx` → Drive → Open as Google Sheet) —
that is **never** published to the web, ever.

The GFY Admin sheet holds:

- Every email address you have for everyone, one row per person — as many
  addresses per person as you have (`email_alt` for a second one, work,
  personal, whatever).
- A do-not-invite (DNI) list: name + the reason, in plain language, so
  future-you remembers why next year.

Three rules:

1. **Never** click File → Share → Publish to web on the Admin sheet. Doing so
   makes every address and do-not-invite reason public.
2. Keep it a **separate file** — never a tab of the public GFY sheet. The
   public sheet publishes "Entire document", so any new tab auto-publishes.
3. The public Invites tab tracks *who/when/status* — names only, never an
   email address in any cell (the checker below watches for this).

**The pairing rule.** Whenever you add someone to the DNI list in GFY Admin,
also set `status` to `out` on their Invites row in the public sheet, in the
same sitting. The two rows are a pair: GFY Admin says *why* (privately), the
public Invites row says *that* (so the site actually suppresses them). One
without the other is a gap — DNI-only means the site still quietly counts
them as needing an invite; Invites-only means next year's operator has an
exclusion with no memory of why.

### Before every send round

1. Admin sheet → Contacts tab → File → Download → **CSV**. Save it OUTSIDE
   this repo folder (e.g. Downloads — the checker refuses in-repo paths).
2. `npm run presend -- ~/Downloads/<the file>.csv --vault-url <admin sheet URL> [--extra-gid responses=<gid>]`
   — the optional `--extra-gid` scans an extra published tab (e.g. the
   Form's responses tab) for leaked addresses; `npm run check-gids` prints
   that gid on its "no config entry" line if you don't have it handy.
3. Fix anything it lists (do-not-invite violations block. Unpaired
   do-not-invite names block too — give them their `out` row on Invites
   first so the site suppresses them; "missing from vault" means collect
   that address first). Log each send in SendLog.

The pre-send checker automates the DNI cross-check for you: everyone marked
DNI in GFY Admin should be `out` in Invites, and nobody about to get an
invite email should be sitting on the DNI list — it flags DNI names with
active invite rows AND unpaired DNI names missing their `out` row.

Skipped the checker? Then at minimum re-read the do_not_invite column
before sending. That list exists because someone once had a reason.

### Replies (Gmail loop)

When invite replies come in: authenticate Gmail once via `/mcp` in a Claude
session, then ask for a reply scan. You get a review list (name, address,
snippet — in the conversation only, never written to a file); you approve;
`responded` gets ticked on the Invites tab. If the scan errors with an auth
failure, re-run `/mcp` — a failed scan never means "no replies".

### Rooms fill in paid order

The Next-Year room queue orders people by `paid_date` (real dates — ISO like
2026-08-20 preferred). Blank or unparseable dates sort last. Ties on the
same day keep sheet order.

### Polish script (run after big sheet edits)

`tools/sheet-polish.gs` → Extensions → Apps Script on the LIVE sheet →
paste → run `polish()`. Safe to re-run any time — re-running never changes
cell values (the first run repairs the handicap column and autofills
Course — both one-time, evidence-gated). To verify idempotence after an
Apps Script edit: run `polish()` twice in a row and confirm no cell value
changed between runs (File → Version history).

Re-running `polish()` also rebuilds the START HERE tab and reorders the
sheet tabs by season — during the event week, tabs appear as START HERE,
Scores, Field, Pairings; off-season shows START HERE, Field, Invites, Rooms.
START HERE's rebuild includes:

- **Captain scoring links** — one row per current-season team (from Field's
  `team` column), each a ready-to-text link straight to that team's scorer.
- **Form Team dropdown** — the same team list, one per row, meant to be
  selected and pasted directly into the Google Form's Team dropdown options.
- A reminder that **team names freeze once those links go out** — renaming a
  team after captain links are sent means updating Scores' `team` values to
  match, or the writer can no longer find that team's rows.
- If an old sheet still has a value pasted in the retired "Scoring form URL"
  cell, `polish()` never drops it silently — it carries the value forward
  under a "old value preserved below, copy it to Info!" label until you
  move it over yourself (see **Live scoring** below).

Pairings also has an optional `start` column — the hole a group starts on
for a shotgun round; leave it blank for tee-time rounds and the site
renders exactly as it always has.

The polish script also OWNS conditional formatting on Field and Rooms — it
replaces all conditional-format rules on those two tabs each run. Don't
hand-add your own coloring there; it will be erased.

Sheet edits reach the site in roughly 1–6 minutes (Google republishes ~every
5 minutes; the site refreshes every 60 seconds). During a round, that's fast
enough to keep the board honest — just don't panic-refresh.

## Live scoring

During the tournament, each captain scores their own team's card straight from
their phone at a link generated just for them. The Google Form is still there
as the no-JS fallback (same validation, same sheet). Neither one replaces the
paper scorecard — see below.

### What a captain sees

Each team gets one link — `.../gfy/#score?team=<Team>` — generated for you (see
"Captain links," below) and never hand-typed. First open shows a one-time
"Scoring for **\<Team\>** — \<roster\>" confirmation; after that, that link (or
a bare `#score`) resumes straight to that team's card. To switch teams (a
captain covering two teams, or Riley filling in), tap **"Not your team?"** on
that one-time confirmation screen before confirming, or — once on the card —
tap **"not you? switch"** in the sticky header at any time; both open the same
standing "Who's scoring?" picker.

Once a captain has opened their own link at least once, the Leaderboard page
also carries a quiet **"Enter scores — Team \<Team\>"** button beside the year
picker — a fast way back into the card without re-typing the link. It only
appears on phones that have opened their captain link; a browser that never
confirmed a team sees nothing there.

The card is 18 cells, Out and In. Tap a hole, tap the score — **it sends
immediately**, no confirm screen, no undo timer, so a tap that ends up in a
pocket can never strand a send. The cell itself is the receipt: `▮ on the
sheet` (confirmed) · `⇡ saved on phone` (queued or sending, not confirmed
yet) · `▲` (the sheet disagrees with this phone — see below) · `!` (rejected
— shows the sheet's exact reason, with a retry button; "text Riley" shows up
after two retries still fail). Re-tapping an already-scored hole names the
current value on the sheet first — tap a number to replace it — nothing
overwrites silently.

**Offline is expected, not an error.** Saving to the phone never waits on a
signal — a tap always lands instantly, bars or no bars. Copy states the truth
plainly: queued scores live on this phone and send next time this page is
open with signal. If two phones ever send different numbers for the same
hole, the site never auto-picks a winner — it shows both numbers and waits
for a person to resolve it: two plain-word buttons, **"Keep the sheet"** or
**"Replace with mine."** Neither one resends anything on its own. If the real
answer is a third number — not the sheet's, not the phone's — tap "Keep the
sheet" first, then tap the cell again; that reopens the ordinary entry sheet,
where the new number goes in like any other tap.

**The paper scorecard is the tournament's system of record.** Keep it, and
turn it in, exactly like every year before this — the phone scorer and the
Form are both a convenience layer on top of the sheet, not a replacement for
the card in your pocket. If the card ever disagrees with the phone or the
sheet, the card wins.

Before `score_endpoint` exists on the Info tab (i.e., before the setup below
is finished), every scoring link is honestly inert — it reads "Scoring opens
at the tournament." and, only if `form_url` is already pasted, a "Score via
the form" link underneath. Never a dead button, never a guess. (The public
"Enter scores" button that used to open the sheet directly is gone for good —
see the retired `SHEET_EDIT_URL` comment in `config.js`. Scoring only ever
runs through a captain's link or the form now.)

### One-time setup

1. **Create the form** with these four questions, in order:
   - **Team** (dropdown, menu items hand-filled at draft night — one item per
     team captain; copy the FORM TEAM DROPDOWN block from START HERE, built by
     `polish()` from the season's Field tab, one line per option)
   - **Round** (dropdown, menu items: `1`, `2`)
   - **Hole** (dropdown, menu items: `1`, `2`, `3`, …, `18`)
   - **Team score** (Number, validation: "Between 1 and 19")

   In the form's Settings, make sure **Collect email addresses is set to
   'Do not collect'** and 'Restrict to users in your organization / require
   sign-in' stays OFF — collecting emails would publish every submitter's
   address on the public responses tab. The 'Do not collect' setting stays
   the primary defense; `npm run presend -- … --extra-gid responses=<gid>`
   can now scan that tab after the fact (detection, not prevention).
2. **Link responses**: In the form settings, click **Responses** → link responses to the GFY spreadsheet (Responses → Link to Sheets → Select existing spreadsheet → pick the GFY sheet file).
3. **Paste the triggers**: Extensions → Apps Script (on the LIVE sheet) →
   copy `tools/sheet-triggers.gs` from the repo and paste it into the script
   editor (same project as the polish script is fine) — use **File → New →
   Script file** and paste there; do **not** clear or paste over `Code.gs`,
   that's the polish script. Save, then run `setup()`
   from the function dropdown and click **Run**. Authorize when prompted.
   `setup()` checks the Scores tab's headers first and refuses to install
   anything (throws, no triggers touched) if it's shaped wrong — a `team`
   column missing (or a legacy `player` column in its place), or any of
   `h1`..`h18` missing. Fix the headers and re-run.
4. **Deploy the Web App**: still in Extensions → Apps Script, **Deploy → New
   deployment** → gear icon → **Web app** → Execute as **Me**, Who has
   access **Anyone** → **Deploy** → authorize → copy the **Web app URL**
   (ends in `/exec`). Full walkthrough + a CORS proof — run it before the
   draft-night drill and before sharing any link: `tools/spike-scorer-cors.md`.
   **Once this URL has gone out to captains, never redeploy with "New
   deployment" again** — that mints a different URL and silently orphans
   every captain link and every `score_endpoint` value already handed out.
   To ship a `sheet-triggers.gs` code change afterward, use **Manage
   deployments → edit (pencil) → Version: New version → Deploy** instead —
   same URL, new code.
5. **Save the config to the Info tab** (not the old START HERE cell — that
   one's retired; see the polish note above if you're upgrading a sheet
   that still has a value pasted there). Add two rows to **Info** (`key` in
   column A, `value` in column B):
   - `score_endpoint` → the `/exec` URL from step 4.
   - `form_url` → the form's shareable link (blue **Send** button in the
     form editor → copy the short URL). This is the fallback link the site
     shows before `score_endpoint` is configured, or if a captain prefers
     the form UI directly.

   Then re-run `polish()` — it rebuilds START HERE's **Captain scoring
   links** and **Form Team dropdown** blocks from the current Field roster.
   Confirm it landed: open the live site with `?debug=1` — the panel's last
   line reads `score endpoint: OK (<year>, <N> teams)` once configured (it
   reads `score endpoint: not configured` before this step, and never counts
   toward the tab-report's OK total either way).
6. **Check the timezone**: On the LIVE sheet, open **File → Settings** and
   confirm the time zone is set to **America/Boise** (used for `paid_date`
   stamps — see **Collecting for next year**, below).

### Captain links & the Form's Team list

Every current-season team's scoring link and Form-dropdown entry are
generated for you on START HERE — never hand-typed:

- Re-run `polish()` (Extensions → Apps Script → run `polish()`) any time the
  roster changes. It rebuilds two blocks from the live Field tab:
  **CAPTAIN SCORING LINKS** (one ready-to-text link per team) and **FORM TEAM
  DROPDOWN** (the same team list, meant to be selected and pasted directly
  into the Form's Team question options).
- **Paste these lists exactly — never retype them by hand.** A retyped name
  that doesn't match the Field `team` value byte-for-byte is a team the
  live-scoring writer can never find.
- **Team names freeze the moment these links go out.** Renaming a team
  afterward means updating every one of that team's rows on Scores to match,
  or the writer silently stops finding them.

### The draft-night drill (SC-DRILL) — blocking, before any link is texted

Do not text a single captain link, or hand out the form, until this drill has
passed live against the real deployed endpoint (~25 minutes):

1. **Pre-flight** — Scores/Field/Info headers present, `first_tee` year
   correct, sheet timezone correct, `score_endpoint` pasted into Info, sheet
   sharing restricted to named editors only, and `SHEET_EDIT_URL` confirmed
   gone from `config.js`.
2. **The 15-tap sweep** — one submission per team, every one using **round 2
   / hole 13 / score 6** (hole ≠ score on purpose — a transposition mistake
   can't accidentally pass the check). Verify 15× `ok` verdicts AND 15×
   `h13 = 6` on the Scores tab, and record the observed sheet-to-published-CSV
   lag in the ledger.
3. **Pocket test** — tap a score, lock the screen for 2 minutes; it must
   land.
4. **Airplane test** — enter 3 holes with the phone offline; all three must
   land exactly once when signal returns.
5. **Clobber test** — send a differing value for the same hole from a second
   browser; confirm it renders the conflict state (not a resend), then
   hand-fix it in the sheet and confirm it doesn't bounce back.
6. **Round-toggle spring test** — the manual round toggle is momentary; after
   one submission it must spring back to the derived default round on its
   own.
7. **Per-round canary** — Riley submits one real score at each round's first
   tee.

**Cleanup (S15):** clear every sweep-created cell **and delete the
sweep-created rows outright** — an emptied row still ghosts on the board.

### How it works

When someone submits the form (or a captain's phone POSTs to `score_endpoint`
directly), the same validator writes the score to the Scores tab (matching
the team by name, case-insensitive) — the form trigger marks its response row
with a status, and the site scorer reads the equivalent verdict back straight
from the server response:
- **applied** / **ok** — score was valid and written to Scores.
- **`applied (replaced <old>)`** — same as above, but a DIFFERENT number
  was already sitting in that cell; the mark preserves the value it
  displaced. Last write still wins — this is an audit trail, not a block.
- **`rejected: no Team answer — check the form's question titles`** — the
  writer couldn't match a "Team" question in the submission at all, usually
  because a question title got renamed.
- **`rejected: team not in roster for <year>`** — the Team answer didn't
  match any captain in that year's Field tab. This also self-diagnoses a
  stale `first_tee` in Info: if the wrong year is scoping the roster lookup,
  every submission rejects this way — check **Info** first.
- **rejected: …** — other validation failures (invalid round, hole out of
  range, invalid score, a round total already on that row, Info first_tee
  unreadable, etc.). Resubmit the hole
- **rejected: busy — resubmit** — a submission collided with another (both
  sent at the exact same moment). Resubmit; the document lock ensures they
  serialize.
- **rejected: internal error** — usually means a tab was renamed or is missing (the writer needs Scores, Field, and Info with their standard headers) — check those, and see Extensions → Apps Script → Executions for the exact error. The status cell itself carries the first 80 characters of the error.

The responses sheet (auto-created by Google Forms) has a `status` column
added by the trigger — open it to audit which submissions applied and which
were rejected. A repeated `client_id`+submission is recognized and answered
the same way again rather than written twice, so a retried send or a drained
queue entry can never double-apply.

When someone ticks the `deposit` checkbox on the Field tab, a trigger fires
`onDepositEdit()` and stamps today's date (in the sheet's time zone) into
the `paid_date` cell — only on the first tick; re-ticking never overwrites
a date that's already there, and unticking never erases it. Paid order on
the Next Year board follows `paid_date`.

## Announcements

The Announce tab is a one-way logistics feed, not a chat — post a short
dated line and the site handles the ordering, the unseen banner, and the
Home page's Updates list on its own. Columns: `year, when, message`.

**The `when` format:** `YYYY-MM-DD HH:MM`, 24-hour clock (a bare
`YYYY-MM-DD` defaults to 00:00). The time isn't decoration — it's what
orders same-day posts correctly. Two announcements posted the same morning
with no time both read as "today" and could sort either way; give each one
its own `HH:MM` and the later post reliably lands on top and reliably marks
itself unseen ahead of the earlier one.

**The future-guard:** a `when` more than 24 hours out never lights up the
unseen banner or advances anyone's watermark — it still appears in the
Updates list, at the top, since it sorts by its claimed time; it just never
triggers the banner. That means a typo'd year or a pre-written post scheduled
too far ahead can't ping every phone that opens the site, but it also means
a future-dated post is loudly visible at the top of the list even though it
never banners — check the `when` column if a post you just added isn't
showing up as new, or is sitting at the top when it shouldn't be.

**The habit:** any time you edit Schedule or Pairings mid-weekend — a
pushed tee time, a moved round, a rain delay — post an announcement in the
same sitting. The sheet edit alone is silent; nobody's phone lights up just
because a cell changed. The announcement is what tells people to look.
Paste-ready lines, edit the specifics and go:

- `Draft complete — see the Draft tab.`
- `R2 tee times posted — leaders out last.`
- `Weather delay — R2 pushed 30 min.`

**On-course reality.** This is a no-push design end to end — no servers, no
accounts, nothing that can hand a phone a notification. Someone has to have
the page open to see an update, and a chunk of the course is dead cells.
Don't count on an announcement reaching someone mid-round: a real emergency
or a pace problem goes by voice or through a marshal, same as every year
before this site existed. Announcements are for logistics people can catch
between holes or back at the lodge, not for anything that can't wait.

## Event-ready preflight

```
npm run event-ready
```

is a read-only checklist against the LIVE published sheet — run it before
any captain link goes out, and again each tournament morning. It never
writes anything; it just reads `config.js` and the sheet over the network
and reports what it finds.

Each line comes back as one of three levels:

- **FAIL** — blocks. The preflight exits 1 if any FAIL is present, so it's
  safe to script a "go/no-go" off it. Examples: an unparseable `first_tee`,
  a schedule row Now/Next could never resolve, an unarmed scorer endpoint,
  a Scores or Calcutta row whose team doesn't match any Field team —
  anything that would show up broken on the live site.
- **WARN** — advisory, doesn't block, worth a look. Examples: a `first_tee`
  that looks like last year's date, a Field row missing a handicap, an
  announcement dated more than 24h out, a Rooms row whose player doesn't
  match any Field player (skipped when the cell is empty or `guest:`-prefixed —
  Rooms is allowed to hold names Field doesn't track), an Invites row with
  `committed` ticked but no Field row for that year (the GFY-menu promotion
  hasn't been run — see **The invite list**).
- **INFO** — context, not a problem. Examples: which schedule-coverage basis
  it used, the Announce tab not being wired up yet, `form_url` intentionally
  left unset.

**The verbatim-residue limit.** One check (sample-residue) catches sheet
rows that still exactly match the template's sample data — Duck, Hammer,
Tex, straight out of `tools/gfy-template.xlsx`. It can only ever catch a
byte-for-byte match. A sample row that's been edited in place — same shape,
real-looking values typed over the sample text — is invisible to it; there's
no mechanical way to tell "real Duck" from "leftover sample row someone
half-edited." That's the live sheet's current state (see BACKLOG #6) — a
clean `event-ready` run is necessary, not sufficient, and the morning
eyeball over Field/Scores/Rooms stays in the runbook regardless of how
clean the preflight reports.

## Names — the one convention

Field.player, Invites.player, Rooms.player (and the vault's Contacts.player)
carry **first + last name**, spelled identically everywhere — the site matches
them by exact normalized text, so "Wade B." on Rooms will not match
"Wade Boggs" on Field. Scores.team and Pairings follow the **team label**
(the captain's name), not player names. That label freezes once captain
scoring links go out (START HERE's Captain scoring links block) — renaming
a team afterward means updating its `team` value on Scores to match, or the
live-scoring writer can no longer find that team's rows.

## Year to year

- New season: add rows with the new year in each tab — old years stay for
  the archive, and a year picker appears on the leaderboard automatically.
- Scores: **one row per team per round**, keyed by the captain's name in the
  `team` column (not a per-player row). Fill holes `h1…h18` as they're
  played; blanks are fine mid-round. If you only have round totals, add
  `r1` and `r2` columns to the Scores tab and put totals there instead.
  A few guards make this forgiving on a phone:
  - a blank hole cell means "not played yet" — a `0` is read the same way
    (no score), never as a hole-in-zero;
  - if the same team's round gets entered twice (someone double-taps
    "submit," or two people fill it in at once), the rows **merge**
    instead of colliding — it's normal, not an error;
  - round labels can be typed as words ("Round One", "Round Two") or
    digits (`1`, `2`) — either reads correctly.
- Update `first_tee` in the Info tab (ISO format with timezone offset,
  e.g. `2027-08-14T09:00:00-06:00`) — the countdown and calendar button
  follow it. No code changes needed for a new year.

### Rolling the whole event over (checklist)

The above covers adding a season's rows. The full pass, in order, before a
new season's captain links go out:

1. **New-season Info values.** `first_tee` (ISO **with** timezone offset,
   e.g. `2027-08-14T09:00:00-06:00`), `dates`, `course`, `lodging` — and
   anything else that changed (`deposit_amount`, `payment_handle`).
2. **Real Field/Schedule/Pairings rows** for the new season — captains and
   roster on Field, real tee times on Schedule, real groups on Pairings.
3. **Delete or replace every SAMPLE row**, on every tab, not just those
   three — the template ships sample rows (Duck, Hammer, Tex, …) meant to
   be overwritten, not built around.
4. **Run `polish()`** (Extensions → Apps Script → run `polish()`) — rebuilds
   START HERE, reapplies checkboxes/dropdowns/coloring, autofills what it
   owns.
5. **Run `npm run event-ready` until clean** (no FAIL; only expected
   WARN/INFO) — see **Event-ready preflight**, above. Fix what it flags and
   re-run; don't chase it once and stop.
6. **Re-verify the scorer endpoint** — confirm `score_endpoint` and
   `form_url` on Info still point at the current season's deployment/form.
   A stale endpoint carried over from last year silently misroutes scores
   (see **Live scoring**, above, for the "never redeploy with New
   deployment" trap).
7. **Send captain links** — only after every step above is clean. See
   **Captain links & the Form's Team list**, above; the draft-night drill
   (SC-DRILL) still applies on top of this checklist, not instead of it.

## Collecting for next year

The Next Year tab runs off next season's rows in the Field tab, added
whenever someone pays — you don't wait for the season to turn over:

1. Add a row with **next year** in the `year` column and the payer's name.
2. Tick their `deposit` checkbox.
3. Type the date it landed into `paid_date`.

(Once the triggers are installed, ticking the deposit checkbox stamps paid_date automatically — type it by hand only to backdate.)

That's it — no other columns need filling in yet. The site builds the paid
list ordered by `paid_date`, earliest first (this is also the room-
assignment order — see **Rooms**, below); a paid row with no date sorts
after the dated ones. The public Owing list is deliberately narrow: it only
shows people who already have a next-year Field row and haven't paid yet —
add someone's row as soon as you know they're in, even before the deposit
lands, so the board can nudge them by name. Everyone earlier in the process
(invited, responded, no reply yet — see "The invite list," below) stays off
the public board and only shows up under `?admin=1`.

If someone isn't coming back, set `status` to `out` on their **next-year**
Invites row (once you're using Invites at all for that season) or their
next-year Field row (honored only when Invites has no rows yet for that
season — see below) — they drop off the Next Year board without deleting
any history. A **current**-season `status` of `out` is a different thing
entirely: it only changes how someone shows on the Field tab itself (a
"not returning" note); it has no effect on the Next Year board.

## The invite list

The Invites tab tracks next season's *outreach* — who was emailed, who
wrote back, who still needs a nudge — separate from who's actually paid
(that's the Field tab, above). Its columns: `year, player, invited,
responded, status, committed`.

> **⚠ NEVER put email addresses (or anything sensitive) in this
> spreadsheet — every published tab is publicly fetchable.** Emails live in
> the separate, never-published **GFY Admin** sheet.

The workflow:

1. Add everyone you might invite back to Invites, with **next year** in
   `year`.
2. Send your invite email (mail-merge off the GFY Admin sheet, or just BCC
   everyone — the published sheet doesn't send anything itself and must
   never hold the addresses).
3. Tick `invited` for everyone you emailed.
4. Tick `responded` as replies land.
5. When someone says **yes**, tick `committed`.
6. Sheet menu **GFY → Promote committed → Field** — every committed person
   who doesn't already have a Field row for that year gets one, in a single
   click. No re-typing anybody. (Details below.)

The Next Year board turns this into a funnel — paid, responded, invited,
still needs an invite — so you can see at a glance who's stuck and where
(the counts are public; the names behind responded/invited/still-needs-an-
invite are `?admin=1`-only — see below). Someone who's already paid always
shows as paid, even if you also ticked `invited`/`responded` for them; paid
is the highest stage.

**Where `out`/`declined` belongs.** Once you've added ANY row to Invites for
a season, Invites becomes the authoritative place for that season's
`out`/`declined` — a `status` value left over on someone's Field row for the
same season is ignored (and flagged on the health strip) rather than acted
on. If you haven't touched Invites for a season at all yet, Field's own
`status` is honored instead, so the tab still works standalone. In short:
once you're using Invites, put `out`/`declined` there, not on Field.
`declined` (this season only) shows under `?admin=1` and comes back into
consideration on its own next season; `out` suppresses silently and for
good.

If you leave the Invites tab unconfigured or empty, the Next Year board just
runs the plain paid/owing view with no funnel line — nothing else changes.

### Committed → Field, one click

**Promote committed → Field** (the GFY sheet menu, from `tools/gfy-promote.gs`
— pasted during setup, step 3) is the accept flow's only moving part. For
every Invites row with `committed` ticked it appends a Field row with:

- `team` **blank** — they land in the draft pool; teams are drafted Friday
  night, and nothing on the site or sheet needs a team before that.
- `since` carried from their most recent prior Field row; a first-timer
  gets the promoted year (their rookie year, by definition — they'll show
  the ROOKIE badge and the gold tint).
- `status` = `In`, `deposit` unchecked, `handicap` left blank for you.

Safe to run as often as you like: someone who already has a Field row for
that year is never duplicated or touched, and a row that's `committed` but
also `out`/`declined` is contradictory — it's reported in the summary and
never promoted; fix one or the other. The summary popup lists exactly who
was promoted, who was already there, and what was skipped.

The site itself never reads `committed` — a Field row remains the one and
only meaning of "committed" everywhere (the owing list, the funnel's paid
stage, the draft pool). The `npm run event-ready` preflight nudges you with
a WARN if committed ticks are sitting unpromoted.

### Adding the Invites tab to a sheet you already built

If your GFY sheet predates this feature (it only has the original 11 tabs),
add the 12th tab yourself — no need to rebuild from the template:

1. In the Google Sheet, click **+** at the bottom to add a sheet, and name
   it exactly **Invites**.
2. Paste the header row into row 1: `year, player, invited, responded,
   status, committed`.
3. Select the `invited`, `responded`, and `committed` columns, one at a
   time: **Insert > Checkbox** (same one-time step as Field.deposit) — or
   just re-run `polish()`, which applies all three.
4. Click the new tab, copy its gid from the address bar (`#gid=…`, same as
   step 4 above), and paste it into `config.js` as `GID.invites`.

## Rooms

The Rooms tab tracks lodging assignments — who's in which room, at which
property. Its columns: `year, property, room, player`. The sheet only ever
stores assignments; the site derives everything else (the paid-but-not-yet-
placed queue, the health flags, the admin memory lens).

Add one row per person per room:

1. Row-per-assignment: `year`, `property` (e.g. "Bear Creek Lodge"), `room`
   (any label the property uses — "1", "3B", "Loft"), `player`.
2. A lodging guest who isn't a tournament player — someone's plus-one, a
   kid — gets a row too: prefix their name with `guest:` (e.g.
   `guest:Pat`). The site strips the prefix and shows a small **(guest)**
   mark instead; guests are never flagged as unknown or unpaid, because
   they were never expected to be on the Field/paid list in the first
   place.

The Rooms view groups everyone by property, then room (names are public —
this is a find-your-bed page), with a "Paid, not yet assigned" queue
underneath: the same paid-order list Next Year uses, minus whoever already
has a room. A filter box on the page narrows the whole view by name as you
type; that's a browser-side convenience, it never touches the sheet.

**Which year's rooms show?** Whichever year has the newest rows in the tab
— but never older than the current season, so Rooms can serve the event
that's about to happen (unlike Next Year/Invites, which are always about
next year specifically). Add rows for next year's lodging whenever you like
and the anchor follows them forward, same as Invites can run ahead. The
Rooms header displays the anchor year (e.g., "Rooms — 2026") so you see at
a glance which year's assignments you're looking at; blank-year rows default
to the tab's own maximum year and render alongside other rows for that year.

**Health flags** (site-side, automatic, on the same health strip as
everything else):
- The same player assigned to two different rooms.
- A player assigned a room who isn't on the paid list yet — "assigned but
  not paid," worth a text before they show up and find someone else's bag
  on the other bed.
- A name with no matching Field history and no `guest:` prefix — probably a
  typo, or someone who needs the `guest:` prefix.

Add `?admin=1` to the URL and each assigned player who stayed somewhere the
year before gets a small "had: Property · Room" note next to their current
assignment — handy for spreading people around without digging through last
year's sheet by hand.

## Would-pay, on the Calcutta board

Payouts figure on **gross** score by default — set the Info tab's
`calcutta_basis` key to `net` to figure them on net instead, though a
scramble roster (the normal case here, with a captain and no per-player
handicap to net against) always forces gross regardless of that key.

Next to each lot on the Calcutta board, a small second line answers "if the
tournament ended this second, what would the owner collect?" — the exact
same math as the Payout table further down the same page, just surfaced
earlier (never a separate calculation that could quietly disagree with it).
It reads **"Wins if it ended now"** while the tournament's still going, and
flips to **"Won"** once every card is in. Five situations get their own
plain-language text instead of a dollar figure: a team marked **withdrawn**
reads **"withdrawn"** (wins over every other state — a withdrawn team can't
collect no matter where its raw standing would otherwise land it); no owner
at all reads **"unsold"**; a team that hasn't posted a single hole yet reads
**"waiting on cards"**; a team that's posted but landed outside the paying
spots reads **"—"**; and, while the Course tab's pars are incomplete, every
remaining owned, scored lot reads **"awaiting pars"** instead (see below).
None of this changes what an owner owes for the lot itself — the board says
so directly: *"You owe the price regardless."* And if an unsold lot's team
places anyway, that lot's cut in the Payout table below reads **"—"** too —
there's no owner to pay, so its share stays in the pot, and the basis line
notes it: *"unsold lots' shares stay in the pot"*.

**While the Course tab's pars are incomplete**, nothing on the site makes a
rank claim off the raw stroke count — there's no fair way to compare an
18-hole total against a still-short one, so standings pause instead of
quietly ranking off it. You'll see it in five places: the leaderboard's
Pos column shows **"—"** for every team (its To-par column also relabels
itself **"Total"**, since it can't back a to-par figure either); each
scorer's own tally tile drops its to-par figure for a plain **"Thru
N"** count; the personal glance drops any rank claim ("You're leading,"
"3rd of N reporting") down to its neutral facts alone — thru N, plus who's
still pending on their phone; the Calcutta payout panel replaces the
payout table with *"Payouts wait on the Course tab — standings need all
18 pars."* and its basis line reads *"Paused · Course pars incomplete"*;
and each owned, scored lot's would-pay line reads **"awaiting pars"** as
above. Money already collected or owed — the pot, rake, payable total, top
bid, outstanding balances — is unaffected; only rank claims pause. The fix
is the same everywhere: fill in the missing or invalid par cells on the
Course tab — the health strip names the exact hole.

If a team has to withdraw mid-tournament, set that player's **current-
season** Field `status` to `wd`. The board excludes them from the
Projected → Final flip (so one incomplete card doesn't hold the rest of the
field at "Projected" forever), flags it on the health strip, and marks the
team with a small **WD** tag on the board. Nothing needs to be deleted —
their partial card and their Calcutta lot both stay exactly as they were.

## When something looks wrong

| Symptom | Likely cause |
|---|---|
| Empty leaderboard, sheet has data | Wrong PUB_ID (edit-URL id instead of the published `2PACX-…` id) — see step 3 |
| One section empty, rest fine | That tab's gid is wrong or missing in `config.js` — run `npm run check-gids` to diff `config.js` against the live sheet's tabs |
| Team missing from board | The captain's name in Scores' `team` column doesn't match any team in Field — check the health strip, it names the mismatch |
| Edits don't show up | Google republishes on a short delay — wait ~5 min; also check File > Share > Publish to web is still active |
| Album shows a permission error | Drive folder not shared "Anyone with the link" — step 5 |
| Link shows every team, not just mine | the link's team doesn't match this season's Field roster (stale bookmark/typo/pre-draft link) — pick your team once, or re-copy your link from START HERE after the draft |
| Anything else | Check the health strip, then add `?debug=1` to the URL and read the panel |

## Admin quick edits (cheat-sheet)

The things an operator actually touches most years, in one place:

| Want to... | Edit... |
|---|---|
| Change the event date | **Info** tab, `first_tee` (ISO format with timezone offset, e.g. `2027-08-14T09:00:00-06:00`) |
| Set lodging arrangements | **Rooms** tab — one row per person per room; `guest:Name` for non-players |
| Change a team / its captain | **Field** tab, the `team` column — the captain's own row always has `player == team` |
| Enter a Calcutta bid | **Calcutta** tab — one row per team lot: `team`, `owner`, `price`; tick `collected` once the pot's been paid |
| Change the house rake | **Info** tab, `calcutta_rake` — a plain percentage number (`10` = 10%); if the real intent is "no rake," use `0` explicitly, don't leave it blank or type words |
| Record a podium finish | **Champions** tab — place 1/2/3 (blank = 1st, old rows fine) + players = that team's roster, any separator. Backfill history and the podium + draft badges light up. |
| Add a scouting note | **Field** tab, `strengths` column — optional; shows on the public #draft board next to the player. |
| Run draft night | **Field** tab, `team` column — filling a player's team cell IS drafting them; the site's Draft tab follows live; the pool empties as you type. Afterward, re-run `polish()` and copy the FORM TEAM DROPDOWN block from START HERE into the Form's Team dropdown. |

**Vault:** see "The Admin vault (emails)" further up — one authoritative
section.

## For whoever maintains this

```
index.html                    the whole app (HTML + CSS + JS, no build step)
config.js                     the only file you edit routinely
tools/make_template.py        regenerates tools/gfy-template.xlsx
tools/make_admin_template.py  regenerates tools/gfy-admin-template.xlsx (the never-published vault template)
tools/sheet-polish.gs         Apps Script sheet hygiene — checkboxes, dropdowns, Course autofill (see above)
tools/sheet-triggers.gs       Apps Script live-scoring triggers — form writer + paid_date stamp (see above)
tools/gfy-promote.gs          Apps Script GFY menu — one-click Promote committed → Field (see The invite list)
tools/presend-check.mjs       the pre-send checker — vault diff, DNI check, email-leak watchdog (see above)
tools/check_template.py       drift check: xlsx templates vs their generators (npm run check-template)
tools/gid-check.mjs           drift check: config.js gids vs the live published sheet (npm run check-gids)
fixtures/                     sample CSVs mirroring the 14 tabs, incl. edge cases
test/smoke.mjs                headless render test against the fixtures
```

Run the test before deploying any change:

```
npm install
npm test        # the last line must read TALLY TOTAL with zero failures
```

Local preview (config.js does not load right from a double-clicked file —
always use a local server):

```
python3 -m http.server 8000     # then open http://localhost:8000
```
