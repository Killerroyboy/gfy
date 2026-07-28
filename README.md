# GFY — team scramble site

A one-page site for the GFY golf weekend — now a 2-day team scramble. The
page is static; all live data comes from one Google Sheet that anyone in the
group can edit. Publish the sheet once, paste a few ids into `config.js`,
and the site updates itself every 60 seconds.

No servers, no accounts, no build step. If you can edit a spreadsheet, you
can run this site.

The site is **tabbed** — the sticky nav bar is the tab list (Home, Board,
Field, Calcutta, Money, Next Year, Schedule, Pairings, Rules, Champions,
Shame, Photos). Switching tabs doesn't reload the page, and each tab has its
own deep link (`yoursite.com/#calcutta`, `#nextyear`, …) — safe to bookmark
or text someone straight to a section.

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
   the `deposit` column on Field, the `settled` column on Ledger, and the
   `collected` column on Calcutta, one at a time: **Insert > Checkbox**.
   Sheets converts the existing TRUE/FALSE values into checked/unchecked
   boxes in place — nothing else to redo.
4. The sheet has 11 tabs along the bottom (Info, Course, Field, Scores, …).
   Each has a bold header row and a few sample rows showing the shape.
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
   11 tabs in turn and write down each number. The first tab is usually `0`.

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
- `SHEET_EDIT_URL` — the normal editing link, so the "Enter scores" button
  works (share the sheet with the group as editors)
- `DRIVE_FOLDER_ID` — from step 5, or leave `""`

Easiest way to edit without any tools: open the file on github.com, click
the pencil icon, paste, **Commit changes**. The live site updates itself
about a minute later.

### 7. Check your work

**Start with the health strip** — it's the first thing to check, no URL
tricks required. A one-line strip near the top of the live site (collapsed
by default; tap to expand) calls out anything the sheet gets wrong:
unmatched score captains, duplicate captains, blank years, cells it can't
parse as a price or handicap, and similar. If a team is missing from the
board or a number looks off, check the strip before anything else.

For the full picture, open the live site with `?debug=1` on the end of the
address:

```
https://<your-pages-url>/?debug=1
```

A panel appears listing every tab as `OK` (with a row count), `EMPTY`, or
`FAILED` with the reason, plus the same health warnings as the strip above.
Eleven `OK` lines means the plumbing is done. Remove `?debug=1` and hand out
the link.

**Phones:** open the link in Safari/Chrome, then *Share > Add to Home
Screen*. It installs like an app, icon and all.

---

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

That's it — no other columns need filling in yet. Rooms go in the order
people paid, so the site builds the paid list ordered by `paid_date`,
earliest first; a paid row with no date sorts after the dated ones. Anyone
not yet in the list shows up on the Owing side instead, with the deposit
amount and payment handle (Info tab) right there to tap.

If someone isn't coming back, set their current-season `status` to `out` —
they drop off the Next Year board without deleting any history.

## When something looks wrong

| Symptom | Likely cause |
|---|---|
| Empty leaderboard, sheet has data | Wrong PUB_ID (edit-URL id instead of the published `2PACX-…` id) — see step 3 |
| One section empty, rest fine | That tab's gid is wrong or missing in `config.js` |
| Team missing from board | The captain's name in Scores' `team` column doesn't match any team in Field — check the health strip, it names the mismatch |
| Edits don't show up | Google republishes on a short delay — wait ~5 min; also check File > Share > Publish to web is still active |
| Album shows a permission error | Drive folder not shared "Anyone with the link" — step 5 |
| Anything else | Check the health strip, then add `?debug=1` to the URL and read the panel |

## For whoever maintains this

```
index.html          the whole app (HTML + CSS + JS, no build step)
config.js           the only file you edit routinely
tools/make_template.py   regenerates tools/gfy-template.xlsx
fixtures/           sample CSVs mirroring the 11 tabs, incl. edge cases
test/smoke.mjs      headless render test against the fixtures
```

Run the test before deploying any change:

```
npm install
npm test        # must end "39/39 assertions passed"
```

Local preview (config.js does not load right from a double-clicked file —
always use a local server):

```
python3 -m http.server 8000     # then open http://localhost:8000
```
