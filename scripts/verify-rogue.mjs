#!/usr/bin/env node
// Cross-checks data/items.json against the hand-made rogue farm list embedded
// in web/index.html (the `const D=[...]` block). Criteria taken from that page:
// Mythic+ dungeons only, Agility, Leather / Neck / Ring, Crit+Haste or Crit+Mastery.
//
// Usage: node scripts/verify-rogue.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { items } = JSON.parse(await readFile(path.join(ROOT, "data/items.json"), "utf8"));
const html = await readFile(path.join(ROOT, "web/index.html"), "utf8");

const literal = html.match(/const D=(\[[\s\S]*?\]);\s*const LBL/)[1];
const farm = JSON.parse(literal);
const PAIR = { ch: "Critical Strike/Haste", cm: "Critical Strike/Mastery" };

const expected = farm.flatMap(([instance, rows]) =>
  rows.map(([name, type, boss, pair]) => ({ instance, name, type, boss, pair: PAIR[pair] })),
);

const pairOf = (i) => [...i.secondaryStats].sort().join("/");
const qualifies = (i) =>
  i.instanceType === "DUNGEON" &&
  (i.armorType === "Leather" || ["Neck", "Finger"].includes(i.slot)) &&
  (i.primaryStats.length === 0 || i.primaryStats.includes("Agility")) &&
  Object.values(PAIR).includes(pairOf(i));

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const issues = [];

for (const e of expected) {
  const hits = items.filter((i) => norm(i.name) === norm(e.name));
  if (!hits.length) {
    issues.push(`NOT IN API DATA: ${e.name} (${e.instance})`);
    continue;
  }
  const inInstance = hits.filter((i) => i.instance === e.instance);
  if (!inInstance.length) {
    issues.push(`WRONG INSTANCE: ${e.name} listed under ${e.instance}, API has ${[...new Set(hits.map((h) => h.instance))].join(", ")}`);
    continue;
  }
  const i = inInstance[0];
  const bosses = inInstance.map((h) => h.boss);
  if (!bosses.some((b) => norm(b).includes(norm(e.boss)) || norm(e.boss).includes(norm(b))))
    issues.push(`BOSS: ${e.name} listed as ${e.boss}, API has ${bosses.join(" / ")}`);
  const slot = e.type.split(" · ")[1] ?? e.type;
  const apiSlot = i.slot === "Finger" ? "Ring" : i.slot;
  if (!["socket"].includes(slot) && norm(slot) !== norm(apiSlot) && !(e.type.startsWith("Ring") && apiSlot === "Ring"))
    issues.push(`SLOT: ${e.name} listed as ${e.type}, API has ${i.armorType ?? ""} ${i.slot}`);
  if (e.type.startsWith("Leather") && i.armorType !== "Leather")
    issues.push(`ARMOR: ${e.name} listed as Leather, API has ${i.armorType ?? i.itemClass}`);
  if (!i.secondaryStats.length) issues.push(`UNVERIFIABLE STATS: ${e.name} listed as ${e.pair}, API has no secondaries (${i.notes.join(", ") || "none"})`);
  else if (pairOf(i) !== e.pair) issues.push(`STATS: ${e.name} listed as ${e.pair}, API has ${pairOf(i)}`);
}

const listed = new Set(expected.map((e) => norm(e.name)));
const missing = new Map();
for (const i of items.filter(qualifies)) if (!listed.has(norm(i.name))) missing.set(i.id, i);
for (const i of missing.values())
  issues.push(`MISSING FROM LIST: ${i.name} (${i.instance}, ${i.boss}) ${i.armorType ?? ""} ${i.slot}, ${pairOf(i)}`);

console.log(`${expected.length} farm-list items checked, ${issues.length} issue(s)\n`);
for (const line of issues) console.log("- " + line);
