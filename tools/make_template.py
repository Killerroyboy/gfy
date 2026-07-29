#!/usr/bin/env python3
"""Generate gfy-template.xlsx — the Google Sheet template for the GFY site.

Usage:  python3 tools/make_template.py
Output: tools/gfy-template.xlsx  (upload to Google Drive, open as a Sheet)

Each sheet gets its exact header row (row 1, bold, frozen) plus a few rows of
sample data showing the expected shape. Replace the samples with real data.

Field.deposit, Ledger.settled, Calcutta.collected, and Invites.invited /
Invites.responded are checkbox columns on the site. xlsx has no Google
Sheets checkbox type, so the samples below hold the literal strings
TRUE/FALSE; the README documents the one-time conversion step (select the
column > Insert > Checkbox) after "Save as Google Sheets".

Invites.email is for mail-merge only — the site never renders it (see the
README's "The invite list" section).
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

SHEETS = {
    "Info": {
        "headers": ["key", "value"],
        "rows": [
            ["dates", "Aug 14–16"],
            ["course", "Meadow Creek"],
            ["lodging", "Bear Creek Lodge"],
            ["format", "2-day scramble"],
            ["first_tee", "2026-08-15T09:00:00-06:00"],
            ["est_year", "2019"],
            ["calcutta_rake", "10"],
            ["calcutta_basis", "gross"],
            ["deposit_amount", "200"],
            ["payment_handle", "Venmo @gfy-duck"],
        ],
    },
    "Course": {
        "headers": ["hole", "par", "yards"],
        "rows": [
            [1, 4, 385],
            [2, 4, 410],
            [3, 3, 175],
        ],
    },
    "Field": {
        # team = captain's name of the player's team; the captain's own row
        # names himself (player == team). since = first GFY year (fill once).
        "headers": ["year", "player", "team", "since", "handicap", "status", "deposit", "paid_date"],
        "rows": [
            [2026, "Duck", "Duck", 2019, 8, "In", "TRUE", ""],       # captain
            [2026, "Hammer", "Duck", 2019, 10, "In", "TRUE", ""],    # partner
            [2026, "Sully", "Sully", 2021, 15, "In", "FALSE", ""],   # captain, deposit not in yet
            [2026, "Tank", "Sully", 2026, 20, "In", "TRUE", ""],     # partner + rookie (since == this season)
            [2026, "Tex", "Tex", 2019, 18, "In", "TRUE", ""],        # captain, third team
            # A next-season payer: rooms go in the order people paid, so
            # paid_date matters more than the row's position on the sheet.
            [2027, "Duck", "", "", "", "", "TRUE", "2026-08-20"],
        ],
    },
    "Scores": {
        # One row per TEAM per round, keyed by the captain's name (matches
        # Field.team). Duplicate (team, round) rows merge their hole maps.
        "headers": ["year", "team", "round"] + [f"h{i}" for i in range(1, 19)],
        "rows": [
            [2026, "Duck", 1, 4, 5, 3, 6, 4, 4, 3, 5, 5, 4, 5, 3, 4, 4, 4, 3, 6, 4],
            [2026, "Sully", 1, 5, 4, 4, 5, 4, 5, 3, 4, 5, 4, 6, 3, 5, 4, 4, 4, 5, 5],
            # A round in progress: fill holes as they are played, leave the rest blank.
            [2026, "Tex", 1, 5, 4, 3, 5, 4, 6, 4, 4, 5] + [""] * 9,
        ],
    },
    "Schedule": {
        "headers": ["year", "day", "label", "time", "event", "location"],
        "rows": [
            [2026, "Day One", "Friday", "3:00 pm", "Check in, claim a bed", "Bear Creek Lodge"],
            [2026, "Day One", "Friday", "5:30 pm", "Draw for pairings", "Lodge deck"],
            [2026, "Day Two", "Saturday", "9:00 am", "Round One — shotgun start", "Meadow Creek"],
        ],
    },
    "Pairings": {
        "headers": ["year", "round", "when", "time", "players"],
        "rows": [
            [2026, "Round One", "Saturday · Shotgun", "9:00 am", "Duck · Hammer"],
            [2026, "Round One", "Saturday · Shotgun", "9:00 am", "Sully · Tank"],
            [2026, "Round Two", "Sunday · Tee times", "8:30 am", "Leaders out last"],
        ],
    },
    "Calcutta": {
        # One row per team lot. No buyback in team mode — owners pay full
        # price to the pot; winnings pay the owner.
        "headers": ["year", "team", "owner", "price", "collected"],
        "rows": [
            [2026, "Duck", "Tex", 120, "TRUE"],
            [2026, "Sully", "Duck", 100, "FALSE"],
            [2026, "Tex", "Sully", 90, "TRUE"],
        ],
    },
    "Payout": {
        "headers": ["year", "place", "share"],
        "rows": [
            [2026, 1, 50],
            [2026, 2, 30],
            [2026, 3, 20],
        ],
    },
    "Ledger": {
        "headers": ["year", "player", "buyin", "won", "settled"],
        "rows": [
            [2026, "Duck", 100, 180, "TRUE"],
            [2026, "Hammer", 100, 40, "FALSE"],
            [2026, "Sully", 100, 0, "FALSE"],
        ],
    },
    "Champions": {
        "headers": ["year", "champion", "score"],
        "rows": [
            [2025, "Duck", "151 (+7)"],
            [2024, "Hammer", "149 (+5)"],
            [2019, "Tex", "Inaugural"],
        ],
    },
    "Shame": {
        "headers": ["year", "award", "player", "detail"],
        "rows": [
            [2026, "Cart incident", "Moose", "Found the one tree on the 7th."],
            [2026, "Most balls lost", "Sully", "Eleven. The creek ate nine of them."],
        ],
    },
    "Invites": {
        # Next-season outreach tracking — separate from who's actually paid
        # (that's Field, above). status=out means "not returning" and
        # suppresses the person from the Next Year board, same convention
        # as Field.status. email is mail-merge only; it never renders.
        "headers": ["year", "player", "email", "invited", "responded", "status"],
        "rows": [
            [2027, "Sully", "sully@example.com", "TRUE", "TRUE", ""],   # invited + responded
            [2027, "Tex", "tex@example.com", "TRUE", "FALSE", ""],      # invited, no reply yet
            [2027, "Bear", "bear@example.com", "FALSE", "FALSE", "out"],# not returning
        ],
    },
}


def main() -> None:
    wb = Workbook()
    wb.remove(wb.active)  # drop the default sheet; create ours in order
    bold = Font(bold=True)
    for name, spec in SHEETS.items():
        ws = wb.create_sheet(title=name)
        ws.append(spec["headers"])
        for cell in ws[1]:
            cell.font = bold
        ws.freeze_panes = "A2"
        for row in spec["rows"]:
            ws.append(row)
    out = Path(__file__).resolve().parent / "gfy-template.xlsx"
    wb.save(out)
    print(f"wrote {out} ({len(SHEETS)} sheets)")


if __name__ == "__main__":
    main()
