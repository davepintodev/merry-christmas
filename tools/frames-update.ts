// XMAS-31a "Scene core engine and reference pictures": the deliberate update
// command. Usage: node tools/frames-update.ts [dir] (default tests/frames).
// Writes every reference picture; nothing in `pnpm check` runs it.
import { updateReferences } from './frames.ts';

const dir = process.argv[2] ?? 'tests/frames';
for (const file of updateReferences(dir)) console.log(file);
