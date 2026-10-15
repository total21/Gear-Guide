// The player's character: gear they already have, from a SimulationCraft
// addon export or ticked by hand. Pure functions, no DOM, so scripts/check-app.mjs can test them.

// SimC gear lines: "head=,id=271474,bonus_id=..." (equipped) and, under
// "### Gear from Bags", the same line commented out ("# head=,id=...").
const SIMC_SLOTS = {
  head: "Head", neck: "Neck", shoulder: "Shoulder", back: "Back", chest: "Chest", wrist: "Wrist",
  hands: "Hands", waist: "Waist", legs: "Legs", feet: "Feet", finger1: "Finger", finger2: "Finger",
  trinket1: "Trinket", trinket2: "Trinket", main_hand: "Main Hand", off_hand: "Off Hand",
};
// SimC class keys ("deathknight") and spec keys ("beast_mastery").
const key = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]+/g, "");

// Parses a SimC addon export. Returns null when it doesn't look like one.
// Bag gear counts as owned; the Great Vault choices and the rest don't.
export function parseSimc(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = { name: null, className: null, specName: null, realm: null, region: null, items: [] };
  let section = "equipped", lastComment = "";
  for (const raw of lines) {
    const line = raw.trim();
    // First line: "# Mourn - Blood - 2026-10-14 18:02 - US/Kil'rogg" has the realm's display name.
    const head = line.match(/^#.* - ([A-Z]{2})\/(.+)$/);
    if (head && !out.realm) { out.region = head[1].toLowerCase(); out.realmName = head[2].trim(); continue; }
    if (/^###/.test(line)) { section = /gear from bags/i.test(line) ? "bags" : "other"; continue; }
    const cls = line.match(/^(deathknight|demonhunter|druid|evoker|hunter|mage|monk|paladin|priest|rogue|shaman|warlock|warrior)="?([^"]+)"?$/);
    if (cls) { out.className = cls[1]; out.name = cls[2]; continue; }
    const kv = line.match(/^(spec|server|region)=(.+)$/);
    if (kv) { out[{ spec: "specName", server: "realm", region: "region" }[kv[1]]] = kv[2].trim(); continue; }
    const gear = line.match(/^(#\s*)?([a-z_0-9]+)=[^,]*,(?:.*,)?id=(\d+)/);
    if (gear && SIMC_SLOTS[gear[2]]) {
      const commented = !!gear[1];
      if (commented ? section === "bags" : section === "equipped") {
        // The comment above each item reads "# Item Name (ilvl)".
        const c = lastComment.match(/^#\s*(.+?)\s*\((\d+)\)\s*$/);
        out.items.push({ id: +gear[3], slot: SIMC_SLOTS[gear[2]], name: c?.[1] ?? null, ilvl: c ? +c[2] : null, how: commented ? "bags" : "equipped" });
      }
      lastComment = "";
      continue;
    }
    if (line.startsWith("#")) lastComment = line;
  }
  if (out.realmName) { out.realm = out.realmName; delete out.realmName; }
  return out.className && out.items.length ? out : null;
}

// The spec a SimC export names, if we have it.
export function specOf(specs, className, specName) {
  return specs.find((s) => key(s.class) === key(className) && key(s.spec) === key(specName)) ?? null;
}

// Merges imported gear into a character, replacing what the last import
// brought in but keeping items ticked by hand.
export function withImport(char, imported, source) {
  const items = Object.fromEntries(Object.entries(char?.items ?? {}).filter(([, v]) => v.how === "manual"));
  // Tabards and shirts aren't gear worth tracking.
  for (const i of imported.items.filter((i) => !/tabard|shirt/i.test(i.slot ?? ""))) items[i.id] = { name: i.name, slot: i.slot, ilvl: i.ilvl ?? null, how: i.how ?? "equipped" };
  return {
    name: imported.name, realm: imported.realm ?? null, region: imported.region ?? null,
    className: imported.className ?? null, specName: imported.specName ?? null,
    source, updated: new Date().toISOString().slice(0, 10), items,
  };
}

// Key for an owned item: its ID, or its name when the BiS list has no ID
// (e.g. an off-set tier piece).
export const ownKey = (b) => (b.id != null ? String(b.id) : `n:${b.name}`);

// Where each worn BiS item comes from, for the checklist and the farm plan:
// { kind: "drop" | "tier" | "crafted" | "other", place, detail }.
// `route` is the tier piece's tierRoute (gear.js), when it has one.
export function bisSource(b, byId, route = null) {
  const drop = b.id != null && byId.get(b.id);
  if (drop) return { kind: "drop", place: drop.instance, detail: drop.boss, raid: drop.instanceType === "RAID" };
  if (b.tier) {
    const from = route?.route === "catalyst" ? route.from[0] : null;
    if (from) return { kind: "tier", place: from.instance, detail: `${from.boss} (catalyze ${from.name})`, raid: from.instanceType === "RAID" };
    if (b.token) {
      const place = [...byId.values()].find((i) => i.boss === b.token.boss)?.instance ?? "Raid";
      return { kind: "tier", place, detail: `${b.token.boss} (${b.token.name})`, raid: true };
    }
  }
  if (b.crafted) return { kind: "crafted", place: "Crafting", detail: b.crafted.profession };
  return { kind: "other", place: "Other", detail: b.source ?? "" };
}

// Missing worn BiS items grouped by where to farm them, most items first.
// `routeOf(b)` gives a tier piece's route (token or which drop to catalyze).
export function farmPlan(worn, owned, items, routeOf = () => null) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const groups = new Map();
  for (const b of worn) {
    if (owned[ownKey(b)]) continue;
    const src = bisSource(b, byId, b.tier ? routeOf(b) : null);
    if (!groups.has(src.place)) groups.set(src.place, { place: src.place, raid: !!src.raid, items: [] });
    groups.get(src.place).items.push({ ...b, detail: src.detail });
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.place.localeCompare(b.place));
}
