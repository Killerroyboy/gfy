#!/usr/bin/env python3
"""Build tools/gfy-admin-template.xlsx — the GFY Admin VAULT template.

This sheet is the NEVER-published home of every email address and
do-not-invite reason (spec §12 P-VAULT, §13 V-TABS). Upload to Drive →
save as Google Sheet → do NOT publish, do NOT add as a tab of the public
sheet (the public sheet publishes Entire-document; new tabs auto-publish).
Sample rows are deliberately fake (V-SAMPLE) — this xlsx ships in a
public repo."""
from openpyxl import Workbook

TABS = {
    "Contacts": {
        "headers": ["player", "email", "email_alt", "phone", "do_not_invite", "reason", "notes"],
        "rows": [
            ["Person One", "person.one@example.com", "", "", "FALSE", "", "player name must match the public sheet exactly"],
            ["Person Two", "person.two@example.com", "two.alt@example.com", "", "FALSE", "", ""],
            ["Person Three", "person.three@example.com", "", "", "TRUE", "sample reason", "do_not_invite rows never get sent"],
        ],
    },
    "SendLog": {
        "headers": ["date", "player", "address_used", "what", "note"],
        "rows": [["2026-08-01", "Person One", "person.one@example.com", "invite", "sample row — one line per email sent"]],
    },
    "READ ME": {
        "headers": ["warning"],
        "rows": [
            ["This file holds real addresses once filled in. NEVER click File → Share → Publish to web on it."],
            ["Keep it a SEPARATE Google Sheets file. Never add it as a tab of the public GFY sheet."],
            ["Before every send round: export Contacts as CSV and run: npm run presend -- <path outside the repo>"],
        ],
    },
}

wb = Workbook()
wb.remove(wb.active)
for name, spec in TABS.items():
    ws = wb.create_sheet(name)
    ws.append(spec["headers"])
    for row in spec["rows"]:
        ws.append(row)
wb.save("tools/gfy-admin-template.xlsx")
print("wrote tools/gfy-admin-template.xlsx")
