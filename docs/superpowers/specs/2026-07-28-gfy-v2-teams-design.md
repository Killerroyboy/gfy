# GFY v2 — Team Scramble Conversion — Design Spec

**Date:** 2026-07-28 · **Status:** approved in conversation; awaiting Riley's read of this document
**Baseline:** deployed v1 at killerroyboy.github.io/gfy (repo tip `e76d970`), smoke gate 20/20

## 1. Context and goals

GFY is converting from individual stroke play to a **2-day team scramble** with
**50+ attendees** (~25 two-man-ish teams, each with a captain). The site stays a
read-only static page over one published Google Sheet, edited live by
non-technical people on phones, with a 1–5 minute Google republish delay.

Riley's priorities, in order:

1. See who has **paid for next year** (collections, 50+ people).
2. See **who bid what for each team** in the Calcutta and what remains to collect.
3. See the **payout**.
4. Track **seniority**: veterans vs the rookie class; keep past winners visible.
5. A **more polished middle-finger crest**.

Deferred explicitly: lodging assignments ("who sleeps where") — nothing in this
design may block it later, nothing in this design builds it.

Design ethos carried over from the pressure test (2 independent adversarial
reviewers + engineering pass, ~40 findings folded in): the enemy is **silently
wrong money and silently stale data**. Every ambiguity below resolves toward
"loud and true" over "quiet and plausible."

## 2. Non-goals

