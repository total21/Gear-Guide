#!/usr/bin/env node
// Links each spec's BiS tier pieces to where they come from, using
// data/tier.json (class sets and raid tokens, from the Blizzard API):
//   - tier: the set and the piece's real slot and item ID;
//   - token: the raid token for that slot and class, plus the any-slot curio;
//   - catalyst: the Season drop(s) to convert, when the BiS source names a
//     dungeon or boss (or says "Catalyst"). Those drops are added to the BiS
//     list with the note "Catalyze into <tier piece>" so they get the badge.
//   - off-set pieces (wrist, waist... named like the set, e.g. "Damned
//     Necrolyte's Shackles"): catalyst only, no token.
//   - crafted: the recipe (data/crafting.json) with its profession, reagents,
//     optional slots, and which pasted reagents are embellishments.
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

const SLOT_WORD = {
  head: "Head", helm: "Head", shoulder: "Shoulder", shoulders: "Shoulder", chest: "Chest", hands: "Hands", gloves: "Hands", legs: "Legs",
  wrist: "Wrist", wrists: "Wrist", bracers: "Wrist", waist: "Waist", belt: "Waist", feet: "Feet", boots: "Feet", back: "Back", cloak: "Back",
};
// Reagent slots every crafted item has that need no choice worth showing.
const ROUTINE_SLOTS = new Set(["Artisan's Authenticity"]);

// The crafting recipe for a BiS item name, if any.
const recipeFor = (crafting, name) => crafting?.recipes.find((r) => r.item && norm(r.name) === norm(name)) ?? null;

