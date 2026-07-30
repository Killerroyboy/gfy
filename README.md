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
3. **Turn the sample TRUE/FALSE cells into real checkboxes** (one-time, and
   only possible now that you're in a Google Sheet — an xlsx file can't hold
   a Sheets checkbox, so the template ships the text values instead). Select
   the `deposit` column on Field, the `settled` column on Ledger, the
   `collected` column on Calcutta, and the `invited`/`responded` columns on
   Invites, one at a time: **Insert > Checkbox**. Sheets converts the
   existing TRUE/FALSE values into checked/unchecked boxes in place —
   nothing else to redo. (Rooms has no checkbox columns — skip it here.
   **NOT `handicap`** either — that column is a typed number, not a
   checkbox; the polish script repairs it if a broad column-conversion
   swept it up by mistake.)
4. The sheet has 13 tabs along the bottom (Info, Course, Field, Scores, …,
   Invites, Rooms). Each has a bold header row and a few sample rows showing
   the shape.
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
   13 tabs in turn and write down each number. The first tab is usually `0`.

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
Thirteen `OK` lines means the plumbing is done (the site reads its 13
configured tabs; extra tabs like START HERE and Form Responses are ignored
by it). Remove `?debug=1` and hand out the link.

**Phones:** open the link in Safari/Chrome, then *Share > Add to Home
Screen*. It installs like an app, icon and all.

---

## The Admin vault (emails)

Email addresses live in ONE place: the **GFY Admin** sheet (its template:
`tools/gfy-admin-template.xlsx` → Drive → Open as Google Sheet). Three rules:

1. **Never** click File → Share → Publish to web on the Admin sheet. Doing so
   makes every address and do-not-invite reason public.
2. Keep it a **separate file** — never a tab of the public GFY sheet. The
   public sheet publishes "Entire document", so any new tab auto-publishes.
3. The public Invites tab tracks *who/when/status* — names only, never an
   email address in any cell (the checker below watches for this).

### Before every send round

1. Admin sheet → Contacts tab → File → Download → **CSV**. Save it OUTSIDE
   this repo folder (e.g. Downloads — the checker refuses in-repo paths).
2. `npm run presend -- ~/Downloads/<the file>.csv --vault-url <admin sheet URL>`
3. Fix anything it lists (do-not-invite violations block. Unpaired
   do-not-invite names block too — give them their `out` row on Invites
   first so the site suppresses them; "missing from vault" means collect
   that address first). Log each send in SendLog.

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

## Live scoring (the Form)

During the tournament, a Google Form feeds live scores into the spreadsheet.
Set it up once before the event:

1. **Create the form** with these four questions, in order:
   - **Team** (dropdown, menu items hand-filled at draft night — one item per team captain)
   - **Round** (dropdown, menu items: `1`, `2`)
   - **Hole** (dropdown, menu items: `1`, `2`, `3`, …, `18`)
   - **Team score** (Number, validation: "Between 1 and 19")

   In the form's Settings, make sure **Collect email addresses is set to
   'Do not collect'** and 'Restrict to users in your organization / require
   sign-in' stays OFF — collecting emails would publish every submitter's
   address on the public responses tab, which no checker scans.
2. **Link responses**: In the form settings, click **Responses** → link responses to the GFY spreadsheet (Responses → Link to Sheets → Select existing spreadsheet → pick the GFY sheet file).
3. **Paste the triggers**: Extensions → Apps Script (on the LIVE sheet) →
   copy `tools/sheet-triggers.gs` from the repo and paste it into the script
   editor (same project as the polish script is fine). Save, then run `setup()`
   from the function dropdown and click **Run**. Authorize when prompted.
   `setup()` checks the Scores tab's headers first and refuses to install
   anything (throws, no triggers touched) if it's shaped wrong — a `team`
   column missing (or a legacy `player` column in its place), or any of
   `h1`..`h18` missing. Fix the headers and re-run.
4. **Deploy the Web App**: still in Extensions → Apps Script, **Deploy → New
   deployment** → gear icon → **Web app** → Execute as **Me**, Who has
   access **Anyone** → **Deploy** → authorize → copy the **Web app URL**
   (ends in `/exec`). Full walkthrough + a CORS proof you can run before
   trusting it: `tools/spike-scorer-cors.md`.
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
6. **Check the timezone**: On the LIVE sheet, open **File → Settings** and
   confirm the time zone is set to **America/Boise** (used for `paid_date`
   stamps — see **Collecting for next year**, below).

**How it works:** When someone submits the form, a trigger fires
`onScoreFormSubmit()`, which writes the score to the Scores tab (matching
the team by name, case-insensitive) and marks the response row with a status:
- **applied** — score was valid and written to Scores.
- **rejected: …** — the submission failed (team not found, hole out of range,
  invalid score, etc.). Resubmit the hole with corrections — last write wins,
  so a resubmit overwrites the old one.
