# Handoff

State and next steps for the next session. Ticket keys are in the planning store.

## State

- Done and pushed to main (live on the workers.dev address the publish run prints): XMAS-25, 26, 27 (countdown on a plain sky), and XMAS-28 part 1 (object list, rough sheets, style rules, font split into its own module).
- XMAS-28 is claimed and still open. Part 2 is left: colour tables for Frosty morning, Sunset and Purple night, taken from the prototype THEMES (overrides of base hex keys, in `prototype/visual-direction/variant-b.js` lines 21-39, pal 0, 2, 4), plus a test that the colour numbers used by house, pines, snowman, presents, base and Santa are never overridden by any phase. Proposed shape: `phaseOverrides: Record<'frosty-morning'|'sunset'|'purple-night', Record<hex, hex>>` in art/colours.ts. Then close XMAS-28 with a comment.
- Next unblocked: XMAS-29 (screen reader text), XMAS-30 (contrast test and Dawn stand-in; note the straight-line ink mix fails 4.5:1 mid-blend).
- Open nits worth a ticket: cap for scene art once the scene imports art.generated.ts (tests/repo/rough-art.test.ts uses an invented 40000); FONT_SHEET hard-coded in tools/art.ts; speaker icons have no cone; present-3 at 3x3 barely reads; Santa's 31x6 is tight.
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
