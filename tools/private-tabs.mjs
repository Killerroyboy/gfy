// The ONE closed list of tabs that must never be published to the web (WO-ONE-FILE). They hold addresses,
// reply text and RSVP tokens and live in the SAME spreadsheet as the published tournament tabs.
// LOCKSTEP (single source, enforced by test/onefile.test.mjs): MAIL_PRIVATE_TABS in tools/gfy-mailer.gs and
// GFY_PRIVATE_TABS in tools/sheet-polish.gs must equal this list.
export const PRIVATE_TABS = ["Contacts", "Replies", "RSVP", "SendLog", "Dashboard", "Admin READ ME"];

// Tabs the site does not read through config.js GID but which are legitimately published.
export const EXTRA_PUBLIC_TABS = ["START HERE", "Form Responses 1"];