export function resolveSpec(spec, items, tier, aliases = {}, crafting = null) {
  const set = tier.sets.find((s) => s.classes.includes(spec.class));
  const pieces = new Map((set?.items ?? []).map((p) => [norm(p.name), p]));
  // Off-set pieces share the set's name stem: "Damned Necrolyte's Shattered
  // Restraints" -> "damned necrolyte".
  const stem = set ? norm(set.name.split(/['’]s /)[0]) : null;
  const dropIds = new Set(items.map((i) => i.id));
  const drops = dropAzeriteTwins(items).filter((i) => usableBy(spec, i));
  const byName = new Map(drops.map((i) => [norm(i.name), i]));
  const embellishments = new Set((crafting?.embellishments ?? []).map(norm));
  const report = [];

  // Catalyst source for a set piece in `slot`: named explicitly, or a location
  // in the BiS source that isn't just the token's boss, or the word "Catalyst".
  // Returns the source drops (added to the list so they get the BiS badge).
  function catalyst(b, slot, tokenBoss, always) {
    const from = b.catalyzedFrom ?? b.catalyst?.named ?? null;
    const loc = locationsIn(b.source, items, aliases);
    // "Tier Set" with no place means the catalyst too (any drop in that slot).
    const says = always || /catal/i.test(b.source ?? "") || /^\s*tier set\s*$/i.test(b.source ?? "");
    const onlyTokenBoss = !says && !loc.instances.length && loc.bosses.length && loc.bosses.every((x) => x === tokenBoss);
    let cands = [];
    if (from) cands = [byName.get(norm(from))].filter(Boolean);
    else if ((loc.bosses.length || loc.instances.length) && !onlyTokenBoss)
      cands = drops.filter((i) => i.slot === slot && (!i.armorType || i.armorType === spec.armorType) &&
        (loc.bosses.includes(i.boss) || loc.instances.includes(i.instance)));
    delete b.catalyzedFrom;
    if (cands.length || from || says) {
      b.catalyst = {
        ...(from && { named: from }),
        from: cands.map((i) => ({ id: i.id, name: i.name, boss: i.boss, instance: i.instance })),
        ...(!cands.length && { any: slot === "Back" ? "Back" : `${spec.armorType} ${slot}` }),
      };
    } else delete b.catalyst;
    return cands;
  }

  const lists = [["shared", spec.bis], ...Object.entries(spec.bisByHero ?? {})];
  for (const [label, list] of lists) {
    if (!list?.items?.length) continue;
    // Start from the imported entries; catalyst badges are recomputed below.
    list.items = list.items.filter((b) => !b.addedBy);
    const added = [];
    const addSources = (cands, b, into) => {
      for (const i of cands)
        if (!list.items.some((x) => x.id === i.id) && !added.some((x) => x.id === i.id))
          added.push({ slot: i.slot, name: i.name, id: i.id, lists: b.lists, note: `Catalyze into ${into}`, addedBy: "catalyst" });
    };
    for (const b of list.items) {
      const piece = pieces.get(norm(b.name));
      if (piece) {
        const pasted = SLOT_WORD[norm(b.slot ?? "")];
        if (pasted && pasted !== piece.slot) report.push(`${spec.spec} ${spec.class} (${label}): ${b.name} pasted as ${b.slot}, API says ${piece.slot}`);
        b.id = piece.id;
        b.slot = piece.slot;
        b.tier = set.name;
        const token = tier.tokens.find((t) => t.slot === piece.slot && t.classes?.includes(spec.class));
        const curio = tier.tokens.find((t) => !t.slot);
        b.token = token ? { name: token.name, id: token.id, boss: token.boss } : null;
        b.curio = curio ? { name: curio.name, id: curio.id, boss: curio.boss } : null;
        addSources(catalyst(b, piece.slot, token?.boss, false), b, piece.name);
        continue;
      }
      if (b.id != null && dropIds.has(b.id)) continue;
      const recipe = recipeFor(crafting, b.name);
      if (recipe) {
        b.id = recipe.item.id;
        // Pasted reagents ("crafted with Arcanoweave Lining"): embellishments vs the rest.
        const picks = (b.crafting ?? []).flatMap((c) => c.split(/\s*(?:,|\+|&|\band\b)\s*/)).map((c) => c.replace(/^(crafted |embellished )?(with|using)\s+/i, "").trim()).filter(Boolean);
        const madeBy = (name) => crafting.recipes.find((r) => norm(r.name) === norm(name))?.profession ?? null;
        b.crafted = {
          profession: recipe.profession,
          category: recipe.category,
          reagents: recipe.reagents,
          optional: recipe.slots.filter((x) => !ROUTINE_SLOTS.has(x) && x !== "Add Embellishment" && x !== "Customize Secondary Stats"),
          embellishable: recipe.slots.includes("Add Embellishment"),
          customStats: recipe.slots.includes("Customize Secondary Stats"),
          builtIn: recipe.item.effects,
          embellishments: picks.filter((x) => embellishments.has(norm(x))).map((name) => ({ name, profession: madeBy(name) })),
          otherReagents: picks.filter((x) => !embellishments.has(norm(x))).map((name) => ({ name, profession: madeBy(name) })),
        };
        continue;
      }
      delete b.crafted;
      // Off-set piece: catalyst only (no raid token for these slots).
      const slot = SLOT_WORD[norm(b.slot ?? "")];
      if (stem && slot && norm(b.name).includes(stem)) {
        b.slot = slot;
        b.tier = set.name;
        b.offSet = true;
        addSources(catalyst(b, slot, null, true), b, b.name);
      }
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
  const crafting = await read("data/crafting.json");
  const { bossAliases } = await read("config/season.json");
  const report = specsData.specs.flatMap((s) => resolveSpec(s, items, tier, bossAliases, crafting));
  await writeFile(path.join(ROOT, "data/specs.json"), JSON.stringify(specsData, null, 2) + "\n");
  let tiers = 0, cats = 0, any = 0, crafted = 0;
  for (const s of specsData.specs)
    for (const l of [s.bis, ...Object.values(s.bisByHero ?? {})])
      for (const b of l?.items ?? []) { if (b.tier) tiers++; if (b.catalyst?.from?.length) cats++; if (b.catalyst?.any) any++; if (b.crafted) crafted++; }
  console.log(`Resolved ${tiers} tier pieces: ${cats} with a catalyst source drop, ${any} "any drop" catalyst, the rest raid token only. ${crafted} crafted items.`);
  for (const r of report) console.log("  slot: " + r);
  execFileSync(process.execPath, [path.join(ROOT, "scripts/build-docs.mjs")], { stdio: "inherit" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
