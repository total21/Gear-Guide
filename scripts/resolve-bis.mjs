#!/usr/bin/env node
// Links each spec's BiS tier pieces to where they come from, using
// data/tier.json (class sets and raid tokens, from the Blizzard API):
//   - tier: the set and the piece's real slot and item ID;
//   - token: the raid token for that slot and class, plus the any-slot curio;
//   - catalyst: the Season drop(s) to convert, when the BiS source names a
//     dungeon or boss (or says "Catalyst"). Those drops are added to the BiS
//     list with the note "Catalyze into <tier piece>" so they get the badge.
// Runs after every import (import-bis.mjs) and on its own:
//
// Usage: node scripts/resolve-bis.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { usableBy, dropAzeriteTwins } from "../docs/gear.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const norm = (s) => s.toLowerCase().replace(/[‘’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const noThe = (s) => norm(s).replace(/^the /, "");

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Bosses and dungeons/raids a free-text source names. Pasted sources have
// typos ("The Coiled Alter", "Entomed Sentinels", "Kithix") and nicknames
// (config "bossAliases"), so after exact matches it tries the first long word
// of each name with one typo allowed.
export function locationsIn(source, items, aliases = {}) {
  const src = ` ${norm(source ?? "")} `;
  const words = src.trim().split(" ");
  const instances = [...new Set(items.map((i) => i.instance))];
  const bosses = [...new Set(items.map((i) => i.boss))];
  const has = (name) => src.includes(` ${noThe(name)} `);
  // Words of a name (5+ letters) found in the source, one typo allowed.
  const hits = (name) => noThe(name).split(" ").filter((w) => w.length >= 5 && words.some((x) => x.length >= 5 && lev(x, w) <= 1)).length;
  const best = (names) => {
    const top = Math.max(0, ...names.map(hits));
    return top ? names.filter((n) => hits(n) === top) : [];
  };
  const aliased = Object.entries(aliases).filter(([k]) => has(k)).map(([, v]) => v);
  if (aliased.length) return { bosses: aliased, instances: [] };
  let inst = instances.filter(has), boss = bosses.filter(has);
  if (inst.length) return { bosses: [], instances: inst };
  if (boss.length) return { bosses: boss, instances: [] };
  inst = best(instances);
  boss = best(bosses);
  if (boss.length) return { bosses: boss, instances: [] };
  return { bosses: [], instances: inst };
}

const SLOT_WORD = { head: "Head", helm: "Head", shoulder: "Shoulder", shoulders: "Shoulder", chest: "Chest", hands: "Hands", gloves: "Hands", legs: "Legs" };

export function resolveSpec(spec, items, tier, aliases = {}) {
  const set = tier.sets.find((s) => s.classes.includes(spec.class));
  const pieces = new Map((set?.items ?? []).map((p) => [norm(p.name), p]));
  const drops = dropAzeriteTwins(items).filter((i) => usableBy(spec, i));
  const byName = new Map(drops.map((i) => [norm(i.name), i]));
  const report = [];
  const lists = [["shared", spec.bis], ...Object.entries(spec.bisByHero ?? {})];
  for (const [label, list] of lists) {
    if (!list?.items?.length) continue;
    // Start from the imported entries; catalyst badges are recomputed below.
    list.items = list.items.filter((b) => !b.addedBy);
    const added = [];
    for (const b of list.items) {
      const piece = pieces.get(norm(b.name));
      if (!piece) continue;
      const pasted = SLOT_WORD[norm(b.slot ?? "")];
      if (pasted && pasted !== piece.slot) report.push(`${spec.spec} ${spec.class} (${label}): ${b.name} pasted as ${b.slot}, API says ${piece.slot}`);
      b.id = piece.id;
      b.slot = piece.slot;
      b.tier = set.name;
      const token = tier.tokens.find((t) => t.slot === piece.slot && t.classes?.includes(spec.class));
      const curio = tier.tokens.find((t) => !t.slot);
      b.token = token ? { name: token.name, id: token.id, boss: token.boss } : null;
      b.curio = curio ? { name: curio.name, id: curio.id, boss: curio.boss } : null;
      // Catalyst source: named explicitly, or a location in the BiS source
      // that isn't just the token's boss, or the word "Catalyst".
      const from = b.catalyzedFrom ?? b.catalyst?.named ?? null;
      const loc = locationsIn(b.source, items, aliases);
      const says = /catal/i.test(b.source ?? "");
      const onlyTokenBoss = !says && !loc.instances.length && loc.bosses.length && loc.bosses.every((x) => x === token?.boss);
      let cands = [];
      if (from) cands = [byName.get(norm(from))].filter(Boolean);
      else if ((loc.bosses.length || loc.instances.length) && !onlyTokenBoss)
        cands = drops.filter((i) => i.slot === piece.slot && i.armorType === spec.armorType &&
          (loc.bosses.includes(i.boss) || loc.instances.includes(i.instance)));
      delete b.catalyzedFrom;
      if (cands.length || from || says) {
        b.catalyst = {
          ...(from && { named: from }),
          from: cands.map((i) => ({ id: i.id, name: i.name, boss: i.boss, instance: i.instance })),
          ...(!cands.length && { any: `${spec.armorType} ${piece.slot}` }),
        };
      } else delete b.catalyst;
      for (const i of cands)
        if (!list.items.some((x) => x.id === i.id) && !added.some((x) => x.id === i.id))
          added.push({ slot: i.slot, name: i.name, id: i.id, lists: b.lists, note: `Catalyze into ${piece.name}`, addedBy: "catalyst" });
    }
    list.items.push(...added);
  }
  return report;
}

async function main() {
  const read = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
  const specsData = await read("data/specs.json");
  const { items } = await read("data/items.json");
  const tier = await read("data/tier.json");
  const { bossAliases } = await read("config/season.json");
  const report = specsData.specs.flatMap((s) => resolveSpec(s, items, tier, bossAliases));
  await writeFile(path.join(ROOT, "data/specs.json"), JSON.stringify(specsData, null, 2) + "\n");
  let tiers = 0, cats = 0, any = 0;
  for (const s of specsData.specs)
    for (const l of [s.bis, ...Object.values(s.bisByHero ?? {})])
      for (const b of l?.items ?? []) { if (b.tier) tiers++; if (b.catalyst?.from?.length) cats++; if (b.catalyst?.any) any++; }
  console.log(`Resolved ${tiers} tier pieces: ${cats} with a catalyst source drop, ${any} "any drop" catalyst, the rest raid token only.`);
  for (const r of report) console.log("  slot: " + r);
  execFileSync(process.execPath, [path.join(ROOT, "scripts/build-docs.mjs")], { stdio: "inherit" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
