#!/usr/bin/env node
// Tests for scripts/import-bis.mjs against the synthetic saved pages in
// scripts/fixtures/bis/ (hand-written to mimic each site, not real downloads).
//
// Usage: node scripts/check-import.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pageUrl, siteOf, specFromUrl, walk, wowheadMarkupToHtml, extractBis, toBisItems, versionOf, versionOk, specFromText, parsePasted } from "./import-bis.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { items } = JSON.parse(await readFile(path.join(ROOT, "data/items.json"), "utf8"));
const { specs } = JSON.parse(await readFile(path.join(ROOT, "data/specs.json"), "utf8"));
const problems = [];
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

async function parse(file) {
  const html = await readFile(path.join(ROOT, "scripts/fixtures/bis", file), "utf8");
  const url = pageUrl(html);
  const site = siteOf(url, html);
  const spec = specFromUrl(url, specs);
  const v = versionOf(html, url);
  const bis = toBisItems(extractBis(walk(html + "\n" + wowheadMarkupToHtml(html)), site), items);
  return { site, spec: spec && `${spec.spec} ${spec.class}`, version: versionOk(v, "12.1"), bis };
}
const brief = (bis) => bis.map((b) => [b.id, b.slot, b.lists.join("+")]);

let p = await parse("wowhead-outlaw.html");
eq("wowhead site/spec", [p.site, p.spec, p.version.ok], ["Wowhead", "Outlaw Rogue", true]);
eq("wowhead items", brief(p.bis), [
  [271875, "Head", "Overall"], [268265, "Neck", "Overall+Mythic+"], [251223, "Shoulders", "Overall"],
  [999001, "Chest", "Overall"], [270173, "Trinket", "Overall"], [251130, "Legs", "Mythic+"],
]);
eq("wowhead names", p.bis.map((b) => b.name).slice(0, 4), ["Gaze of the Coiled Watcher", "Aqirbane Reliquary", "Somber Spaulders", "Item 999001"]);

p = await parse("icy-veins-havoc.html");
eq("icy veins site/spec", [p.site, p.spec, p.version.ok], ["Icy Veins", "Havoc Demon Hunter", true]);
eq("icy veins items", brief(p.bis), [[273793, "Main Hand", "Overall"], [251132, "Back", "Overall"], [273792, "Ring #1", "Overall"], [268265, "Neck", "Raid"]]);

p = await parse("archon-blood.html");
eq("archon site/spec", [p.site, p.spec, p.version.ok], ["Archon", "Blood Death Knight", true]);
eq("archon items", brief(p.bis), [[273777, "Feet", "Overall"], [273776, "Legs", "Overall"]]);

p = await parse("stale-wowhead.html");
eq("stale page rejected", [p.spec, p.version.ok], ["Fury Warrior", false]);
p = await parse("ptr-archon.html");
eq("ptr page rejected", [p.version.ok, p.version.why], [false, "PTR/beta page"]);

// Pasted Wowhead table text, tab-separated and single-spaced.
async function pasted(file) {
  const text = await readFile(path.join(ROOT, "scripts/fixtures/bis", file), "utf8");
  const spec = specFromText(text, file, specs);
  const r = parsePasted(text, spec, items);
  return { spec: spec && `${spec.spec} ${spec.class}`, patch: r.patch, skipped: r.skipped, bis: toBisItems(r.entries, items) };
}
let t = await pasted("outlaw-rogue.txt");
eq("pasted tabs spec/patch", [t.spec, t.patch], ["Outlaw Rogue", "12.1.5"]);
eq("pasted tabs items", brief(t.bis), [
  [271875, "Head", "Overall"], [268265, "Neck", "Overall"], [251223, "Shoulders", "Overall"], [null, "Chest", "Overall"],
  [251130, "Legs", "Overall"], [251128, "Main Hand", "Overall"], [251180, "Off Hand", "Overall"], [273792, "Ring 1", "Overall"],
  [270173, "Trinket 1", "Overall"], [270175, "Trinket 2", "Overall"],
  [251135, "Wrist", "Mythic+"], [251124, "Hands", "Mythic+"], [159327, "Feet", "Mythic+"],
]);
eq("pasted non-drop name", t.bis.find((b) => b.id === null)?.name, "Chosen Bloodslayer's Vest");
eq("pasted nothing skipped", t.skipped, []);
t = await pasted("havoc-demon-hunter-spaced.txt");
eq("pasted spaces spec", t.spec, "Havoc Demon Hunter");
eq("pasted spaces items", brief(t.bis), [
  [251132, "Back", "Overall"], [273792, "Ring", "Overall"], [273793, "Main Hand", "Overall"], [null, "Head", "Overall"],
  [273791, "Chest", "Overall"], [268265, "Neck", "Raid"],
]);
eq("pasted unusable item skipped", t.skipped.length, 1);
eq("spec from file name", specFromText("Head\tGaze of the Coiled Watcher", "bis-pages/frost-mage.txt", specs)?.id, 64);
eq("spec from id file name", specFromText("", "260.txt", specs)?.id, 260);

// A real Wowhead paste (Blood Deathbringer, 2026-10-13): doubled names,
// a crafting reagent in the Slot column, tier pieces, a Hero line.
{
  const text = await readFile(path.join(ROOT, "scripts/fixtures/bis/blood-death-knight-deathbringer.txt"), "utf8");
  const spec = specFromText(text, "x.txt", specs);
  const r = parsePasted(text, spec, items);
  const bis = toBisItems(r.entries, items);
  eq("real paste spec/hero", [spec?.id, r.hero], [250, "Deathbringer"]);
  eq("real paste drops", bis.filter((b) => b.id).map((b) => b.id),
    [268213, 268265, 268253, 268259, 271878, 273777, 281029, 251194, 270175, 270173]);
  eq("real paste non-drops", bis.filter((b) => !b.id).map((b) => [b.slot, b.name, b.source, b.crafting ?? null]), [
    ["Head", "Baleful Grave-Knight's Casque", "Kith'ix", null],
    ["Shoulders", "Baleful Grave-Knight's Gibbets", "Temple of Sethraliss", null],
    ["Chest", "Baleful Grave-Knight's Breastplate", "The Coiled Altar", null],
    ["Wrist", "Spellbreaker's Bracers", "Crafting", null],
    ["Gloves", "Baleful Grave-Knight's Deathgrips", "King's Rest", null],
    ["Ring", "Masterwork Sin'dorei Band", "Crafting", ["Prismatic Focusing Iris"]],
  ]);
  eq("real paste skipped", r.skipped, []);
}

// Spec slugs resolve for every spec on every site.
for (const s of specs) {
  const c = s.class.toLowerCase().replace(/ /g, "-"), n = s.spec.toLowerCase().replace(/ /g, "-");
  for (const url of [
    `https://www.wowhead.com/guide/classes/${c}/${n}/bis-gear`,
    `https://www.icy-veins.com/wow/${n}-${c}-pve-dps-gear-best-in-slot`,
    `https://www.archon.gg/wow/builds/${n}/${c}/raid/gear-and-tier-set/mythic/all-bosses`,
  ]) if (specFromUrl(url, specs)?.id !== s.id) problems.push(`spec not resolved from ${url}`);
}

console.log(`import-bis: ${problems.length} problem(s)`);
for (const x of problems) console.log("- " + x);
if (problems.length) process.exit(1);
