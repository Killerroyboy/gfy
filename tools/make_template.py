#!/usr/bin/env python3
"""Generate gfy-template.xlsx — the Google Sheet template for the GFY site.

Usage:  python3 tools/make_template.py
Output: tools/gfy-template.xlsx  (upload to Google Drive, open as a Sheet)

Each sheet gets its exact header row (row 1, bold, frozen) plus a few rows of
sample data showing the expected shape. Replace the samples with real data.
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
            ["format", "36 holes, stroke"],
            ["first_tee", "2026-08-15T09:00:00-06:00"],
            ["est_year", "2019"],
            ["calcutta_rake", "10"],
            ["calcutta_basis", "gross"],
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
        "headers": ["year", "player", "handicap", "status", "deposit"],
        "rows": [
            [2026, "Duck", 8, "In", "Paid"],
            [2026, "Hammer", 12, "In", ""],
            [2026, "Sully", 15, "Maybe", ""],
        ],
    },
    "Scores": {
        "headers": ["year", "player", "round"] + [f"h{i}" for i in range(1, 19)],
        "rows": [
            [2026, "Duck", 1, 4, 5, 3, 6, 4, 4, 3, 5, 5, 4, 5, 3, 4, 4, 4, 3, 6, 4],
            [2026, "Hammer", 1, 5, 4, 4, 5, 4, 5, 3, 4, 5, 4, 6, 3, 5, 4, 4, 4, 5, 5],
            # A round in progress: fill holes as they are played, leave the rest blank.
            [2026, "Sully", 1, 5, 4, 3, 5, 4, 6, 4, 4, 5] + [""] * 9,
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
            [2026, "Round One", "Saturday · Shotgun", "9:00 am", "Duck · Hammer · Sully"],
            [2026, "Round One", "Saturday · Shotgun", "9:00 am", "Moose · Tex"],
            [2026, "Round Two", "Sunday · Tee times", "8:30 am", "Leaders out last"],
        ],
    },
    "Calcutta": {
        "headers": ["year", "player", "owner", "price", "buyback"],
        "rows": [
            [2026, "Duck", "Tex", 120, 50],
            [2026, "Hammer", "Sully", 100, ""],
            [2026, "Moose", "Duck", 80, 25],
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
            [2026, "Duck", 100, 180, "yes"],
            [2026, "Hammer", 100, 40, ""],
            [2026, "Sully", 100, 0, ""],
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
