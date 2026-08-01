# GFY → mc-unified cockpit registration (BANKED — oldmac offline 2026-08-01)

Execute when oldmac is reachable. Grounding fact sheet: session 2026-08-01 (MC pipeline map).
newmac half is DONE (mc-ground tracks gfy: add_ahead + MCG_BACKLOGS, .mc-ground @ 2c87ef3).

**Design: B (codecheck-precedent static tile), NOT A.** GFY has no oldmac-side repo and no
prod lane the cockpit should drive; a `local:true` tile + narrative sourced from a pushed
backlog file is the honest scope.

Steps (all on oldmac, T8 discipline — md5-gate every file, .patched siblings, dated backup,
mission-control.html and -v2.html MUST stay byte-identical twins, local git commit, NEVER git push):
1. Model on `~/Code/codecheck/tools/mc-registration/register_codecheck_tile.py` (newmac copy
   readable now): add a `gfy` tile to the frontend `P=[...]` array with `local:true`
   (excluded from PROD/deploy/promote paths structurally). No server.js REPOS entry.
2. Backlog transport: extend the existing 60s scp push (`~/mc-loop/tools/push-window-status.sh`
   pattern — or a small sibling script + launchd StartInterval 300) to drop
   `~/Code/gfy/BACKLOG.md` → `oldmac:build-logs/gfy-backlog.md`. GFY's BACKLOG is already in
   the pipe-table bold-title format mc-unified's STAT regex parses.
3. Narrative wiring: smallest honest option — a static fetch of `/window`-style file route for
   the dropped backlog (one server.js route addition ⇒ `node --check` + kickstart restart
   `com.orchestra.mc-unified`), or fold into the tile's detail panel. Decide at apply time
   against the live file; keep it Design-B-minimal.
4. Verify per S14: render the cockpit, tile present, backlog rows parsed, both html twins
   md5-equal, nothing else moved; then local git commit on oldmac's mc-unified.

Pre-existing findings surfaced by the same grounding (NOT gfy's to fix, logged in
~/.mc-ground/BACKLOG.md): crm absent from MCG_BACKLOGS + crm's bullet-format BACKLOG parses
in NEITHER system (doctrine S13 format vs mc-unified parser conflict — needs a format pin).
