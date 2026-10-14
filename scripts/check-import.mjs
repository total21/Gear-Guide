#!/usr/bin/env node
// Tests for scripts/import-bis.mjs against the synthetic saved pages in
// scripts/fixtures/bis/ (hand-written to mimic each site, not real downloads).
//
// Usage: node scripts/check-import.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pageUrl, siteOf, specFromUrl, walk, wowheadMarkupToHtml, extractBis, toBisItems, versionOf, versionOk, specFromText, parsePasted } from "./import-bis.mjs";
import { resolveSpec } from "./resolve-bis.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { items } = JSON.parse(await readFile(path.join(ROOT, "data/items.json"), "utf8"));
const { specs } = JSON.parse(await readFile(path.join(ROOT, "data/specs.json"), "utf8"));
const tier = JSON.parse(await readFile(path.join(ROOT, "data/tier.json"), "utf8"));
const { bossAliases } = JSON.parse(await readFile(path.join(ROOT, "config/season.json"), "utf8"));
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

// Parentheses on a drop's slot are a usage note, not crafting.
{
  const spec = specs.find((x) => x.id === 581);
  const r = parsePasted("Trinket (Raw Damage)\tZul'jin's Guillotine Technique Zul'jin's Guillotine Technique\tThe Coiled Altar", spec, items);
  eq("drop slot note", r.entries.map((e) => [e.id, e.slot, e.note ?? null, e.crafting ?? null]), [[270173, "Trinket", "Raw Damage", null]]);
}

// Reagents written as "<item> <item> crafted with <reagent> <reagent>".
{
  const spec = specs.find((x) => x.id === 1480);
  const r = parsePasted("Wrist\tSilvermoon Agent's Deflectors Silvermoon Agent's Deflectors crafted with Arcanoweave Lining Arcanoweave Lining \tCrafting/Misc", spec, items);
  eq("crafted with", r.entries.map((e) => [e.name, e.crafting, e.source]), [["Silvermoon Agent's Deflectors", ["Arcanoweave Lining"], "Crafting/Misc"]]);
}

// "<tier> (Catalyzed from <drop>)": the parser keeps the tier piece and its
// named source; resolve-bis.mjs then links and badges the source drop.
{
  const spec = structuredClone(specs.find((x) => x.id === 255));
  const r = parsePasted("Head\tSkulking Viper's Weeping Fangs Skulking Viper's Weeping Fangs (Catalyzed from Sethraliss' Fanged Helm Sethraliss' Fanged Helm)\tTier Set|Temple of Sethraliss", spec, items);
  eq("catalyst parse", r.entries.map((e) => [e.id, e.name, e.catalyzedFrom ?? null, e.source ?? null]), [
    [null, "Skulking Viper's Weeping Fangs", "Sethraliss' Fanged Helm", "Tier Set · Temple of Sethraliss"],
  ]);
  spec.bis = { items: toBisItems(r.entries, items) };
  resolveSpec(spec, items, tier, bossAliases);
  const [t, d] = spec.bis.items;
  eq("catalyst tier", [t.id, t.slot, t.tier, t.catalyst.from.map((f) => f.id), t.token?.name], [271492, "Head", "Skulking Viper's Ambush", [239035], "Venomcast Effigy"]);
  eq("catalyst badge", [d?.id, d?.note, d?.addedBy], [239035, "Catalyze into Skulking Viper's Weeping Fangs", "catalyst"]);
}

// Tier sources from Wowhead's Source column: "Catalyst the <boss> <slot>" names
// the drop to convert; the token boss alone means the raid token; "Catalyst"
// with no place means any drop in that slot.
{
  const run = (specId, line) => {
    const spec = structuredClone(specs.find((x) => x.id === specId));
    spec.bis = { items: toBisItems(parsePasted(line, spec, items).entries, items) };
    resolveSpec(spec, items, tier, bossAliases);
    const b = spec.bis.items[0];
    return [b.slot, b.catalyst?.from?.map((f) => f.name) ?? null, b.catalyst?.any ?? null, b.token?.boss ?? null];
  };
  eq("catalyst from boss", run(254, "Head\tSkulking Viper's Weeping Fangs Skulking Viper's Weeping Fangs \tCatalyst the Nek'zali the Soulcoiler Head"),
    ["Head", ["Crown of the Eternal Fang"], null, "The Twin Fangs"]);
  eq("token boss only", run(65, "Gloves\tGauntlets of the Consecrated Flame Gauntlets of the Consecrated Flame \tEntombed Sentinels"),
    ["Hands", null, null, "Entombed Sentinels"]);
  eq("catalyst any", run(268, "Head\tMonkey King's Unyielding Visage Monkey King's Unyielding Visage \tCatalyst|Mythic+|Vault"),
    ["Head", [], "Leather Head", "The Twin Fangs"]);
  eq("catalyst from dungeon", run(65, "Shoulders\tPauldrons of the Consecrated Flame Pauldrons of the Consecrated Flame \tMurder Row"),
    ["Shoulder", ["Cinderfury Shoulderguards"], null, "The Lost Explorers"]);
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
