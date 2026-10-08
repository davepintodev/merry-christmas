// XMAS-24 "Cap script: download caps checked after every build": the CLI.
// Usage: node tools/check-caps.ts [dir] (default: dist). Prints the table on
// stdout, names each passed cap on stderr in cap order, and exits 1 if the
// build left no index.html or if any cap failed.
import { evaluateCaps, failures, formatTable } from './caps.ts';
import { measureDir } from './measure.ts';

const dir = process.argv[2] ?? 'dist';
const sizes = measureDir(dir);

if (!sizes.some((size) => size.file === 'index.html')) {
  console.error(`index.html not found in ${dir}`);
  process.exitCode = 1;
} else {
  const results = evaluateCaps(sizes);
  console.log(formatTable(results));

  const exceeded = failures(results);
  for (const result of exceeded) console.error(`Cap exceeded: ${result.name}`);
  if (exceeded.length > 0) process.exitCode = 1;
}
