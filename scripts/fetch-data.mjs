#!/usr/bin/env node
// Pulls Season loot from the Blizzard Game Data API (Journal endpoints) and
// writes data/items.json. Also (re)builds data/specs.json, preserving any
// stat priority / BiS data already filled in.
//
// Usage: node scripts/fetch-data.mjs [--season config/season.json] [--specs-only]
//
// Auth: if BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are set they are sent
// as Basic auth to the token endpoint. Otherwise the request is sent without
// credentials (for environments where a proxy injects them).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const SEASON_FILE = path.resolve(ROOT, argVal("--season", "config/season.json"));
const SPECS_ONLY = args.includes("--specs-only");

const season = JSON.parse(await readFile(SEASON_FILE, "utf8"));
const REGION = season.region ?? "us";
const LOCALE = season.locale ?? "en_US";
const API = `https://${REGION}.api.blizzard.com`;
const NS = `static-${REGION}`;

const PRIMARY = { STRENGTH: "Strength", AGILITY: "Agility", INTELLECT: "Intellect" };
const SECONDARY = {
  CRIT_RATING: "Critical Strike",
  HASTE_RATING: "Haste",
  MASTERY_RATING: "Mastery",
  VERSATILITY: "Versatility",
};
const ARMOR_TYPES = new Set(["Cloth", "Leather", "Mail", "Plate"]);
// Armor type is a class property; the API does not expose it on the spec.
const CLASS_ARMOR = {
  Warrior: "Plate", Paladin: "Plate", "Death Knight": "Plate",
  Hunter: "Mail", Shaman: "Mail", Evoker: "Mail",
  Rogue: "Leather", Druid: "Leather", Monk: "Leather", "Demon Hunter": "Leather",
  Priest: "Cloth", Mage: "Cloth", Warlock: "Cloth",
};

// Weapons and off-hands each spec can equip and actually uses, also not in the
// API. Slots match item inventory types: "Off Hand" is a shield, "Held In
// Off-hand" a caster off-hand, "Ranged" covers bows, guns, crossbows and wands.
const ONE_H = ["One-Hand", "Main Hand"];
const TWO_H = ["Two-Hand"];
const SHIELD = ["Off Hand"];
const FRILL = ["Held In Off-hand"];
const RANGED = ["Ranged"];
const weapons = (slots, types) => ({ slots: slots.flat(), types });
const CASTER_DRUID = weapons([TWO_H, ONE_H, FRILL], ["Staff", "Polearm", "Mace", "Dagger", "Fist Weapon"]);
const EVOKER = weapons([TWO_H, ONE_H, FRILL], ["Axe", "Mace", "Sword", "Dagger", "Fist Weapon", "Staff"]);
const MAGE_LOCK = weapons([TWO_H, ONE_H, FRILL, RANGED], ["Staff", "Dagger", "Sword", "Wand"]);
const PRIEST = weapons([TWO_H, ONE_H, FRILL, RANGED], ["Staff", "Dagger", "Mace", "Wand"]);
const MONK = ["Staff", "Polearm", "Fist Weapon", "Axe", "Mace", "Sword"];
const ROGUE = weapons([ONE_H], ["Dagger", "Fist Weapon", "Axe", "Mace", "Sword"]);
const DK_2H = weapons([TWO_H], ["Axe", "Mace", "Sword", "Polearm"]);
const SHAMAN_CASTER = weapons([TWO_H, ONE_H, SHIELD, FRILL], ["Staff", "Axe", "Mace", "Dagger", "Fist Weapon"]);
const SPEC_WEAPONS = {
  "Death Knight|Blood": DK_2H,
  "Death Knight|Frost": weapons([TWO_H, ONE_H], ["Axe", "Mace", "Sword", "Polearm"]),
  "Death Knight|Unholy": DK_2H,
  "Demon Hunter|Devourer": weapons([ONE_H], ["Warglaives", "Axe", "Sword", "Fist Weapon"]),
  "Demon Hunter|Havoc": weapons([ONE_H], ["Warglaives", "Axe", "Sword", "Fist Weapon"]),
  "Demon Hunter|Vengeance": weapons([ONE_H], ["Warglaives", "Axe", "Sword", "Fist Weapon"]),
  "Druid|Balance": CASTER_DRUID,
  "Druid|Feral": weapons([TWO_H], ["Staff", "Polearm", "Mace"]),
  "Druid|Guardian": weapons([TWO_H], ["Staff", "Polearm", "Mace"]),
  "Druid|Restoration": CASTER_DRUID,
  "Evoker|Augmentation": EVOKER,
  "Evoker|Devastation": EVOKER,
  "Evoker|Preservation": EVOKER,
  "Hunter|Beast Mastery": weapons([RANGED], ["Bow", "Gun", "Crossbow"]),
  "Hunter|Marksmanship": weapons([RANGED], ["Bow", "Gun", "Crossbow"]),
  "Hunter|Survival": weapons([TWO_H], ["Polearm", "Staff", "Axe", "Sword"]),
  "Mage|Arcane": MAGE_LOCK,
  "Mage|Fire": MAGE_LOCK,
  "Mage|Frost": MAGE_LOCK,
  "Monk|Brewmaster": weapons([TWO_H, ONE_H], MONK),
  "Monk|Mistweaver": weapons([TWO_H, ONE_H, FRILL], MONK),
  "Monk|Windwalker": weapons([TWO_H, ONE_H], MONK),
  "Paladin|Holy": weapons([TWO_H, ONE_H, SHIELD, FRILL], ["Axe", "Mace", "Sword", "Polearm"]),
  "Paladin|Protection": weapons([ONE_H, SHIELD], ["Axe", "Mace", "Sword"]),
  "Paladin|Retribution": weapons([TWO_H], ["Axe", "Mace", "Sword", "Polearm"]),
  "Priest|Discipline": PRIEST,
  "Priest|Holy": PRIEST,
  "Priest|Shadow": PRIEST,
  "Rogue|Assassination": ROGUE,
  "Rogue|Outlaw": ROGUE,
  "Rogue|Subtlety": ROGUE,
  "Shaman|Elemental": SHAMAN_CASTER,
  "Shaman|Enhancement": weapons([ONE_H], ["Axe", "Mace", "Fist Weapon", "Dagger"]),
  "Shaman|Restoration": SHAMAN_CASTER,
  "Warlock|Affliction": MAGE_LOCK,
  "Warlock|Demonology": MAGE_LOCK,
  "Warlock|Destruction": MAGE_LOCK,
  "Warrior|Arms": weapons([TWO_H], ["Axe", "Mace", "Sword", "Polearm", "Staff"]),
  // Titan's Grip dual-wields two-handed axes, maces and swords, not polearms or staves.
  "Warrior|Fury": weapons([TWO_H, ONE_H], ["Axe", "Mace", "Sword", "Dagger", "Fist Weapon"]),
  "Warrior|Protection": weapons([ONE_H, SHIELD], ["Axe", "Mace", "Sword", "Dagger", "Fist Weapon"]),
};
// Hand-curated spec fields, kept across re-runs (see README for their shape).
const CURATED = ["statPriority", "statPriorityLabel", "statVariants", "statNotes", "statSource", "bis"];
const EMPTY_BIS = { source: null, url: null, date: null, items: [] };

