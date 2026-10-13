#!/usr/bin/env node
// Tests for scripts/import-bis.mjs against the synthetic saved pages in
// scripts/fixtures/bis/ (hand-written to mimic each site, not real downloads).
//
// Usage: node scripts/check-import.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pageUrl, siteOf, specFromUrl, walk, wowheadMarkupToHtml, extractBis, toBisItems, versionOf, versionOk } from "./import-bis.mjs";

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