- No write path to the Sheet (v1 decision — **superseded 2026-07-29/30**: §14 added the
  Form+trigger write lane; §18 rev 2 adds the endpoint lane sharing the same validator. The
  SITE's published-CSV read path remains read-only.)
- No service worker (**still true — §18 rev 2 keeps it out**); §18's localStorage send-journal
  supersedes the "no offline queue" half for the scorer view only.
- **No buyback.** Riley's ruling 2026-07-28: the tournament has no buyback rule.
  Each Calcutta lot is exactly one debt (owner → pot, full price) and one
  payee (owner receives that lot's winnings in full). The v1 copy about buying
  back half of yourself is removed. If a buyback rule is ever introduced, it
  returns as its own debt line per lot — never as an attribute of the owner's.
- No net/handicap competition in team mode (see §5.6).
- No lodging features.

## 3. Sheet schema (11 tabs — no new tabs, no new gids)

Changes marked **Δ**. Template (`tools/make_template.py`) regenerates with these
shapes; deposit/settled/collected become **real Google Sheets checkboxes**
(TRUE/FALSE) so free-text marks ("✓", "pd", "sent") can't silently read as unpaid.

| Tab | Headers | Δ |
|---|---|---|
| Info | key, value | Δ new keys: `deposit_amount`, `payment_handle` (e.g. `Venmo @gfy-duck`); existing keys unchanged |
| Course | hole, par, yards | — |
| Field | year, player, **team**, **since**, handicap, status, deposit, **paid_date** | Δ `team` = captain's name of the player's team; `since` = first GFY year; `status` gains value `out` (not returning — suppressed on Next Year board); `paid_date` = when the deposit landed (orders the Next Year paid list) |
| Scores | year, **team**, round, h1…h18 (optional r1, r2) | Δ header renamed from `player` (code accepts either); one row per **team** per round, keyed by captain's name |
| Schedule | year, day, label, time, event, location | — |
| Pairings | year, round, when, time, players | — |
| Calcutta | year, **team**, owner, price, **collected** | Δ `team` rename as above; `collected` checkbox per lot; **buyback column removed** |
| Payout | year, place, share | — |
| Ledger | year, player, buyin, won, settled | — |
| Champions | year, champion, score | — (champion cell is free text: "Duck & Hammer") |
| Shame | year, award, player, detail | — |

## 4. Data semantics (the rules that make 50 phone-editors survivable)

- **S-KEY — one canonical name key.** Every cross-tab join (Scores.team ↔
  Field.team ↔ Calcutta.team ↔ Ledger/hcp lookups) uses trim + collapse internal
  whitespace + casefold. v1 mixes case-sensitive and -insensitive joins; that
  inconsistency is a witnessed dupe-team/double-payout path.
- **S-SEASON — active season** = max(year) present in **Scores**; fallback = year
  of Info `first_tee`, else current year. Never null: an empty Scores tab must
  not merge all years (v1 latent bug — offseason multi-year Field guarantees it
  fires). Year picker selects among Scores years only.
- **S-NEXT — Next Year anchor** = active season + 1. Pinned: does **not** follow
  the year picker and does **not** follow the wall clock (both provably misfire).
  Board renders "Collection for {NEXT} not open yet" until Field has NEXT rows.
- **S-YEARBLANK** — a row with a blank year cell defaults to the active season
  **and** is flagged in the health strip (blank years are the most-skipped cell
  on phones; v1 makes such rows invisible everywhere).
- **S-ZERO** — a hole/round value of 0 is *no score*, not zero strokes (v1
  counts it and the phantom leads the board while displaying "–").
- **S-MERGE** — multiple Scores rows for the same (team, round) **merge** their
  hole maps; conflicting cells (both filled, different values) render the later
  row's value and raise a health flag. Duplicates are the norm under republish
  delay, not an error.
- **S-ROUND** — round labels normalize: digits win; else word-map (one/two → 1/2).
  v1 maps both "Round One" and "Round Two" to round 1 (Sunday erases Saturday).
- **S-ROSTER** — teams derive from Field: rows grouped by `team` value; the
  player whose canonical name equals the team value is captain. Validation
  (health strip): every team value must match some player; exactly one captain
  per team; blank team ⇒ visible "Unassigned" bucket, never silent.
- **S-RANKED** — when a roster exists, only Scores rows matching a roster
  captain are ranked; unmatched rows are excluded and flagged (v1 lets a typo'd
  captain finish in the money with a phantom payout row).
- **S-SENIORITY** — years attended = active season − `since` + 1 (display "8th
  year"); rookie = `since` == active season; blank `since` ⇒ no badge, no
  rookie tag, sorted after badged players (optional column, never an error).

## 5. Views

Hash-routed tabs in one file (`#home`, `#board`, `#field`, `#pairings`,
`#calcutta`, `#money`, `#schedule`, `#rules`, `#champions`, `#shame`,
`#photos`, `#nextyear`). No page reloads; deep links work; the sticky nav
becomes the tab bar (already horizontally scrollable on phones). Every section
paints an **explicit empty state** — no renderer may early-return and leave
stale DOM under a fresh "Updated" stamp (v1 does; witnessed stale-lots case).

### 5.1 Home
Crest · countdown (pre-event) **or** date-aware status strip (post-event:
"17 of 52 paid for {NEXT} · ${X} Calcutta outstanding", linking to those tabs)
· facts row (dates/course/lodging/format from Info) · current Bird holder
(latest Champions row) · live one-liner (leader + top lot) when scores exist.

### 5.2 Board (leaderboard)
Teams as "**Duck & Hammer**" — all names bold, small ᶜ mark on the captain;
roster from Field mapping. Columns unchanged (Pos/Team/Thru/R1/R2/Total/To par).
Tap opens the team scramble card (v1 card component, ids from canonical key —
v1's `\W`-stripped ids collide). Rows entered as r1/r2 totals show "R1 · total",
not a fake "F". Label sweep Player→Team.

### 5.3 Field (roster)
Grouped by team, veterans-first within and across groups (by `since`), showing
per player: seniority badge ("8th year" / **ROOKIE**), status, deposit
(labeled with the season year, e.g. "2026 bed"), handicap. A "Rookie Class of
{season}" strip at top when rookies exist.

### 5.4 Calcutta
Bid board per team lot: team (captain & partner), owner, price, **Collected**
mark. Tiles: Pot (sum of prices) · House rake · Playing-for · Top lot ·
**Outstanding** — per-person rollup: each debtor with total owed and lot count
("Tex $220 · 2 lots"), sum of uncollected prices. One-line pot rule stated on
the board ("owners pay full price to the pot; winnings pay the owner"). Payout
table unchanged in math (tie-splitting kept) with 100% to owner. Freshness
stamp (see §6).

### 5.5 Next Year
Roster = active-season field ∪ NEXT-season rows (a brand-new payer appears,
marked Paid). Suppress `status=out`. Shows: "N of M paid" header · paid list
**in paid order with dates** (rooms-in-paid-order is the stated house lever;
order = `paid_date` on the NEXT-season Field row; paid rows with a blank date
sort after dated ones, in sheet order) · Owing list in rust · deposit amount +
tappable payment handle from Info.

### 5.6 Money (The Damage)
Per-player buy-ins/side bets, unchanged math. Adds one line of copy: "Calcutta
settles on its own board" — one authority per debt, no double answer. **Net is
disabled in team mode**: a scramble team has no defined handicap; v1 would
silently rank/pay on the captain's personal handicap. `calcutta_basis: net`
in team mode ⇒ health-strip warning + gross used.

### 5.7 Shame
Computed awards become scramble-native (from team cards): Worst Team Hole ·
Fewest Birdies · Back-Nine Collapse (biggest out→in swing). v1's blow-up-count
awards go empty on scramble cards precisely when the section should land.
Committee awards (Shame tab) remain individual, unchanged.

### 5.8 Champions / Schedule / Pairings / Rules / Photos
Render as today, inside tabs. Rules copy rewritten (§8). Champions unchanged;
Bird holder duplicated to Home.

## 6. Resilience layer

- **R-SETTLED** — per-tab independent fetch (`Promise.allSettled` semantics):
  one broken tab cannot freeze the whole site on stale cache (v1 does, forever,
  silently). Per-tab merge into cache: fresh tabs update, failed tabs fall back
  individually, each section's stamp tells the truth for *its* data.
- **R-STAMPS** — "Updated N min ago / Saved copy" stamps on Board, Schedule
  (existing) **plus Calcutta and Next Year** (money misread as fresh is the
  worst class). Small-print "edits post within ~5 min" near the entry link.
- **R-HEALTH** — production data-health strip (collapsed one-liner, expandable):
  unmatched score captains, duplicate captains, blank years, unparseable
  price/handicap cells, net-in-team-mode, header-fingerprint mismatches.
  `?debug=1` keeps the full per-tab panel and gains the same semantic warnings.
- **R-FPRINT** — per-tab header fingerprints (Scores must contain h1 or r1;
  Field must contain player+team; Calcutta must contain price…) checked in the
  production pull and in debug: swapped gids currently render plausible garbage
  that debug certifies "OK". HTML-interstitial sniff (debug-only in v1) moves
  into the production pull.
- **R-NET** — drop the `t=Date.now()` cache-buster (republish delay dominates
  freshness; the buster only invites throttling at 50-phone peak); keep 60s
  refresh with exponential backoff to 5 min per failing tab.

## 7. Crest

Rebuild the `#mark` fist-and-finger SVG: correct knuckle stack, folded fingers
with joints, confident straight middle finger, cleaner beziers — same
brass-on-pine palette, ring arcs, pine boughs, EST arc. Deliver a local
variants page: **3 candidates × 2 sizes each (full crest + 64px favicon)** with
one marked RECOMMENDED — a ten-second veto for Riley, not homework. Winner
replaces both the SVG symbol and the canvas app icon via a **single shared path
constant** (v1 duplicates the path in `makeIcon`; drift is a live risk).

## 8. Copy sweep (drafts for Riley's edit — content is his)

Everything that still describes the old tournament: hero fact "36 holes,
stroke" (→ Info-driven), board lede "Net decides who buys", every "Player"
header, Calcutta lede "Every man in the field…" (→ every team), Rules 2/3/6/7
(stroke play, mulligans-per-nine, leather gimmes, buyback — the buyback rule
is deleted per §2). Spec ships proposed scramble wording in the plan; Riley
edits before deploy.

## 9. Testing

`test/smoke.mjs` rewritten around v2 fixtures. The fixture matrix encodes the
pressure-test scenarios: duplicate (team, round) rows with and without cell
conflicts · word round labels ("Round Two") · a 0 in a hole cell · an unmatched
captain score row · blank year cells · a lowercase-typo team name ·
NEXT-season Field rows incl. a brand-new payer and a `status=out` man ·
uncollected + collected lots for the same owner (rollup math) · one tab
hard-failing (partial-render + per-section stamp assertions) · swapped-gid
fingerprint detection · empty-Scores offseason state (no all-years merge) ·
seniority/rookie badges · date-aware Home strip both sides of the event date.
Deploy gate: `npm test` green at the exact tip + the v1 curl battery + live
`?debug=1` check. Target ~35–40 assertions; the number is an outcome, not a goal.

## 10. Rollout

No migration exists (no real sheet was ever created): the v2 template becomes
*the* template; the runbook (README) updates in the same change. Build order
for the plan: (1) data layer + resilience (S-rules, R-rules) with tests →
(2) tab shell + Home → (3) team boards → (4) Calcutta collections + Next Year
→ (5) crest + copy + template + README → (6) deploy battery. Each phase lands
green before the next (same discipline as v1's mission).

## 11. Open items

- Riley: rules/copy wording pass (drafts provided in the plan).
- Riley: crest pick from the variants page (recommendation provided).
- Held in reserve, not built: buyback-as-debt-line model (if the rule ever
  returns), lodging tab, ledger↔calcutta derivation.

---

## §12 — v2.2 addendum: ops round (pressure-tested 2026-07-28 evening)

Two adversarial reviews (31 + 14 findings) + owner decisions. Binding rules; supersedes §5.5 where they conflict. The v2.1 invites commit (7611624) predates these — the v2.2 wave transforms it.

### Data / anchors
- **A-NEXT2**: Invites and Rooms are NEXT-season surfaces: anchor = max(year in own tab) with floor S-NEXT; picker-independent. normalizeYears defaults their blank years to NEXT (flagged).
- **A-SANE**: activeSeason ignores Scores years > (first_tee year + 1), flagged. All year cells parseInt-normalized at ingest ("2,027"/"2027.0" ok; NaN flagged).
- **A-DATE**: paid_date parsed as real date (ISO preferred, tolerate M/D/YY); unparseable → flagged + sorts after parsed; same-day tie = sheet order, stated on the queue.

### Funnel (Invites tab: year, player, invited, responded, status — NO email column, ever)
- **F-OPEN**: open when Invites-NEXT ∪ Field-NEXT nonempty.
- **F-UNIV**: universe = Field(trailing 3 seasons) ∪ Field-NEXT ∪ Invites-NEXT, minus out.
- **F-STAGE**: one derived stage per person (paid > responded > invited > needs); buckets exclusive, displayed summing to M.
- **F-NAMES (Riley)**: public board = counts only + paid/owing lists as today; invited/needs-invite/declined NAMES render only under ?admin=1 (social gating; documented as non-cryptographic).
- **F-DECLINED (Riley)**: status vocabulary: `declined` (benign, this season; shows under ?admin=1 as "declined"; excluded from owing/nag lists; REAPPEARS next season) vs `out` (excluded; silent suppress). Seniority is `since`-anchored and unaffected by declined/skipped seasons — tested invariant. Paid-then-out/declined renders "paid — refund owed" (admin view), never silent money deletion.
- **F-FRESH**: funnel block carries its own caption: "invite states are ticked by hand and may lag" — the fetch stamp never vouches for checkboxes.
- **F-OUT-HOME**: authoritative out/declined location = Invites-NEXT; status values elsewhere for NEXT season are flagged as ignored.

### Rooms (tab: year, property, room, player)
- **R-DERIVE**: sheet stores assignments only. Queue = paid-order (A-DATE) minus assigned. Health flags: player in two rooms; assigned-but-not-paid; unknown name without `guest:` prefix.
- **R-PUBLIC (Riley)**: names public on the Rooms view (find-your-bed). ?admin=1 lens adds per-player PRIOR-year room ("had: <property·room> <year-1>") beside current assignment.
- **R-FILTER**: client-side name filter box on the view.

### Would-pay
- **W-ONE**: derived from the payout table's exact rowsOut/ownerCut computation — never a second formula. Label "Wins if it ended now", carries the Projected/Final state; distinct texts: out-of-money "—", no cards "waiting on cards", unsold lot "unsold". Copy line on the board: "You owe the price regardless."
- **W-WD**: Field status `wd` = withdrawn: excluded from the done-check with a health flag + board annotation (deleting rows not required to reach Final).
- **W-RAKE0**: calcutta_rake parsing to 0 from a non-blank/non-zero cell → flagged.

### Privacy / hygiene
- **P-VAULT**: admin vault = separate never-published sheet (do-not-invite reasons, ALL email addresses, multi-address per person). Operator pre-send checker diffs public Invites vs vault both directions + schema watchdog (published headers vs expected; alarm on extras).
- **P-GMAIL**: response scanning outputs a human-review list (name + matched address + snippet); auto-replies/OOO dropped; applied artifact = names only; declines handled manually.
- **P-INDEX**: <meta name="robots" content="noindex"> on the site.

### Structure
- **S-VIEWS**: VIEWS derived from [data-view] DOM — no triple-entry.
- **S-NAV**: seasonal nav order (off-season: Home·NextYear·Rooms·Field first; event window: Board·Pairings·Calcutta first) + right-edge fade affordance.
- **S-STALE**: renderLeaderboard's `if(!players.length) return` early-return replaced with explicit empty state + regression fixture (LIVE BUG, ships with this wave).
- Money tab off-season empty state points to Next Year; owing list rendered as a list, not a comma blob.

## §13 — v2.3 addendum: scorecard grid, admin vault, sheet ergonomics, gmail loop (2026-07-29)

Brainstormed with Riley 2026-07-29; all four approaches Riley-selected, design approved. Hardened same day: 3-reviewer adversarial pressure test (spec-vs-code, operator reality, privacy red-team) + 2 Riley constraints (handicap is a typed number; teams unknown until the Friday-night draft) — accepted findings folded in below. Binding rules, same style as §12. Inherits §12 (P-VAULT, P-GMAIL, F-DECLINED vocabulary) unchanged. All named tools are DELIVERABLES of this addendum, not existing files.

### Course data (real MeadowCreek — meadowcreekgolfresort.com, New Meadows, ID)
- **C-REAL**: Course tab (existing headers `hole, par, yards`) gets the real 18 rows — **White tees**, Riley-selected. Canonical transcription (source: scorecard image on /overview/, gold/white/par rows each checksum-verified against the card's printed OUT/IN/Total):
  - par (1–18): 4,5,4,3,4,4,4,3,5 · 4,4,4,3,4,5,4,3,5 — out 36, in 36, total 72
  - white yards (1–18): 319,469,407,124,357,348,391,180,499 · 286,354,344,148,406,433,352,151,533 — out 3094, in 3007, total 6101
  - The card's Green-tee row failed checksum (sum 2 off its printed total) — **do not use green data anywhere** unless re-verified from a better source (S1: null over guess).
- **C-STATIC**: course-static assets are SITE-side, never sheet columns: hole photos by convention `assets/holes/hole-N.jpg` (rendered iff the file exists, hidden on error — no broken-image states); map-locator pin coordinates hardcoded in the site beside the layout image they index into.
- **C-IMG (Riley ruled, informed)**: course-site assets (layout map, the two labeled hole photos — holes 3 and 12 are the ONLY per-hole photos that exist on their site, scorecard-derived data) are rehosted in the public repo. IP note was surfaced with the option; Riley chose it. Site carries noindex. Own photos taken at the event can replace/extend later via the same C-STATIC convention.

### Scorecard grid + hole panels
- **G-GRID**: Board view gains a hole-by-hole grid: teams as rows (standings order), holes 1–18 as columns, header rows for par and white yards; cells colored by score vs par using the site's EXISTING `scoreClass` idiom (under-par brass, bogey sage, double+ rust — one color language across cards and grid, S7); unplayed = blank cell, never 0.
- **G-SCROLL**: sticky team-name column; horizontal scroll contained inside the grid's own container — the page never scrolls sideways (existing mobile rule). Columns never compress to fit the viewport: minimum score-cell width ~2.2rem, and hole-header tap targets ≥44px tall (headers may be taller than the cells under them).
- **G-FOCUS**: when a round is in progress (any team has blank cells), the grid auto-scrolls to the live hole — the first column not every team has finished — so a mid-round glance lands on the action; the Out/In boundary is visually marked.
- **G-ROUND**: a round toggle appears only when a second round has any hole data.
- **G-TOTALS**: a totals-only team (no hole map) renders one em-dash row plus its total — never fabricated per-hole cells.
- **G-PANEL**: tapping a hole's column header opens a panel: hole number, par, yards, every team's score on that hole, best score, map locator (full layout image with that hole's pin highlighted), and the real photo when one exists (holes 3, 12 today).
- **G-HIDE**: when courseMap() is null (missing/partial course data) the grid hides behind an honest inline note in its place — "Hole-by-hole view needs all 18 holes on the Course tab" — non-blocking; existing team cards render regardless (current behavior preserved, not degraded).

### Admin vault (the email-tracking answer; extends P-VAULT)
- **V-TABS**: `tools/make_admin_template.py` → `gfy-admin-template.xlsx`, two tabs: **Contacts** (`player, email, email_alt, phone, do_not_invite ✓, reason, notes`) and **SendLog** (`date, player, address_used, what, note`). Riley uploads to Drive → save as Google Sheet → **NEVER publish** (P-VAULT). Flow of record: addresses live in Contacts; each send round appends to SendLog; replies tick `responded` on the public Invites tab.
- **V-SAMPLE**: the template xlsx ships in the PUBLIC repo, so its sample rows must be obviously fake (`Person One`, `person@example.com`, reason `sample`) — never realistic addresses or verbose reasons.
- **V-SEP**: the vault is a separate Google Sheets FILE, never a tab of the public sheet — the public sheet is published in Entire-document mode, so any tab added to it auto-publishes. README carries this warning plus: clicking "Publish to web" on the Admin sheet would expose every address and reason — never do it.
- **V-MATCH**: `Contacts.player` must equal the public sheet's spelling exactly. `tools/presend-check.mjs` = the P-VAULT operator pre-send checker, designed to need no Drive auth: Riley supplies ONE input — the path to a downloaded vault export (xlsx/csv); the checker fetches the live public Invites CSV itself. Output: both-direction diff (in vault, never invited / invited, missing from vault) + do-not-invite violations (DNI with invited/responded ticks or a non-out/declined status) + unpaired-DNI warnings (no Invites row — the site would resurface them) + published-content watchdog — email-like patterns hunted in published HEADERS and in published VALUES across every published tab. Run before every send round (`npm run presend -- <vault-file>`); the README carries the send-round procedure. Honest fallback when the tool is skipped: at minimum re-read the vault's do-not-invite list before sending.
- **V-PATH**: containment is structural, not habit: the checker REFUSES a vault file located inside the repo tree (hard error naming the risk), writes nothing to disk (stdout only), and the commit that creates it also adds `.gitignore` defense patterns (`*vault*`, `*gfy-admin*`). Checker output containing addresses is for the operator's terminal only — never committed, pasted into issues/PRs, or logged to files.
- **V-PROBE**: given the vault sheet's URL (optional flag), the checker probes its published-CSV endpoint anonymously and ALARMS if it answers — a mechanical "the vault is not published" proof each run. (Pattern verified 2026-07-29: the restricted main sheet answers 401 to anonymous fetches.)

### Sheet ergonomics (live sheet, in place)
- **E-SCRIPT**: `tools/sheet-polish.gs` — Riley pastes into Extensions → Apps Script on the LIVE sheet and runs it; touches no gids; operates on the ACTIVE spreadsheet only, embeds no sheet IDs/URLs, and never references the vault (safe to live in the public repo). Applies: frozen + warn-on-edit-protected header rows (all 13 tabs); checkboxes on the CLOSED list `deposit, collected, invited, responded, settled (Ledger)` — no other column, ever; warn-mode status dropdowns per E-VOCAB; conditional colors (unpaid deposit soft red, rookie `since == active season` highlight, assigned-but-not-paid room flag — blank `team` is never colored: teams are drafted Friday night, so blank-until-draft is the normal state, not an error); Course-tab autofill per C-REAL.
- **E-REPAIR**: first run repairs witnessed damage — `handicap` (live sheet 2026-07-29: yesterday's checkbox-conversion swept the whole column to FALSE) gets its checkbox validation stripped, TRUE/FALSE junk cleared to blank, and plain number format. Handicap is a typed number (Riley ruling).
- **E-TEAM**: `team` stays free text with NO validation of any kind; the site already treats blank team as first-class (rosterMap skips team-less rows without flags).
- **E-IDEM**: "idempotent" means precisely: re-running never changes cell VALUES (checkbox conversion sets format/validation only — existing ticks survive; E-REPAIR clears only literal TRUE/FALSE in `handicap`); existing protections are found and reused, never duplicated; Course autofill writes ONLY when the tab is empty or still equals the known sample rows — 18 differing rows are left untouched with a log line (hand-edits win). All dropdowns warn, never reject, so a re-run cannot strand an existing value.
- **E-VOCAB**: every dropdown list derives from the exact vocabulary the site parses — Field.status `In / wd / out / declined` (`declined`/`out` typed in Field are a legitimate fallback the code honors when Invites-NEXT is empty; Invites stays authoritative when populated, per F-OUT-HOME); Invites status per F-DECLINED. Parsing is case-insensitive (the code lowercases), so dropdown casing is display-only. One owner: the smoke suite reads `tools/sheet-polish.gs` and asserts its lists against the site's parser vocabulary, and asserts its course data against the C-REAL checksums (par 36/36/72; yards 3094/3007/6101).

### Gmail loop (operating procedure; P-GMAIL unchanged)
- Prerequisite (Riley-only): `/mcp` → authenticate Gmail. Then per pass: scan replies → human-review list (name, matched address, snippet; auto-replies/OOO dropped) → Riley approves → `responded` ticked. Emails never enter any published artifact or the repo.
- Cadence: on-demand during invite season (a /loop is fine); an expired or failed auth fails LOUD — "cannot scan, re-auth needed" — never a silent zero-replies report. The review list lives in the conversation only: never a file, commit, or ledger entry; the applied artifact stays names-only ticks.

### Testing
- New smoke fixtures: grid with a partial round (G-FOCUS target column included); totals-only team; conflicting duplicate entries; missing course data (G-HIDE path); hole-panel data assembly; E-VOCAB parity + C-REAL checksum assertions (read the .gs source — Apps Script itself can't run in the jsdom suite, so E-IDEM is additionally verified by a documented double-run manual check on the live sheet); presend-check unit fixtures (diff both directions, DNI violation, inside-repo-path refusal). Existing 111 stay green.

### Sequencing note
- Work lands on `v2.1-invites` (or its successor branch) — reversible preview work. Yesterday's `v2.1-invites → main` push gate is untouched by this addendum and remains Riley's.
- Cheap insurance as commits accumulate: push the BRANCH to origin periodically (a branch push is not the fence; main is). Content check 2026-07-29: the branch holds no secrets — `SHEET_EDIT_URL` in config.js is public by design and the sheet answers 401 anonymously (restricted). README documents the trade-off should sharing ever widen to link-editing: the public "Enter scores" button would then be world-editable.

## §14 — v2.4 addendum: sheet ease-of-use + grid legibility (2026-07-29)

Riley-scoped same day v2.3 deployed: all three ease items + grid legibility + per-hole crops (Riley picked crop-in-panel over scorecard bands). Binding rules; inherits §12–§13.

### Site
- **G-BIGPAR**: the grid's par and yards rows become first-class legible — par at score-cell scale (or within 15%), yards one step down but readable on a phone at arm's length; both keep tabular-nums and the Out/In divider. The "subtle metadata" styling is retired (Riley ruling).
- **G-CROP**: the hole panel's primary visual becomes a pin-centered ZOOMED crop of the existing assets/course-map.png (~3.5× via CSS background sizing/positioning driven by PINS percents; pin ring overlaid; positions clamped near map edges so border holes stay framed). The full map renders smaller beneath it; the real hole photo (3, 12) stays. NO new image files — one map, CSS does the cropping.

### Sheet ops (new `tools/sheet-triggers.gs`; polish.gs stays one-shot formatting)
- **F-FORM**: live scoring moves to a Google Form (4 questions: Team — dropdown; Round — 1/2; Hole — 1–18; Team score — number). Riley creates the form + links responses to the live sheet (README walkthrough with exact question setup). The auto-created responses tab publishes with the document (entire-doc mode) — acceptable BY DESIGN: it contains team/round/hole/score only, never names-beyond-teams, never contact data.
- **F-DROPDOWN (Riley trade-off, ratified)**: the form's Team list is maintained by hand at draft night. No FormApp scope; the trigger script keeps @OnlyCurrentDoc.
- **F-WRITE**: installable onFormSubmit trigger validates (team matches a Field roster team, case-insensitive; round ∈ {1,2}; hole ∈ 1..18; score = positive int) and writes the Scores grid: the (team, round) row's hN column, creating the row with the active season's year and the roster's canonical team casing if absent. The response row is marked `applied` (audit trail) — or `rejected: <reason>`, never silently dropped. Corrections = resubmit; last write wins and the site's existing conflict-flag covers mid-air edits. The writer touches the Scores tab ONLY.
- **F-STAMP**: installable onEdit trigger on Field's deposit column: tick TRUE + blank paid_date → stamp today (YYYY-MM-DD). Unticking never erases a date (refunds are admin judgment, not automation).
- **F-START**: polish() gains buildStartHere(): a first tab "START HERE" — season-aware to-do list, color legend, HYPERLINK jumps to key tabs, presend reminder, a cell for the scoring form's URL (Riley pastes once). Plus seasonal tab reorder: event window (first_tee ±3 days) puts START HERE + Scores first; off-season puts START HERE + Next Year/Invites first. Idempotent rebuild each run.
- **F-TRIG**: `setup()` installs both triggers idempotently (removes this project's prior triggers for the same handlers first); `teardown()` removes them. One-time authorization step documented in README (a step above the run-once script; scope stays this-spreadsheet-only).

### Testing / battery
- Smoke P-group extensions read the new .gs source: validation vocabulary (round/hole/score bounds), Scores-only write discipline (no other sheet-name literals in the writer), stamp column names, idempotent-setup shape.
- E2E battery: one real form submission after setup() → response marked applied → Scores cell populated → site shows the score after republish+refresh. Riley phone-width eyeball carried from v2.3 into this round's battery.

### §14 hardening (adversarial pressure test 2026-07-29 — 10 findings, 8 accepted)
- **F-LOCK**: F-WRITE wraps each read-modify-write in `LockService.getDocumentLock()` (waitLock 10s); on timeout the response is marked `rejected: busy — resubmit`, never silently dropped. Two same-second submissions must both land or both be visible.
- **F-QTYPES**: form question types are BINDING: Team/Round/Hole = dropdowns (Round {1,2}, Hole {1..18}); Score = number with form-side validation 1–19. README shows the exact setup. Residual documented: a misconfigured free-text field would publish typed junk on the responses tab — the dropdown mandate is the defense.
- **F-YEAR**: form-created Scores rows take their year from Info `first_tee` (the form exists only for the current event), never from max-year-in-Scores; if Info/first_tee is unreadable, reject loudly. Kills the stale-sample-year trap.
- **F-NKEY**: team matching uses the site's exact S-KEY normalization — trim + collapse internal whitespace + casefold — not bare case-insensitivity. Round validated ∈ {1,2} before any word-mapping quirks apply.
- **F-STAMP-IMPL**: stamp = `Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd")`; README mandates checking the sheet's timezone is America/Boise. onEdit iterates every cell of `e.range` (multi-cell pastes), stamps only where deposit=TRUE and paid_date blank; FALSE never erases; re-tick never overwrites an existing date.
- **F-START-LINKS**: START HERE links are built AT RUNTIME as `ss.getUrl() + "#gid=" + sheet.getSheetId()` — full URLs in cells, zero IDs in committed source (E-SCRIPT preserved). Clickability verified in the battery.
- **G-CROP-IMPL**: pin-centering is JS, not naive CSS percentages (background-position % aligns proportionally — it does NOT center a point): overflow-hidden wrapper, inner img at 350% width, and on open `wrapper.scrollLeft = pinX/100*img.clientWidth − wrapper.clientWidth/2` (same for Y), clamped ≥0. Battery visually confirms hole 1's crop shows hole 1 and an edge hole (2 or 17) stays framed.
- **G-BIGPAR-PIN**: par/yds rows stay non-interactive (th.sg-h remains the only tap target); row heights grow only as the larger type requires.
- Rejected from review, with grounds: "grid not yet implemented" (it shipped in v2.3, live); "private responses sheet" alternative (breaks @OnlyCurrentDoc — the trigger would need cross-file access; dropdown constraints are the accepted defense).

### §14.1 — shotgun start holes (Riley, 2026-07-29 eve)
- **P-SHOTGUN**: the Pairings tab gains an optional `start` column — the hole each pairing starts on (shotgun rounds). The site's Pairings view renders it beside the time as "Hole N" when present and parseable (1–18); blank/absent column = rendered exactly as today (S5 additive, zero migration). Unparseable values render as raw text (display-only surface, no fabrication, no flag noise). Template gains the column with sample values; README's Pairings note mentions it. Scores/board semantics untouched — start hole is informational (scramble scoring is hole-set-based, not order-based).

## §15 — v2.5 addendum: tournament refinement (Riley, 2026-07-29 eve — 3 decisions locked)

Context shift: teams are FOUR players (12–15 teams, ~48–60 attendees), not two. No schema break (roster is n-player by construction); display and drafting adapt.

- **H-PODIUM**: Champions tab gains optional `place` (1/2/3; blank = 1st, full legacy compat) and `players` (free-text roster list, any reasonable separator). Champions view renders a per-year PODIUM — 1st/2nd/3rd with each placing team's roster; years lacking 2nd/3rd rows render only what exists (no fabricated placings). Bird holder stays the latest year's place-1 row. Riley backfills history in the sheet; the view lights up as rows appear.
- **D-DRAFT (public — Riley ruled)**: Field gains optional `strengths` (free text, captain-facing scouting). New PUBLIC site view `#draft`: **Pool** = active-season Field rows with blank `team`, sorted handicap ascending (blank handicaps last), each showing name, handicap, seniority badge, strengths, and podium history derived from Champions.players via S-KEY matching (🏆 win years; 2nd/3rd appearances listed lighter — only from rows that carry players data, never inferred). **Drafted** = rows with `team` filled, grouped by team, captain first — checking a player off IS filling their team cell (E-TEAM stays: blank is normal, never flagged). Empty states honest: all-drafted → "pool empty — draft complete"; no active-season rows → view shows its own note. Nav: event-window order includes Draft after Board; off-season after Field.
- **B-CAPTAIN (Riley ruled — supersedes §5.2's all-names row label for team size > 2)**: the leaderboard row shows the CAPTAIN's name only (ᶜ style retained); the full roster lives in the tap-open card and Field view. Card header shows all four. teamLabel's joined form remains for surfaces where width allows (card, calcutta lots).
- **Entry at scale**: no change needed — the scoring Form is per-team-per-hole; 12–15 scorekeepers submit independently (F-LOCK serializes).
- Template: Champions + Field gain the new columns with obviously-sample rows; fixtures likewise (synthetic). Tests: new group U (podium render incl. legacy blank-place row; draft pool/drafted split; win-badge derivation; captain-only board label at 4-player fixture).

### §15 hardening (pressure test 2026-07-29 eve + Riley naming rule)
- **N-FULLNAMES (Riley ruled)**: Field.player, Invites.player, Rooms.player (and the vault's Contacts.player) carry FIRST + LAST names and must match each other exactly (S-KEY normalization applies). Scores.team and Pairings rows follow the team label, not player names — short forms fine there. README/START HERE state this convention.
- **U-TOKENS**: Champions.players parsing = split on separators (comma, ·, /, &, |, " and "), nkey each token, EXACT token match — never substring (Jake must not match Jakeb).
- **U-DUPES**: duplicate same-year places render ALL rows encountered + a health-strip flag; no silent de-dup, no fabricated podium.
- **U-POOL**: draft pool filter = year==activeSeason AND team blank AND status not in {out, wd}; current-season `declined` (legacy fallback) also excluded.
- **B-CAPTAIN scope pin**: captain-only applies to the leaderboard rows AND the scorecard grid's sticky team column (width-critical at 15 teams); the tap-open card gains a roster header (all four names — currently missing); Calcutta/Money/Shame keep their existing joined labels (width acceptable, not §15 scope).
- Tests: group U fixtures include at least one 4-player team; suite baseline at build time = 143.
- **H-PLACE-PARSE (ratified at build)**: place parsing is parseInt-lenient — "1st"/"1 (tie)" count as that place (operator intent; ties still trip the dupe flag); only blank (=1st) and unparseable/out-of-range (flagged typo, never a win) differ in kind. Single-sourced in champPlace().

## §16 — crest v3: the Park Badge (Riley approved 2026-07-29 eve)

Provenance: crest round 2, candidate A ("The Park Badge"), artifact
`https://claude.ai/code/artifact/a871d138-09cc-452b-a76b-c47ae996c7bd`; Riley: "I like the
image that I saw in the link." **The fidelity target is that exact render** — the build
reproduces it, it does not redesign it. Durable references, both in-repo: mockup source =
`tools/crest-round2.html` (candidate A markup); approved-state render of record =
`docs/superpowers/specs/assets/crest-v3-approved.png`.

- **C3-FIST (single authority preserved)**: the fist stays `MARK_PATH` verbatim — hero uses
  the injected `<symbol id="mark">` exactly as today. The new pine keyline that separates the
  fist from the brass ridge is a second path whose `d` is **injected from the same MARK_PATH
  const at script start** (stroke-only rendering); the path string continues to exist exactly
  once in `index.html`. Nav mark, footer mark, favicon/app-icon pipeline untouched.
- **C3-ART**: hero crest = 400×400 badge: chunky brass ring + solid brass lettering band
  (r≈138–180), pine inner disc with the scene — bone moon disc haloing the fingertip, brass-dim
  back ridge, brass front ridge, pine-2 lake with bone water dashes, two bone pines, fist over
  keyline center, brass EST ribbon with dim folded tails; pine diamond separators at 3/9
  o'clock in the band. Palette = existing tokens only: pine, pine-2, bone, brass, brass-dim
  (5 fills on screen; a patch vendor can quantize to 3 threads by merging the two dim shades —
  documented in the asset header comment, not a new constraint on the site).
- **C3-TYPE (lettering cannot break)**: the two band arcs ("GO FUCK YOURSELF",
  "McCALL · IDAHO") are converted to **outlined SVG paths traced from the same face the
  approved render resolved** (macOS Futura bold as rendered in the artifact; the build
  measures which face Chrome resolved before tracing) — zero font dependency for band
  lettering; visitors on any OS see what Riley approved. The ribbon line is NOT outlined on
  the site — it is the live element per C3-EST (outlined "EST. 2019" exists only in the
  standalone asset). Fidelity check = side-by-side S11 review of the built hero against
  `crest-v3-approved.png` at 330px and 120px.
- **C3-EST (sheet-driven year survives)**: the ribbon keeps a LIVE `<text id="crestEst">`
  (Jost, already site-loaded; pine fill, letterspaced caps) carrying "EST. 2019" as the static
  default, overwritten by Info `est_year` exactly as today (`index.html` est_year hook
  unchanged). This is the only `<text>` element in the hero crest.
- **C3-A11Y**: `role="img"` retained; aria-label updated to describe the scene ("GFY crest: a
  raised middle finger over a mountain lake at night, flanked by pines").
- **C3-ASSETS (hat-ready)**: commit `assets/gfy-crest.svg` — fully self-contained standalone
  (hex colors hardcoded, all lettering outlined INCLUDING a static "EST. 2019", no CSS vars,
  no cross-document `<use>`) — plus `assets/gfy-crest-2048.png` rendered from it. These are
  the files a patch/hat vendor receives.
- **C3-SCOPE-OUT**: the old flanking pine-bough stroke groups die with the replaced hero
  block; nothing else changes — nav, footer, favicon, site palette, all other views untouched.
- **C3-TESTS**: full suite green at current baseline before commit; new smoke assertions:
  (a) hero crest svg contains exactly one `<text>` and its id is `crestEst` (outline
  enforcement), (b) the MARK_PATH string occurs exactly once in `index.html`, (c) `#crestEst`
  still receives `est_year` from a fixture with a non-2019 year.
- **Residual (surfaced, Riley's call later, non-blocking)**: outlined letterforms traced from
  a licensed system font are standard logo practice (outlines, not font embedding), but if GFY
  merch ever goes beyond personal hats and Riley wants zero font-license thought, the band
  lettering can be re-outlined from an OFL face (e.g. Oswald SemiBold) in one commit without
  touching anything else.
- Rollback: `git revert` of the crest commit(s) on `v2.1-invites`; prod gate unchanged (Riley
  push).

## §17 — v2.5.1: canonical nav order (Riley ruled 2026-07-30)

- **N-ORDER**: one canonical, story-shaped tab order year-round: Home, Field, Draft, Board, Pairings, Calcutta, Money, Next Year, Card, Rooms, Champions, Shame, Photos, Rules (view keys: home, field, draft, board, pairings, calcutta, money, nextyear, schedule, rooms, champions, shame, photos, rules). Next Year sits after Money — Calcutta → Money → Next Year is the money cluster (bets → settle up → next season's collections). The old OFF-SEASON priority shuffle (home/nextyear/field/draft/rooms-first) is RETIRED: off-season nav is exactly the canonical order.
- The EVENT-WINDOW flip stays (Riley ratified): during first_tee ±3 days, board / draft / pairings / calcutta / rooms lead; the remainder follows canonical order. Fixed muscle memory 51 weeks a year, score-first while play is live.
- "Card" keeps its label (Riley ruled; "Course" rename considered and declined).
- Implementation pins: nav anchors reordered in the MARKUP too (initial-paint / no-JS order = canonical); a `NAV_ORDER` display constant + simplified `applyNavOrder`; `VIEWS` stays DOM-derived (S-VIEWS untouched); any view absent from NAV_ORDER falls back to DOM order at the END (future-tab resilience — never dropped). S3/S4 assert the FULL 14-key sequences, not prefixes.

## §18 rev 2 — v2.6: captain live scorer, pressure-test hardened (Riley approved 2026-07-30)

Provenance: rev 1 design + mockup approved, then 3-reviewer adversarial pressure test (field-UX /
architecture / failure-mode; 60+ findings), then Riley blessed the two resulting changes:
**card-first UI** and **endpoint-confirmed writes**. Mockup artifact (revised, card-first on top):
`047ccc2c-8c71-46bc-95de-878daf101831`. Binding emphasis unchanged: **accurate tracking** — and
rev 2's core inversion: confirmation is a **returned fact** (the sheet answers), never an
inference from the lagging published CSV.

### Access & entry
- **SC-LINK**: `#score?team=<slug>` view in index.html; link-only (no nav tab). **Router pin
  (pressure-test Critical): `showView` must strip the hash query (`name.split("?")[0]`) for BOTH
  the VIEWS lookup and the nav active-state compare** — smoke-tested with a real
  `#score?team=X` link. Team value percent-encoded/slugged in generated links, decoded on read,
  matched via S-KEY against **active-season Field `team` values** (the same set the trigger
  validates — NOT captain-named rows, which the live sheet lacks). First use shows a one-time
  identity confirm ("Scoring for **<team>** — <roster>. Not your team?"), persisted; bare
  `#score` resumes the last team; the team picker (full rosters shown) stays reachable from the
  header always (multi-team scorer / Riley case).
- **SC-ACCESS** (unchanged from rev 1): writes captain-only by distribution + validation, not
  auth — disclosed, accepted. Reads universal on the site.
- **SC-PUBBTN rev 2**: remove the public hero "Enter scores" button AND **delete the
  `SHEET_EDIT_URL` value from config.js** (+ its README instruction) — config.js is served
  publicly; the URL is a document-ID leak even though it returns 401 to strangers (verified
  2026-07-30). RILEY CHECK stays as a *confirmation*: sheet sharing = specific editors only.

### The screen (card-first — pressure-test change 1)
- **SC-UI**: the scorecard is the interface. 18 cells, two rows of 9 (Out/In, the site's
  existing card idiom), every cell ≥44px tap target. Cell states: empty · **on the sheet**
  (value, colored by the existing scoreClass idiom) · **saved on phone / sending** (distinct
  mark) · **conflict** (both numbers shown). Tap a cell → the par-labeled pad for THAT hole
  slides up; tap a number → **it sends immediately** (no confirmation screen, no undo timer —
  a tap-to-pocket must never strand a send); the cell is the receipt; tapping a filled cell
  enters an explicit edit mode ("Hole 8 · currently 6 → Replace 6 with 4?"). No next-hole
  inference anywhere (shotgun-proof by construction; P-SHOTGUN not consulted). Sun-legibility
  floor for this view: no text under 13px, over/under never carried by color alone.
- **SC-PAR** (kept verbatim from rev 1) + two pins: per-hole degrade applies to labels/coloring
  (a bad par cell degrades THAT hole to plain numbers, `par > 0` guarded); the running to-par
  tally is **suppressed entirely (strokes only) unless all 18 pars parse** — never computed
  against a partial par set. "9+" button is labeled "Other" (numeric entry 1–19).
- **SC-ROUND**: default round derived team-state-first (R1 complete on the sheet → R2; else
  date rule vs Info `first_tee` compared **in first_tee's own UTC offset**, never phone-local),
  shown as a labeled chip; the manual toggle is **momentary** — auto-returns to the derived
  default after one submission; every result line names the round it wrote.

### The write path (endpoint-confirmed — pressure-test change 2)
- **SC-WRITE rev 2**: primary transport = **Apps Script Web App `doPost`** on the live sheet's
  existing script project. Client POSTs `Content-Type: text/plain;charset=utf-8` with a JSON
  body `{team, round, hole, score, client_id, seq}` (CORS simple request — no preflight);
  server `JSON.parse(e.postData.contents)`, returns ContentService JSON
  `{ok, verdict, team, round, holes:{h1..h18}}` (the team's full current round row — the client
  paints THIS as truth). Endpoint URL = Info tab key `score_endpoint` (ONE config home; the
  START HERE form-URL cell is retired into the same Info surface). **SPIKE GATE (blocking,
  before any other §18 work): prove the GitHub-Pages-origin POST → 302 → `ACAO:*` chain works
  on Riley's account (~20 min). If it fails → the fallback plan is per-team PREFILLED form
  links (no site scorer), NOT rev 1's form-riding transport.**
- **SC-VALIDATE (one validator)**: extract `applyScore_(ss, {team, round, hole, score})` from
  `onScoreFormSubmit`; both the form trigger AND `doPost` call it — same S-KEY roster check,
  same DocumentLock, same upsert, same F-YEAR season keying. Plus one new guard (trigger-side,
  both lanes): a target row carrying an `r1`/`r2` round total is REJECTED
  ("round total already entered — clear it first"), never silently converted to hole-scoring.
- **SC-IDEMPOTENT**: `client_id+seq` recorded in a bounded Script Properties ring; a replayed
  key returns the prior verdict without a second write — retries and queue drains can never
  double-apply or resurrect an older value over a newer one from the same phone.
- **SC-LOUD-CONFIG**: the client treats anything but well-formed JSON (HTML, login page, CORS
  failure) as "scoring endpoint not reachable — check the deployment", shows the raw form link,
  and never guesses. A `doGet` ping returns `{ok, year, teams}` and is wired into the existing
  `?debug=1` surface. README pins the redeploy rule: **Manage deployments → Edit → New version**
  (URL preserved); a NEW deployment mints a new URL and orphans every captain link.

### Truth states & offline (Riley's offline-first ruling preserved)
- **SC-HONEST rev 2** — every state earned, none inferred: **saved on phone** (journal write —
  instant, zero network; Riley ruling: save NEVER blocks on signal) → **sending** → **on the
  sheet** (server verdict `ok` — THE confirmation) → *(cosmetic)* **on the public board** (CSV
  caught up; labeled as lag, ~5 min, never gates anything) · **rejected: <server reason
  verbatim>** with "text Riley" escalation after 2 failures · **conflict** (SC-NOCLOBBER).
- **SC-NOCLOBBER (highest-value pressure-test rule)**: no automatic or one-tap resend ever
  fires into a hole whose sheet value differs from this phone's — a differing value renders the
  quiet conflict state ("sheet says 5 · this phone sent 4") whose ONLY action is an explicit
  two-number replace-confirm. Kills the two-phone flip-flop, stale-queue reversion of Riley's
  manual corrections, and day-2 ghost resends.
- **SC-QUEUE rev 2**: journal-first always (per Riley's ruling); the queue holds **at most one
  entry per (round, hole)** — a newer tap replaces the queued older one — drained strictly in
  order via timer + `pageshow`/`visibilitychange`/`online` (never trusting `navigator.onLine`
  alone), deduped server-side per SC-IDEMPOTENT. Storage wrapped in try/catch (degrade copy:
  "this phone can't remember sends — the sheet is your record"). Unconfirmed entries older than
  the current round age into a quiet informational line, never a resend prompt. Copy states the
  truth: queued scores live on this phone and send **next time this page is open with signal**;
  README names the paper scorecard as the tournament's system of record.
- **SC-YEAR**: the scorer's season = Info `first_tee` year (the validator's own source) — for
  team matching, journal keys, and the glance panel; never `STATE.year`, never max-year-in-Scores.
- **SC-DERIVE**: one derivation everywhere — hole maps read from `buildPlayers()` merged output
  (S-MERGE/S-ZERO semantics), never a second CSV parse; the pad's par labels from the same
  `courseMap()` the grid uses. The scorer view is **exempt from `renderAll()`'s innerHTML
  replacement** (render-boundary pin + smoke assertion): an open pad, a pending send, or a
  conflict dialog survives the 60-second repaint; the glance strip updates in place.
  *(Corrected fact from rev 1: live `REFRESH_MS` is 60s, not 1h — rev 1's SC-POLL and the
  8-minute nudge are DELETED; server confirmation makes both unnecessary.)*
- **SC-GLANCE** (kept): compact board context under the card — labeled honestly
  ("2nd of 9 reporting · thru 6"; neighbors' thru shown); board tally strictly from published
  data with pending-on-this-phone shown as its own labeled line, never blended.

### Fallback lane & admin
- **SC-FORMLANE**: the Google Form stays untouched as the no-JS/no-endpoint fallback, sharing
  `applyScore_`. Hardening from the pressure test: README's Team-question setup says **paste
  the generated list** (see SC-LINKS-ADMIN) — never retype; the "short team labels are fine on
  Scores" guidance is DELETED from README + sheet-polish.gs (it teaches the failure); `setup()`
  asserts the Scores tab headers (`team`, `h1..h18`) and logs loudly if legacy/missing.
- **SC-LINKS-ADMIN rev 2**: START HERE generates (a) per-captain scorer links
  (percent-encoded), (b) the exact Team dropdown item list for the form (same Field-derived
  source), (c) the freeze note: "once links go out, team names are frozen — a rename must also
  be applied to Scores".

### Ship gates
- **SC-TESTS**: smoke additions — hash-query routing; card states incl. conflict rendering and
  the NOCLOBBER refusal; edit-mode two-number confirm; queue coalescing + ordered drain +
  idempotent replay; SC-YEAR keying (fixture with rolled first_tee); payload construction;
  endpoint-misconfig loud state (HTML response fixture); render-boundary survival; SC-PAR label
  shift + par-less degrade + all-18 tally suppression. All jsdom, stubbed endpoint.
- **SC-DRILL (live, ~25 min at draft night — BLOCKING before any link is texted)**:
  (1) pre-flight (headers, first_tee year, timezone, `score_endpoint` pasted, sharing
  restricted, SHEET_EDIT_URL gone from config.js); (2) **the 15-tap sweep** — one submission
  per team, `round 2 / hole 13 / score 6` (hole ≠ score by design so a transposition cannot
  pass), verify 15× `ok` verdicts AND 15× Scores h13=6, record the observed sheet→published-CSV
  lag in the ledger; (3) pocket test (tap, lock screen 2 min — must land); (4) airplane test
  (3 holes offline → all land exactly once); (5) clobber test (differing value from a second
  browser → conflict state, NOT a resend; hand-fix in the sheet → no bounce-back); (6) round-
  toggle spring test; (7) per-round canary: Riley submits one score at each round's first tee.
  Cleanup per S15 (cells cleared AND sweep-created rows deleted — an emptied row still ghosts
  on the board).
- **SC-SCOPE-OUT**: no service worker, no accounts, no board/other-view changes beyond
  SC-PUBBTN, form lane untouched, nav untouched.
- Rollback: git revert on the preview lane; the scorer is inert until `score_endpoint` exists
  in the live Info tab (absent → "scoring opens at the tournament" + raw form link if
  configured); prod exposure only via Riley's push gate.

## §19 — ops-hardening wave (Riley ruled 2026-07-30; research: .superpowers/sdd/ops-research.md)

Eleven items, all ratified. Judgment calls locked: D5 YES (team-list block), D8 YES (polish-primary setup docs), D10 YES (vault-section merge), D11b NO (no env fallback — the loud skip warning is the fix).

- **O-SCOPE (D1)**: `tools/sheet-polish.gs` gains `/** @OnlyCurrentDoc */` line 1 (the live copy has it hand-added — the repo copy must be paste-safe); suite asserts BOTH .gs files carry it.
- **O-TEAMLIST (D5)**: `buildStartHere_` writes a "FORM TEAM LIST" block — distinct current-season Field.team values (season = Info first_tee year), one per line, labeled derived-at run time, honest empty state pre-draft ("no teams yet — the draft fills this in"). Writes ONLY to START HERE (polish-owned). Never touches the Form (F-DROPDOWN stands). Blank team never flagged (E-TEAM).
- **O-REJECT (D6)**: form-writer rejections name their real cause: missing Team answer → "rejected: no Team answer — check the form's question titles"; roster miss → "rejected: team not in roster for <year>" (self-diagnoses a stale first_tee). Rejection strings stay free of personal data (team labels + years only — they land on the published responses tab).
- **O-REPLACED (D7)**: an in-cell score overwrite records the displaced value — response marked "applied (replaced <old>)" when the prior cell held a DIFFERENT number; plain "applied" otherwise. Record, never arbitrate: last-write-wins semantics unchanged; the read happens inside the existing document lock.
- **O-EXTRAGID (D4)**: presend gains repeatable `--extra-gid name=gid` (e.g. `responses=<gid>`) merged into the watchdog loop — closes the published-responses-tab blind spot. CLI-only; NEVER a `GID.responses` config key (13-tab site contract). Malformed value = loud exit 2. Skipped-never-clean semantics inherited.
- **O-VPROBE-LOUD (D11a)**: running presend WITHOUT `--vault-url` prints "V-PROBE SKIPPED — no --vault-url given; the vault is NOT proven unpublished this run." Exit code unchanged for this case (ratified: warn-mode — visibility was the defect, not the contract).
- **O-TEMPLATECHECK (D2)**: NEW `tools/check_template.py` — imports both generators' data dicts, content-diffs them cell-by-cell against the committed xlsx binaries, prints any diff, exit 1 on mismatch / 0 clean / 2 on read failure. READ-ONLY (never writes an xlsx). `npm run check-template`. Not wired into `npm test` (keeps the Node suite Python-free).
- **O-GIDCHECK (D3)**: NEW `tools/gid-check.mjs` — fetches `/d/e/<PUB_ID>/pubhtml`, parses the tab-name→gid map, diffs against config.js, prints a paste-ready GID block on mismatch. PRINT-ONLY (never writes config.js). Zero parsed tabs = loud "could not parse the tab map" exit 2 — never a partial map presented as authoritative. `npm run check-gids`. config.js parsing is shared with presend via an exported `readConfig()` (comment-strip discipline single-sourced).
- **O-ADMINPATH (D9)**: `make_admin_template.py` resolves output from `__file__`, gains a `__main__` guard (import-safe for O-TEMPLATECHECK), and its READ ME row teaches the full presend form incl. `--vault-url`. Admin xlsx regenerated (content-verified; binaries are never md5-gated).
- **O-SETUPDOCS (D8)**: README setup step 1's checkbox conversion: polish() becomes the PRIMARY mechanism (paste Code.gs → run polish() once — safe, closed-list, warn-mode), manual Insert→Checkbox demoted to a labeled fallback; honest that polish needs the Apps Script paste first. The manual sweep's destructive history (Ledger wipe, handicap sweep) is the reason.
- **O-VAULTMERGE (D10)**: the two README vault sections merge into ONE authoritative section with a one-line pointer at the old location. RULE INVENTORY that must survive the merge, verified rule-by-rule: never publish/Share-to-web; separate file, never a tab of the public sheet; CSV export lands OUTSIDE the repo; presend before EVERY send round with `--vault-url`; the DNI pairing rule (every vault DNI row gets a public Invites `out` row in the same sitting); Gmail reply loop stays human-approved, failed scan ≠ no replies; vault template upload never published; presend credit for DNI automation (the corrected claim).
- **Deploy note**: .gs changes reach the LIVE sheet only when Riley re-pastes them (manual paste IS the deploy path — F1); post-merge operator step recorded.

### §18 rev 3 — scorer UI refinement (Riley approved 2026-07-30, prototype artifact aa4284a9-a404-46b8-b37f-67ec793013d5)

Riley reviewed a tappable refinement prototype and approved it ("that looks good"). These pins refine §18 rev 2's SCREEN only — every write-path, truth-state, and access rule of rev 2 stands unchanged (SC-WRITE, SC-VALIDATE, SC-IDEMPOTENT, SC-HONEST, SC-NOCLOBBER, SC-LOUD-CONFIG, the spike gate).

- **SC-UI-V (supersedes rev 2's "two rows of 9" layout)**: the card renders as TWO VERTICAL COLUMNS (Out | In), one full-width row per hole — hole number, par + yards, score, state mark. Geometry forced this: nine cells across a 390px phone is ~37px per target, under the pressure test's own ≥44px floor; column rows are ~190×52px. Rows-of-9 is retired for this view only (the public board's grid is untouched).
- **SC-PAD-SHEET**: the number pad is a BOTTOM SHEET in the thumb zone. Par is the visually primary key; keys carry golf labels (Eagle/Birdie/Par/Bogey/+n) computed from the hole's real par; "Other" expands the numeric overflow (full 1–19 range preserved). The glance header stays sticky above it: team + roster line, momentary round chip, Out/In/Total tallies and to-par.
- **SC-NEXT-HINT**: after each paint, the FIRST empty cell gets a soft pulse — an affordance ONLY, never a selection, never a write target (rev 2's no-next-hole-inference pin is untouched; shotgun-proofing intact). `prefers-reduced-motion` disables it.
- **SC-SKIN**: the scorer wears the site's identity — `--display` numerals, `--ui` labels, pine/bone/sage/brass tokens, the board's scoreClass coloring. Every cell state carries a MARK plus color (▮ on the sheet · ⇡ saved/sending · ▲ conflict); nothing functional under 13px.
- **SC-CONFLICT-UI**: the conflict cell shows BOTH numbers ("5·4" + ▲); tapping opens a two-button ruling — "Keep the sheet's N" / "Replace with mine" — in plain words. This is the visual form of SC-NOCLOBBER; semantics unchanged.
- **SC-TALLY-HONEST**: header tallies compute from non-conflict scored holes only and the to-par label carries its basis ("To par · thru N"); a disputed hole counts nowhere until resolved (S12).
- Prototype caveats: the artifact's fake send timer, hardcoded conflict, and demo copy are NOT spec — transport and states come from rev 2.

- **SC-BOARD-BTN (Riley ruled 2026-07-30, addendum to rev 3)**: the Board view gains an
  "Enter scores — Team <name>" button that renders ONLY when this phone carries a persisted
  scorer identity (the same localStorage persistence SC-LINK already writes on first link
  open); it simply routes to bare `#score` (which resumes that team). No persisted identity →
  NO button, no team picker, nothing rendered — spectators and strangers never see a write
  affordance. Access stays link-gated by distribution (SC-ACCESS unchanged); this is a
  shortcut for already-linked captains, not a new entry path. Suggested placement: beside the
  board's year picker, styled as a quiet brass action, event-window or not (captains check
  standings year-round). Smoke coverage: button absent on a fresh dom; present after the
  persisted-identity key is planted.

## §20 — D3 par-integrity wave (Riley ruled 2026-07-31; finding: rev-3 Task-5 S11 battery, D3)

The defect (pre-existing since c205e32): a Course row present with a BLANK par cell still creates
its key (`parseInt("")||0` → 0), so `courseMap()` returns a non-null map with `pars[h]===0` — the
to-par arithmetic silently counts that hole's strokes against zero par, skewing the scorer tally
AND the public leaderboard To-par column (and gross-basis ranking order), with no warning. This
violates SC-PAR's own pin ("suppressed entirely (strokes only) **unless all 18 pars parse**") —
the implementation counts KEYS; the spec demands VALID PARS. This wave closes that gap.

- **SC-PAR-VALID:** `courseMap()` and `courseYards()` validate VALUES, not keys — a hole's key is
  created only when its cell parses to a positive integer. The all-18-or-null contract stands
  unchanged. Consequence: a blank/invalid par cell now triggers the SAME honest degrades as a
  missing row (scorer tally → strokes mode "Thru N"; leaderboard → gross totals, `rel=null`;
  grid → the existing "needs all 18 holes" note; per-hole labels survive via `scHolePar`'s
  row-fallback exactly as shipped). **Single-point fix:** only the two map builders change (plus
  SC-PAR-WARN below); every consumer — `scTallyHTML`, `buildPlayers`, `renderLeaderboard`,
  `renderScoreGrid`, `scHolePar`, `scoreClass` — is byte-untouched.
- **SC-PAR-WARN:** after the build pass, any hole 1–18 lacking a valid par raises a health-strip
  flag naming the hole, verbatim copy: `Course tab: hole <N> par missing or invalid — To-par
  suppressed (strokes only)`. Uses the existing `flag()`/`renderHealth()` idiom (per-load,
  deduped); par only — yards validation is silent (a missing yards label is cosmetic, and a
  yards warning would be noise).
- Tests pinned: X33 (scorer honest degrade + warning under a blank-par cell), X34 (leaderboard
  suppression, both directions), X35 (grid note under blank-par). Suite 201 → 204. Mutation bar:
  reverting the value-validation must fail X33/X34.

### §20 amendment (2026-07-31, Task-1 review escalation — ratified by the wave owner)
Value-validating `courseYards()` must not cost the 17 good labels: with one blank/invalid yards
cell the whole-map-null degrade blanked the grid's entire Yds row and every hole panel's yardage
suffix. `renderScoreGrid` and `renderHolePanel` switch their direct `yds[h]` reads to the EXISTING
per-hole `scHoleYards(h)` fallback (reuse, no new mechanism) — 17 true labels survive, the bad
hole shows "—"/no suffix, and no `0 yds` can ever render. Pinned test: X36 (blank-yards cell —
grid row keeps 17 real yardages + "—" on the bad hole; card cell yds line absent for that hole
only). Suite 204 → 205. X34's check name corrects "ranking unskewed" → suppressed mode ranks by
raw gross (the shipped fallback), and X34 gains a leader-selection assert pinning that fallback.

### §20 amendment 2 (2026-07-31, Task-2 S11 escalation — ratified by the wave owner)
Suppression must be honest at EVERY surface, not just the tally tile. Two pins:
- **SC-PAR-LABEL:** no gross total may render under a "To par" label. When `courseMap()` is null,
  the leaderboard's par-relative column presents as **Total** (label flips; at widths where the
  separate Total column also shows, resolve the duplication in whichever minimal honest way the
  markup allows — never two differently-valued columns under one name, never a gross under
  "To par"). Both widths structurally asserted.
- **SC-PAR-GLANCE:** rank claims ("You're leading", "3rd of N reporting") are suppressed when
  `courseMap()` is null — the raw-gross fallback ordering compares unequal hole counts and must
  not be presented as standing. The glance keeps its neutral facts (thru N, pending-on-phone).
Pinned tests: X37 (board label honesty, both directions + both widths), X38 (glance rank-claim
suppression + neutral facts survive). Suite 205 → 207. renderLeaderboard/scGlance (and their
CSS/markup) are UNFROZEN for exactly these changes; engine + all other frozen functions stand.

## §21 — suppression-rank wave (Riley: "continue the wave" 2026-07-31; extends §20 amendment 2 site-wide)

Amendment 2's rationale — the raw-gross fallback ordering "compares unequal hole counts and must
not be presented as standing" — applied to the two remaining standing surfaces. Suppression
signal everywhere: `!courseMap()` (the §20 idiom). Money that is already collected/owed is never
suppressed; only CLAIMS OF STANDING are.

- **SC-RANK-POS (board):** when suppressed, every `.lb-pos` cell renders `—` and no row carries
  `.lead` (the brass crown). Row ORDER stays as-is (a list needs an order; the sort is not a
  claim — the Pos number and crown are). Complete course ⇒ exactly today's behavior.
- **SC-RANK-CAL (calcutta, GROSS basis only):** net-basis standings derive from handicaps and
  totals, not pars — they stay live. When basis is gross AND `courseMap()` is null:
  - The payout table assigns NO places: `#payBody` renders the honest empty-state, pinned copy
    verbatim: `Payouts wait on the Course tab — standings need all 18 pars.` `#calBasis` pinned
    verbatim: `Paused · Course pars incomplete`.
  - Per-lot would-text: lots that would today read `Wins if it ended now: $N` / `Won: $N` / `—`
    (owned, ranked, non-wd) read `awaiting pars` instead. The `withdrawn` / `unsold` /
    `waiting on cards` branches keep priority unchanged.
  - Money tiles and rollups (`#calPot`/`#calRake`/`#calPayable`/`#calTop`/`#calOut`) are
    byte-identical to the unsuppressed render — collected/owed money is not a standing claim.
- **Unfrozen surfaces:** `renderLeaderboard` (Pos/lead emission only) and `renderCalcutta`
  (payout-table/would-text/calBasis branches only). FROZEN: `rankedPlayers` (ordering untouched),
  `calcuttaModel`, `buildPlayers`, `courseMap/courseYards`, the v2.6 engine, and everything §20
  froze. renderScoreGrid/renderHolePanel consume the same ordering but make no place claims —
  out of scope, noted.
- Tests pinned: X39 (board Pos/crown, both directions), X40 (calcutta suppression, both
  directions + money-tile invariance). Suite 207 → 209. Mutation bar: reverting the Pos/crown
  suppression fails X39 alone; reverting the calcutta branch fails X40 alone.
- Copy above is wave-owner-pinned honesty-mechanics; Riley may re-style wording post-merge.
