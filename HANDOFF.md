# Handoff

State and next steps for the next session. Ticket keys are in the planning store.

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
