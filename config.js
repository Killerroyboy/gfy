/* ============================================================
   GFY site configuration — the ONLY file you edit year to year.
   After editing: commit + push, and GitHub Pages redeploys in
   about a minute. Full setup instructions live in README.md.
   ============================================================ */
window.CONFIG = {
  // The PUBLISHED spreadsheet id — NOT the id in the normal editing URL.
  // Get it: open the Google Sheet > File > Share > Publish to web >
  // choose "Entire document" + "Comma-separated values (.csv)" > Publish.
  // Google then shows a URL like:
  //   https://docs.google.com/spreadsheets/d/e/2PACX-1vR3xAmPlEToken/pub?output=csv
  // PUB_ID is the long token between "/d/e/" and "/pub". It always starts
  // with "2PACX-". If yours doesn't, you copied the wrong URL.
  // Example: PUB_ID: "2PACX-1vR3xAmPlELongTokenGoesHere",
  PUB_ID: "",

  // One gid per tab. Find each gid in the NORMAL editing URL: click the
  // tab at the bottom of the sheet, then copy the number after "#gid=" in
  // the browser address bar. The first tab is usually 0.
  // Example: GID: { info:"0", course:"1837552901", field:"482915637", ... },
  GID: {
    info: "0",
    course: "",
    field: "",
    scores: "",
    schedule: "",
    pairings: "",
    calcutta: "",
    payout: "",
    ledger: "",
    champions: "",
    shame: "",
    invites: ""
  },

  // The normal EDITING url of the sheet — powers the "Enter scores" button
  // in the hero. Leave "" to hide the button.
  // Example: SHEET_EDIT_URL: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKl/edit",
  SHEET_EDIT_URL: "",

  // Google Drive photo folder id — the token after "/folders/" in the
  // folder's URL. The folder must be shared "Anyone with the link: Viewer"
  // or the album shows a Google permission error. Leave "" for placeholder.
  // Example: DRIVE_FOLDER_ID: "1aB2cD3eF4gH5iJ6kL7mN8oP",
  DRIVE_FOLDER_ID: "",

  // First tee time in ISO 8601 WITH the UTC offset (McCall is -06:00 in
  // August). Drives the countdown and the calendar button. A first_tee row
  // in the sheet's Info tab overrides this value.
  // Example: FIRST_TEE: "2026-08-15T09:00:00-06:00",
  FIRST_TEE: "2026-08-15T09:00:00-06:00",

  // Currency symbol shown in front of every money figure.
  // Example: CURRENCY: "$",
  CURRENCY: "$",

  // How often the page re-pulls the sheet, in milliseconds.
  // Example: REFRESH_MS: 60000,   // one minute
  REFRESH_MS: 60000
};
