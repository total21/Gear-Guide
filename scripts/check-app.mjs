#!/usr/bin/env node
// Sanity checks for the web app (docs/) and the curated spec data.
//
// Usage: node scripts/check-app.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATS, groupForSpec, usableBy, rankedPairs, dropAzeriteTwins } from "../docs/gear.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
const { items } = await read("data/items.json");
const { specs } = await read("data/specs.json");
const problems = [];
const fail = (msg) => problems.push(msg);
const flat = (groups) => groups.flatMap((g) => g.bosses.flatMap((b) => b.items));
const name = (s) => `${s.spec} ${s.class}`;

// Curated stat data: valid, complete (or flagged partial), cited and dated.
for (const s of specs) {
  const lists = [s.statPriority, ...(s.statVariants ?? []).map((v) => v.priority)];
  for (const p of lists) {
    if (p.some((x) => !STATS.includes(x)) || new Set(p).size !== p.length) fail(`${name(s)}: bad stat priority ${p}`);
    if (p.length !== 4 && !/partial/i.test(s.statNotes ?? "")) fail(`${name(s)}: priority has ${p.length} stats and is not marked partial`);
  }
  if (!s.statSource?.url || !/^\d{4}-\d{2}-\d{2}$/.test(s.statSource?.checked ?? "")) fail(`${name(s)}: stat priority not cited/dated`);
  if (!s.weapons?.slots?.length) fail(`${name(s)}: no weapon slots`);
  if (s.bis?.items?.length && !(s.bis.source && s.bis.date)) fail(`${name(s)}: BiS items without source/date`);
}

// Equip rules.
for (const s of specs) {
  const seen = flat(groupForSpec(items, s, {}));
  for (const i of seen) {
    if (i.armorType && i.armorType !== s.armorType) fail(`${name(s)} sees ${i.armorType} ${i.name}`);
    if (i.primaryStats.length && !i.primaryStats.includes(s.primaryStat)) fail(`${name(s)} sees off-stat ${i.name}`);
  }
  const ranged = seen.filter((i) => ["Bow", "Gun", "Crossbow"].includes(i.weaponType));
  if (s.class !== "Hunter" && ranged.length) fail(`${name(s)} sees ranged weapon ${ranged[0].name}`);
  if (s.class === "Hunter" && s.spec !== "Survival" && seen.some((i) => i.itemClass === "Weapon" && !ranged.includes(i)))
    fail(`${name(s)} sees a melee weapon`);
  if (seen.some((i) => i.slot === "Off Hand") && !["Paladin|Holy", "Paladin|Protection", "Warrior|Protection", "Shaman|Elemental", "Shaman|Restoration"].includes(`${s.class}|${s.spec}`))
    fail(`${name(s)} sees a shield`);
}

// The rogue farm list in web/index.html must be a subset of what Outlaw sees
// under its own criteria (Mythic+, Leather/Neck/Ring, Crit/Haste or Crit/Mastery).
const html = await readFile(path.join(ROOT, "web/index.html"), "utf8");
const farm = JSON.parse(html.match(/const D=(\[[\s\S]*?\]);\s*const LBL/)[1]).flatMap(([, rows]) => rows.map((r) => r[0]));
const outlaw = specs.find((s) => s.class === "Rogue" && s.spec === "Outlaw");
const rogueNames = new Set(
  ["ch", "cm"].flatMap((pair) => flat(groupForSpec(items, outlaw, { source: "DUNGEON", pair })))
    .filter((i) => i.armorType === "Leather" || ["Neck", "Finger"].includes(i.slot))
    .map((i) => i.name),
);
for (const n of farm) if (!rogueNames.has(n)) fail(`Rogue farm-list item missing for Outlaw: ${n}`);

// Every gear drop should be usable by someone.
const unused = dropAzeriteTwins(items).filter((i) => !specs.some((s) => usableBy(s, i)));
for (const i of unused) fail(`No spec can use ${i.name} (${i.instance})`);

// Pair ranking puts the spec's top two stats first.
for (const s of specs.filter((s) => s.statPriority.length === 4)) {
  const top = rankedPairs(s.statPriority)[0].stats;
  if (top[0] !== s.statPriority[0] || top[1] !== s.statPriority[1]) fail(`${name(s)}: top pair ${top} != priority`);
}

console.log(`${specs.length} specs, ${items.length} drops checked, ${problems.length} problem(s)`);
for (const p of problems) console.log("- " + p);
if (problems.length) process.exit(1);
