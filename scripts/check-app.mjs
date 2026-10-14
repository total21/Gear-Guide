#!/usr/bin/env node
// Sanity checks for the web app (docs/) and the curated spec data.
//
// Usage: node scripts/check-app.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATS, SLOT_GROUPS, slotGroup, groupForSpec, usableBy, rankedPairs, dropAzeriteTwins, bisSlotGroup, statOrder, toggleStat, effectTags, trueBis, situationalBis } from "../docs/gear.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
const { items } = await read("data/items.json");
const { specs } = await read("data/specs.json");
const problems = [];
const tierIds = new Set((await read("data/tier.json")).sets.flatMap((x) => x.items.map((i) => i.id)));
const crafting = await read("data/crafting.json");
const embellishments = new Set(crafting.embellishments);
// BiS text slots group weapons as "weapon" (one- or two-hand isn't in the text).
const slotKeys = new Set([...SLOT_GROUPS.map(([k]) => k), "weapon"]);
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
  if (s.heroTalents?.length !== 2) fail(`${name(s)}: expected 2 hero talents, got ${s.heroTalents}`);
  for (const [h, p] of Object.entries(s.heroStatPriority ?? {})) {
    if (!s.heroTalents?.includes(h)) fail(`${name(s)}: heroStatPriority for unknown hero talent ${h}`);
    if (p.length !== 4 || p.some((x) => !STATS.includes(x)) || new Set(p).size !== 4) fail(`${name(s)}: bad ${h} priority ${p}`);
  }
  for (const h of Object.keys(s.bisByHero ?? {})) if (!s.heroTalents?.includes(h)) fail(`${name(s)}: bisByHero for unknown hero talent ${h}`);
  for (const list of [s.bis, ...Object.values(s.bisByHero ?? {})]) {
    if (list?.items?.length && !(list.source && list.url && list.date)) fail(`${name(s)}: BiS items without source/url/date`);
    for (const b of list?.items ?? []) {
      // id is null for pasted non-drop items the API data doesn't name (off-set
      // pieces, vendor or currency items).
      if (!(Number.isInteger(b.id) || b.id === null) || !b.name || !b.lists?.length) fail(`${name(s)}: BiS entry needs id, name and lists: ${JSON.stringify(b)}`);
      const hit = items.find((i) => i.id === b.id);
      if (b.tier && !b.offSet && !tierIds.has(b.id)) fail(`${name(s)}: tier piece ${b.name} (${b.id}) not in data/tier.json`);
      if (b.offSet && !b.catalyst) fail(`${name(s)}: off-set piece ${b.name} has no catalyst route`);
      for (const f of b.catalyst?.from ?? []) {
        const src = items.find((i) => i.id === f.id);
        if (!src || !usableBy(s, src)) fail(`${name(s)}: catalyst source ${f.name} for ${b.name} is not a usable Season drop`);
        else if (src.slot !== b.slot) fail(`${name(s)}: catalyst source ${f.name} is ${src.slot}, ${b.name} is ${b.slot}`);
      }
      if (b.crafted) {
        const r = crafting.recipes.find((x) => x.item?.id === b.id);
        if (!r || r.name !== b.name) fail(`${name(s)}: crafted ${b.name} (${b.id}) has no matching recipe`);
        for (const e of b.crafted.embellishments) if (!embellishments.has(e.name)) fail(`${name(s)}: ${e.name} on ${b.name} is not an embellishment`);
      }
      if (!hit && !slotKeys.has(bisSlotGroup(b.slot))) fail(`${name(s)}: BiS slot "${b.slot}" of ${b.name} maps to no slot filter`);
      if (!hit) continue; // crafted, tier, catalyst: not a Season drop
      if (hit.name !== b.name) fail(`${name(s)}: BiS item ${b.id} is ${hit.name}, not ${b.name}`);
      if (!usableBy(s, hit)) fail(`${name(s)}: BiS item ${b.name} is not usable by this spec`);
    }
  }
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

// Stat buttons follow the priority; the stat filter keeps items with every chosen stat.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (!same(statOrder(["Haste", "Mastery", "Critical Strike", "Versatility"]), ["Haste", "Mastery", "Critical Strike", "Versatility"])) fail("statOrder ignores the priority");
if (!same(statOrder(["Mastery"]), ["Mastery", "Critical Strike", "Haste", "Versatility"])) fail("statOrder drops unranked stats");
if (!same(toggleStat(["Haste", "Mastery"], "Versatility"), ["Mastery", "Versatility"]) || !same(toggleStat(["Haste"], "Haste"), [])) fail("toggleStat");
for (const s of specs) {
  const want = s.statPriority.slice(0, 2);
  for (const i of flat(groupForSpec(items, s, { stats: want })))
    if (!want.every((x) => i.secondaryStats.includes(x))) fail(`${name(s)}: stat filter kept ${i.name}`);
}

// Best in Slot as worn: one pick per slot, two rings and trinkets, one or two weapons.
for (const s of specs)
  for (const [h, list] of [["shared", s.bis], ...Object.entries(s.bisByHero ?? {})]) {
    if (!list?.items?.length) continue;
    const worn = trueBis(list.items, items);
    const by = Object.groupBy(worn, (b) => bisSlotGroup(b.slot));
    const hands = (by.weapon?.length ?? 0) + (by.offhand?.length ?? 0);
    if (worn.some((b) => b.addedBy)) fail(`${name(s)} (${h}): worn BiS includes a catalyst source`);
    if (hands < 1 || hands > 2) fail(`${name(s)} (${h}): worn BiS has ${hands} weapons`);
    for (const [k, v] of Object.entries(by)) if (v.length > (["ring", "trinket"].includes(k) ? 2 : k === "weapon" ? 2 : 1)) fail(`${name(s)} (${h}): ${v.length} ${k} picks`);
    if (worn.length < 15) fail(`${name(s)} (${h}): worn BiS has only ${worn.length} items`);
    // Worn plus situational is exactly the Overall list, without catalyst sources.
    const overall = list.items.filter((b) => !b.addedBy && (b.lists ?? ["Overall"]).includes("Overall"));
    if (worn.length + situationalBis(list.items, items).length !== overall.length) fail(`${name(s)} (${h}): worn + situational != Overall list`);
  }

// Weapon slot filters: each weapon and off-hand lands in exactly one of them.
for (const i of items.filter((i) => i.itemClass === "Weapon" || /Off/.test(i.slot))) {
  const k = slotGroup(i);
  const want = i.slot === "Two-Hand" || ["Bow", "Gun", "Crossbow"].includes(i.weaponType) ? "twohand"
    : i.itemClass === "Weapon" ? "onehand" : "offhand";
  if (k !== want) fail(`${i.name} (${i.slot} ${i.weaponType ?? ""}) filed under ${k}, want ${want}`);
}

// Every effect is labeled On use or Proc, except the raid's Deadly Venom reduction.
for (const i of items)
  for (const e of i.effects ?? [])
    if (!/Deadly Venom/.test(e.text) && !effectTags({ effects: [e] }).length) fail(`${i.name}: unlabeled effect ${e.text}`);

console.log(`${specs.length} specs, ${items.length} drops checked, ${problems.length} problem(s)`);
for (const p of problems) console.log("- " + p);
if (problems.length) process.exit(1);