- **rejected: busy — resubmit** — a submission collided with another (both
  sent at the exact same moment). Resubmit; the document lock ensures they
  serialize.
- **rejected: internal error** — usually means a tab was renamed or is missing (the writer needs Scores, Field, and Info with their standard headers) — check those, and see Extensions → Apps Script → Executions for the exact error.

The responses sheet (auto-created by Google Forms) has a `status` column
added by the trigger — open it to audit which submissions applied and which
were rejected.

When someone ticks the `deposit` checkbox on the Field tab, a trigger fires
`onDepositEdit()` and stamps today's date (in the sheet's time zone) into
the `paid_date` cell — only on the first tick; re-ticking never overwrites
a date that's already there, and unticking never erases it. Paid order on
the Next Year board follows `paid_date`.

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
responded, status`.

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

### Adding the Invites tab to a sheet you already built

If your GFY sheet predates this feature (it only has the original 11 tabs),
add the 12th tab yourself — no need to rebuild from the template:

1. In the Google Sheet, click **+** at the bottom to add a sheet, and name
   it exactly **Invites**.
2. Paste the header row into row 1: `year, player, invited, responded,
   status`.
3. Select the `invited` and `responded` columns, one at a time: **Insert >
   Checkbox** (same one-time step as Field.deposit).
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

Next to each lot on the Calcutta board, a small second line answers "if the
tournament ended this second, what would the owner collect?" — the exact
same math as the Payout table further down the same page, just surfaced
earlier (never a separate calculation that could quietly disagree with it).
It reads **"Wins if it ended now"** while the tournament's still going, and
flips to **"Won"** once every card is in. Three situations get their own
plain-language text instead of a dollar figure: no owner at all reads
**"unsold"**; a team that hasn't posted a single hole yet reads **"waiting
on cards"**; a team that's posted but landed outside the paying spots reads
**"—"**. None of this changes what an owner owes for the lot itself — the
board says so directly: *"You owe the price regardless."*

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
| One section empty, rest fine | That tab's gid is wrong or missing in `config.js` |
| Team missing from board | The captain's name in Scores' `team` column doesn't match any team in Field — check the health strip, it names the mismatch |
| Edits don't show up | Google republishes on a short delay — wait ~5 min; also check File > Share > Publish to web is still active |
| Album shows a permission error | Drive folder not shared "Anyone with the link" — step 5 |
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
| Run draft night | **Field** tab, `team` column — filling a player's team cell IS drafting them; the site's Draft tab follows live; the pool empties as you type. |

## The GFY Admin vault

Everything published from the main GFY sheet is public — that's the whole
mechanism this site runs on (see the warning under "The invite list,"
above). Two kinds of information can never go on that sheet: **email
addresses**, and **why someone isn't getting invited back**. Both live in a
second, completely separate Google Sheet — call it "GFY Admin" — that is
**never** published to the web, ever.

The GFY Admin sheet holds:

- Every email address you have for everyone, one row per person — as many
  addresses per person as you have (work, personal, whatever).
- A do-not-invite (DNI) list: name + the reason, in plain language, so
  future-you remembers why next year.

**The pairing rule.** Whenever you add someone to the DNI list in GFY
Admin, also set `status` to `out` on their Invites row in the public
sheet, in the same sitting. The two rows are a pair: GFY Admin says *why*
(privately), the public Invites row says *that* (so the site actually
suppresses them). One without the other is a gap — DNI-only means the
site still quietly counts them as needing an invite; Invites-only means
next year's operator has an exclusion with no memory of why.

**Before sending invites**, cross-check the two sheets against each other
— `npm run presend` does this for you (see "Before every send round"
above): everyone marked DNI in GFY Admin should be `out` in Invites, and
nobody about to get an invite email should be sitting on the DNI list.
The pre-send checker automates this cross-check — see "Before every send
round" above; it flags DNI names with active invite rows AND unpaired DNI
names missing their `out` row.

## For whoever maintains this

```
index.html                    the whole app (HTML + CSS + JS, no build step)
config.js                     the only file you edit routinely
tools/make_template.py        regenerates tools/gfy-template.xlsx
tools/make_admin_template.py  regenerates tools/gfy-admin-template.xlsx (the never-published vault template)
tools/sheet-polish.gs         Apps Script sheet hygiene — checkboxes, dropdowns, Course autofill (see above)
tools/presend-check.mjs       the pre-send checker — vault diff, DNI check, email-leak watchdog (see above)
fixtures/                     sample CSVs mirroring the 13 tabs, incl. edge cases
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
