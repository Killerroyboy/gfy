# The 2027 data package — one sitting

> **What this is:** BACKLOG R3/#6 turned into a worklist you can clear in one pass instead
> of ten pings. Every row below is a decision only you hold, with the current live value,
> a recommendation, and what breaks if it is skipped.
>
> **Grounded 2026-09-28** against the live sheet (`npm run event-ready`, one deliberate run:
> 30 findings — 25 residue, 3 cross-tab, 1 scorer, plus WARNs). Values marked *current* were
> confirmed verbatim-identical to the template that same run. **This document is a snapshot,
> not live truth** — re-run `npm run event-ready` at the end; that is the authority, not this file.
>
> Order matters: `first_tee` drives the season, the schedule window, the scorer key and the
> board. Do Info first or you will redo work.

---

## Before anything: read this one finding

**The acceptance gate as written may be unpassable, and that is a defect in the gate, not in you.**

§27 EV-ACCEPT says: after the fill, `npm run event-ready` must be GREEN, *or every surviving
FAIL explained per row — a residue FAIL that survives real data is a validation bug wearing a
residue costume.* That instruction is right, and it is about to fire.

Residue detection flags a row when it is **verbatim identical to the template sample**. Three
Info keys look like they are legitimately identical to the template *because the template was
written from reality*:

| Key | Template value | Why it may be real |
|---|---|---|
| `course` | `Meadow Creek` | The event is at MeadowCreek, New Meadows ID. The Course tab's 18 holes are already verified-real against the C-REAL checksums. |
| `format` | `2-day scramble` | The event is a 2-day scramble. That is the format, not a placeholder. |
| `est_year` | `2019` | 2019 is the site's own founding-year literal, and Champions carries a 2019 "Inaugural" row. |

If those are real, they can never clear, `event-ready` exits 1 forever, and the honest response
— "explain every surviving FAIL" — turns into the habit of ignoring residue FAILs. That is the
cry-wolf failure the `gfy-readiness` overseer check was deliberately designed to avoid one level
up, and it would be re-introduced here at the worst moment.

**Precedent:** the Course tab hit this exact class and got an *earned* exemption (`cee71f9`) —
event-ready fetches the live Course tab, diffs all 18 holes against the real checksums, and
exempts it **per run**, withholding the exemption loudly on any divergence. Info needs the same
shape, not a blanket skip.

**Your call (needed, and it is a ruling not a preference):** for each of the three keys above —
is the template value the REAL 2027 value? Anything you confirm real, I will wire as an earned
per-run exemption on the same pattern as Course. Anything you change makes the question moot.
**`payment_handle` gets no exemption under any circumstances** — it is a fake handle currently
displayed in public, and it must change.

---

## Step 0 — arm the scorer first (the CEO's sequencing ruling, and I agree)

Arming does **not** wait on data. Doing it first means the scariest component is proven while
you still have the sheet in your hands, and the dangerous step — re-pointing the deployment at
the sheet — gets rehearsed on the real thing rather than on a scratch copy.

1. **README step 3b FIRST** — delete the §18 spike's duplicate `doPost`/`doGet` from the Apps
   Script project. One project = ONE global scope, so the spike silently overwrites the real
   handler. Skipping this makes arming *look* successful while still serving the stub.
2. **Redeploy the real handler on the SAME deployment URL** (Manage deployments → Edit → New
   version). A new deployment mints a new URL and orphans every captain link already handed out.
3. Paste `Info!score_endpoint` (row 12), then `npm run check-endpoint -- <url>` must print **REAL**.
4. `npm run drill-sweep -- <url>` — dry-run first, then `--go`.
5. Drill steps 3–7 by hand. **Pass condition is a ROW APPEARING in Scores, never a 200.**

> Two probe defects were fixed 2026-09-28, both on this path. The probe now refuses to say
> "continue" when the handler is bound but throwing (it used to print REAL and exit 0), and it
> retries Apps Script's short-lived redirect instead of reporting a live endpoint as
> UNREACHABLE (measured 1-in-4 false negatives before the fix). If it says REAL now, it means it.

---

## Info tab — do this first, everything keys off it