// ---------------------------------------------------------------- HTTP

async function getToken() {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const { BLIZZARD_CLIENT_ID: id, BLIZZARD_CLIENT_SECRET: secret } = process.env;
  if (id && secret) headers.Authorization = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers,
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const token = await getToken();

async function api(pathname, attempt = 0) {
  const url = `${API}${pathname}${pathname.includes("?") ? "&" : "?"}namespace=${NS}&locale=${LOCALE}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return api(pathname, attempt + 1);
  }
  if (!res.ok) throw new Error(`GET ${pathname}: HTTP ${res.status}`);
  return res.json();
}

// Run fn over items with bounded concurrency (API limit is 100 req/s).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- items

function parseStats(stats = []) {
  // Primary stats the item can roll (is_negated marks one that is inactive for
  // the preview spec, but it is still a primary stat the item provides).
  const primaryStats = stats.filter((s) => PRIMARY[s.type.type]).map((s) => PRIMARY[s.type.type]);
  const secondaryStats = stats.filter((s) => SECONDARY[s.type.type]).map((s) => SECONDARY[s.type.type]);
  return { primaryStats, secondaryStats };
}

function isGear(item) {
  return item.inventory_type?.type !== "NON_EQUIP" && item.item_subclass?.name !== "Cosmetic";
}

function toRecord(item, instance, encounter) {
  const p = item.preview_item ?? {};
  const itemClass = item.item_class?.name ?? null;
  const subclass = item.item_subclass?.name ?? null;
  const slot = item.inventory_type?.name ?? null;
  const { primaryStats, secondaryStats } = parseStats(p.stats);
  const notes = [];
  // Legacy BfA head/shoulder/chest drops are Azerite armor in the item data and
  // carry no secondaries there; their in-season stats are not in the API.
  if (p.azerite_details && !secondaryStats.length) notes.push("azerite-no-secondaries-in-api");
  if (!p.stats?.length) notes.push("no-stats-in-api");
  return {
    id: item.id,
    name: item.name,
    instance: instance.name,
    instanceId: instance.id,
    instanceType: instance.category?.type ?? null,
    boss: encounter.name,
    encounterId: encounter.id,
    slot,
    itemClass,
    // Cloaks report "Cloth" but are wearable by everyone, so they get no armor type.
    armorType: itemClass === "Armor" && ARMOR_TYPES.has(subclass) && slot !== "Back" ? subclass : null,
    weaponType: itemClass === "Weapon" ? subclass : null,
    primaryStats,
    secondaryStats,
    quality: item.quality?.type ?? null,
    // e.g. "Venomcursed": raid items with a single secondary plus a proc.
    tag: p.name_description?.display_string ?? null,
    notes,
  };
}

async function fetchItems() {
  const index = await api("/data/wow/journal-instance/index");
  const byName = new Map(index.instances.map((i) => [i.name.toLowerCase(), i.id]));
  const wanted = [
    ...season.dungeons.map((name) => ({ name, kind: "dungeon" })),
    ...season.raids.map((name) => ({ name, kind: "raid" })),
  ];
  const missing = wanted.filter((w) => !byName.has(w.name.toLowerCase()));
  if (missing.length) throw new Error(`Journal instances not found: ${missing.map((m) => m.name).join(", ")}`);

  const records = [];
  const itemCache = new Map();
  for (const w of wanted) {
    const instance = await api(`/data/wow/journal-instance/${byName.get(w.name.toLowerCase())}`);
    const encounters = await mapLimit(instance.encounters ?? [], 8, (e) => api(`/data/wow/journal-encounter/${e.id}`));
    for (const enc of encounters) {
      const items = await mapLimit(enc.items ?? [], 10, async (entry) => {
        const id = entry.item.id;
        if (!itemCache.has(id)) itemCache.set(id, api(`/data/wow/item/${id}`));
        return itemCache.get(id);
      });
      const seen = new Set();
      for (const item of items) {
        // The journal lists some items twice per boss; skip non-gear loot.
        if (seen.has(item.id) || !isGear(item)) continue;
        seen.add(item.id);
        records.push(toRecord(item, instance, enc));
      }
    }
    console.log(`${instance.name}: ${encounters.length} bosses, ${records.filter((r) => r.instanceId === instance.id).length} drops`);
  }
  return records;
}

// ---------------------------------------------------------------- specs

async function buildSpecs() {
  const file = path.join(ROOT, "data/specs.json");
  const existing = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : { specs: [] };
  const prev = new Map(existing.specs.map((s) => [s.id, s]));

  const index = await api("/data/wow/playable-specialization/index");
  const specs = await mapLimit(index.character_specializations, 10, (s) => api(`/data/wow/playable-specialization/${s.id}`));
  return specs
    // "Initial" specs are the pre-spec-choice placeholders for new characters.
    .filter((s) => s.name !== "Initial" && s.primary_stat_type)
    .map((s) => {
      const old = prev.get(s.id) ?? {};
      const key = `${s.playable_class.name}|${s.name}`;
      if (!SPEC_WEAPONS[key]) console.warn(`No weapon table entry for ${key}`);
      const curated = Object.fromEntries(CURATED.filter((k) => k in old).map((k) => [k, old[k]]));
      return {
        id: s.id,
        class: s.playable_class.name,
        spec: s.name,
        role: s.role.type,
        armorType: CLASS_ARMOR[s.playable_class.name] ?? null,
        primaryStat: PRIMARY[s.primary_stat_type.type] ?? s.primary_stat_type.name,
        weapons: SPEC_WEAPONS[key] ?? { slots: [], types: [] },
        // Curated fields: filled in by hand, kept across re-runs.
        statPriority: [],
        ...curated,
        bis: curated.bis ?? EMPTY_BIS,
      };
    })
    .sort((a, b) => a.class.localeCompare(b.class) || a.spec.localeCompare(b.spec));
}

// ---------------------------------------------------------------- main

await mkdir(path.join(ROOT, "data"), { recursive: true });
const meta = { region: REGION, locale: LOCALE, season: season.name, generatedAt: new Date().toISOString() };

if (!SPECS_ONLY) {
  const items = await fetchItems();
  const odd = items.filter((i) => i.secondaryStats.length !== 2 && !["Trinket", "Neck"].includes(i.slot) && !i.tag);
  if (odd.length) console.warn(`Note: ${odd.length} drops lack 2 secondaries in the API (see "notes"):\n  ` + odd.map((i) => `${i.name} (${i.instance})`).join("\n  "));
  await writeFile(path.join(ROOT, "data/items.json"), JSON.stringify({ ...meta, items }, null, 2) + "\n");
  console.log(`Wrote data/items.json (${items.length} drops)`);
}

const specs = await buildSpecs();
await writeFile(path.join(ROOT, "data/specs.json"), JSON.stringify({ ...meta, specs }, null, 2) + "\n");
console.log(`Wrote data/specs.json (${specs.length} specs)`);
