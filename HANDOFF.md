# Handoff

State and next steps for the next session. Ticket keys are in the planning store.

## State

- Done and pushed to main (live on the workers.dev address the publish run prints): XMAS-25, 26, 27 (countdown on a plain sky), and XMAS-28 (object list, rough sheets, style rules, font split, `phaseOverrides` colour tables: prototype hex entries minus any colour the protected objects use, so those objects look the same in every phase).
- XMAS-29 done (hidden `#countdown-text`, polite `#countdown-announce`, `src/countdown/announce.ts`).
- XMAS-30 done: skyAndInk bridges the two frosty-morning blends (sky ramps to #5c617f, one step to #737da2 at share 0.4, ink swaps gold<->midnight there and midnight<->red near the ends); the dark blends stay linear. Next: check the Scene tickets in the planning store for the next unblocked one.
- Open nits worth a ticket: contrast.ts re-export clutter (merge with contrast-helper.ts); bridge edge colours hard-coded to the inks (recompute if the art pass changes an ink or sky); `phaseOverrides` key type is a hand-written union (use `Exclude<PhaseName,'dawn'>`); spot-check test in phase-overrides.test.ts can skip everything; cap for scene art once the scene imports art.generated.ts (tests/repo/rough-art.test.ts uses an invented 40000); FONT_SHEET hard-coded in tools/art.ts; speaker icons have no cone; present-3 at 3x3 barely reads; Santa's 31x6 is tight.
- Standing user rule: each deployable, e2e-testable state goes live on a real address; report the link.
- Pipeline reminders: test-writer (Opus) -> `ticket-impl` -> own `pnpm check` -> fresh reviewer -> commit. ticket-impl exits 3 when a session passes 150k: restart with a full brief.

## Review log

| Ticket | Round | Verdict | Findings |
| --- | --- | --- | --- |
| XMAS-26 | 1 | approve | nit x4 (O/0 and S/5 identical; PNG colour type 3 unsupported; size-error names first drawing; one generated module for all targets) |
| XMAS-27a | 1 | approve | nit x3 (linear ink mix fails contrast mid-blend, for the contrast ticket; art/ imports PhaseName type from src/shared; groups() comment on 3-digit days) |
| XMAS-27b | 1 | changes needed | test-gap x2 (blend colours untested; clock recompute/skew untested), nit x3 (PNG-name regex tied to generator format; canvas takes space with scripts off; canvas resized every draw) |
| XMAS-27b | 2 | changes needed | test-gap x2 (digits landing on the real whole second without ?now; timezone/DST change mid-page), nit x4 (marker absent builds silently; sheet regex no word boundary; DPR change without resize; only </script escaped) |
| XMAS-27b | 3 | approve | nit x2 (marker check has no unit test; `<!--` escape unsafe in a /u regex) |
| XMAS-28a | 1 | changes needed | spec x2 (countdown script inlines all scene art; Santa/snowman arms+scarf break the outline rule), test-gap x1 (outline rule untested), nit x3 (cap comment says build checks it; invented 40000 cap; weak pair-differs test) |
| XMAS-28a | 2 | approve | nit x4 (invented 40000 art cap until scene imports art; speaker icons lack a cone; 3x3 presents barely read; FONT_SHEET hard-coded in tools/art.ts) |
| XMAS-28b | 1 | approve | nit x2 (phaseOverrides key union not tied to PhaseName; spot-check test can pass vacuously) |
| XMAS-29 | 1 | approve | nit x3 (live region keeps the greeting after Christmas Day; "Less than a minute" wording not in ticket; spacing slip at announce.spec.ts:69) |
| XMAS-30 | 1 | changes needed | spec x1 (sky passes a mid-luminance band where no ink reaches 4.5:1; 110 s and 74 s per day between tenths), test-gap x1 (tenths-only sampling hides it), nit x2 (NaN share gives #NaNNaNNaN; test duplicates contrast helpers) |
| XMAS-30 | 2 | approve | nit x5 (contrast.ts is a one-line re-export of contrast-helper.ts; DARK_EDGE/LIGHT_EDGE tied to gold and midnight inks; duplicated WCAG maths in test; frosty "differs from both ends" check skipped; owner colour list) |
