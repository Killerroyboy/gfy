# GFY §23 Copy-Integrity Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five copy/coverage debts the §21/§22 reviews banked — per spec §23, verbatim pins there.

**Architecture:** One implementation task (all five items are 1–6 line changes with two new byte-asserted tests), one verification-lite close (renders of the two changed visual states).

**Tech Stack:** index.html, README.md, spec file, test/smoke.mjs (baseline 213/213), CDP renders.

## Global Constraints (spec §23 — every task inherits)

- Worktree isolation off `v2.1-invites` (controller creates `.worktrees/copy-bundle`, branch `copy-bundle`). Commit there; NEVER push.
- Unfrozen, exactly: `renderCalcutta` (the `#payBody` empty-state branch only), `calcuttaModel` (ONE flag line beside the existing unassigned gate at index.html:~2116 — zero math change), README.md, the spec's §20 annotation line, test/smoke.mjs. Everything else frozen (diff-verify before committing). STOP → BLOCKED if more seems needed.
- All five copy strings verbatim per §23 (em-dashes/quotes exact). Suite 213 → exactly **215** (X45/X46 new; X40 edited in place). RED before GREEN where meaningful (GREEN-on-write pins declared honestly + mutation-proven). Mutations ONLY in throwaway /tmp copies (copy real files — the symlink no-op trap is documented in the §22 task-1 report). Mutation bar per §23.
- Commit on branch copy-bundle; stage only the four named files; NEVER push; never touch any git stash.

## File structure
- `index.html` — renderCalcutta empty-state branch (~2548-2556 area); calcuttaModel flag line (~2116).
- `README.md` — three edits per README-3.
- `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` — the §20 annotation ONLY.
- `test/smoke.mjs` — X45/X46 after X44; X40 edit in place.

### Task 1: All five items (X45/X46; X40 edit)

- [ ] **Step 1 (RED where meaningful):** X45 — no-LOTS dom (empty calcutta fixture → the `!lots.length` early-out) asserts `#payBody` byte-reads the bids line; no-CARDS dom (lots present, header-only scores) asserts the cards line byte-exact. Today the no-cards branch renders the bids line → X45 direction-2 RED. X46 — synthetic ownerless+collected lot fixture (X41's shape) asserts the new flag string present in `#healthStrip`; three negative doms (normal, unsold-uncollected, all-sold) assert it absent. RED (flag doesn't exist). X40 edit: `===` upgrade.
- [ ] **Step 2: Implement** per §23's verbatim pins. **Step 3: GREEN** — 215/215; X41/X44/G/V untouched-green. **Step 4: Mutations** (throwaway copies): empty-state split revert → X45 alone; flag removal → X46 alone. **Step 5: Frozen-surface diff check.** **Step 6: Commit** `fix(copy): empty-state split, ownerless-collected flag, §20 supersession note, README trio, X40 byte-assert (§23; X45/X46)`

### Task 2: Verification-lite close (report-first)

- [ ] Battery (215/215 verbatim); CDP renders of: (a) no-cards calcutta — cards line + "Bids locked." basis now coherent; (b) corner state — cards line + corner basis; (c) ownerless+collected fixture — new flag visible in expanded chip; (d) control. LOOK cold; PNGs to the plan workspace s11/; report; no commit if clean.

## Plan self-review
- Coverage: C-EMPTY-SPLIT→T1/X45 both branches; C-OWNERLESS-COLLECTED→T1/X46 four doms; SPEC-SUPERSEDE→T1 (annotation only); README-3→T1 (three edits); X40-BYTE→T1. Placeholders: none — strings live in §23. Types: selectors/fixture idioms all established (X41/X44/B2).