| Row | Key | Current (= template) | Decision | Consequence if skipped |
|---|---|---|---|---|
| 2 | `dates` | `Aug 14–16` | **Replace** with the real 2027 dates | Poster and captain cards print `[ 2027 DATES ]`; the site shows last year's window |
| 3 | `course` | `Meadow Creek` | **Confirm real or replace** (see the finding above) | Residue FAIL that may never clear |
| 4 | `lodging` | `Bear Creek Lodge` | **Confirm real or replace** | Poster venue line prints `[TBD]` if blanked |
| 5 | `format` | `2-day scramble` | **Confirm real or replace** | Residue FAIL that may never clear |
| 6 | `first_tee` | `2026-08-15T09:00:00-06:00` | **Replace** — full ISO **with offset**, e.g. `2027-08-13T09:00:00-06:00` | Drives season, schedule window, scorer key, countdown, Now/Next. Everything. |
| 7 | `est_year` | `2019` | **Confirm real** (likely correct) | Residue FAIL that may never clear |
| 8 | `calcutta_rake` | `10` | Confirm or change — policy, may legitimately stay | Residue FAIL if unchanged |
| 9 | `calcutta_basis` | `gross` | Confirm or change — note net basis is never suppressed | Residue FAIL if unchanged |
| 10 | `deposit_amount` | `200` | Confirm or change | Residue FAIL if unchanged |
| 11 | `payment_handle` | `Venmo @gfy-duck` | **REPLACE — this is FAKE and publicly displayed** | A fake payment handle on a live page asking people for money |
| 12 | `score_endpoint` | *(absent)* | **Paste from Step 0** | Scoring stays unarmed |

> **`first_tee` format matters more than it looks.** Type the full ISO string with the offset.
> A bare year (`2027`) used to make the board render one season while the scorer keyed another —
> scores would post fine and never appear. Fixed 2026-09-28 (BACKLOG #22), and `event-ready`
> still FAILs a bare year, but full ISO is what the README asks for and what everything expects.

---

## Schedule tab — 3 residue rows, and one structural gap

Current rows are 2026 samples (`Day One / Friday 3:00 pm / Check in, claim a bed / Bear Creek
Lodge`, `Day One / Friday 5:30 pm / Draw for pairings / Lodge deck`, `Day Two / Saturday
9:00 am / Round One — shotgun start / Meadow Creek`).

- **Replace all three** with the real 2027 schedule.
- **There is no day-3 row.** `event-ready` currently FAILs `schedule coverage: no row for event
  day 2026-08-16`. A 2-day scramble spans three calendar days including arrival — add the row
  for the final day or the Now/Next strip goes blank on the day it matters most.

## Field tab — the roster

- 2 of 5 rows for the season are **missing handicaps** (WARN). A net-basis Calcutta needs them.
- Blank `team` is **normal** pre-draft — the draft is Friday night. Do not invent teams.
- Full names (first + last) on Field/Invites/Rooms.

## Calcutta tab — 3 cross-tab FAILs

`calcutta.team` values **Duck**, **Sully**, **Tex** have no matching Field team. Either the
Calcutta rows are stale samples (wipe them) or Field is missing those teams. **Recommendation:**
wipe — these are the 2026 sample lots, and Calcutta cannot be real before the draft.

## Rooms · Payout · Shame · Champions — confirm before delete

| Tab | Rows | Recommendation |
|---|---|---|
| Rooms | 4 sample rows (Bear Creek Lodge, Duck/Hammer/Sully/guest:Pat) | Wipe; re-enter after the room assignment |
| Payout | `1→50`, `2→30`, `3→20` | **Your call:** keep the split or change it. Keeping it means a permanent residue FAIL — same class as the Info keys |
| Shame | Moose "Cart incident", Sully "Most balls lost" | **CONFIRM BEFORE DELETE** — these read as real in-jokes, not template filler |
| Champions | rows 4–5 flagged (`Moose 155 (+11)`, `Hammer 149 (+5)`) | **CONFIRM BEFORE DELETE.** The 2019 "Inaugural" row and the edited top rows are NOT flagged, so parts of this tab are already real. Champions history feeds next year's `since`/rookie logic — deleting a real year quietly fabricates rookies later |

> **Is "Jake" a real person?** Still open from BACKLOG #6. It affects the Champions 2026 row.

## Invites tab — 4 WARNs, no FAILs

`Joe`, `Trevor`, `Jeff`, `Riley` are first-time invitees for 2027 with no `invited_by`. Record
the sponsor for each. WARNs never change the exit code, so this will not block the gate — but
the who-invited-who tracking was your own ruling, and it is only populated by hand.

---

## Close the sitting

1. `npm run event-ready` — the authority. Expect GREEN, **or** a short list of surviving
   residue FAILs on keys you deliberately kept.
2. If any FAIL survives on a key you confirmed real → that is the exemption work, not a data
   problem. Tell me which keys you confirmed and I will wire the earned per-run exemption on
   the Course-tab pattern.
3. `npm run check-endpoint -- <url>` must print **REAL** (Step 0).
4. Then, and only then, captain links go out.

**Do not run `npm run check:live` or `event-ready` in a loop** — the published-CSV endpoint
rate-limits bursts, and a rate-limited run is what made the overseer's GFY check go
green-while-blind for three days.
