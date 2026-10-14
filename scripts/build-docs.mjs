#!/usr/bin/env node
// Copies data/items.json, specs.json and tier.json into docs/data/ so the GitHub
// Pages site (served from /docs) can load them. Run after every data change;
// `npm run fetch` does this for you.
//
// Usage: node scripts/build-docs.mjs [--check]
//   --check  exit 1 if docs/data/ is out of date instead of writing.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const FILES = ["items.json", "specs.json", "tier.json"];

await mkdir(path.join(ROOT, "docs/data"), { recursive: true });
let stale = 0;
for (const f of FILES) {
  const src = await readFile(path.join(ROOT, "data", f), "utf8");
  const dest = path.join(ROOT, "docs/data", f);
  if (existsSync(dest) && (await readFile(dest, "utf8")) === src) continue;
  stale++;
  if (CHECK) console.error(`docs/data/${f} is out of date; run npm run build`);
  else {
    await writeFile(dest, src);
    console.log(`Wrote docs/data/${f}`);
  }
}
if (CHECK && stale) process.exit(1);
if (!stale) console.log("docs/data is up to date");
