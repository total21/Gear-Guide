// Pure filtering and ranking logic for the farm list. No DOM access, so
// scripts/check-app.mjs can import it under Node.

export const STATS = ["Critical Strike", "Haste", "Mastery", "Versatility"];
export const SHORT = { "Critical Strike": "Crit", Haste: "Haste", Mastery: "Mastery", Versatility: "Vers" };
export const KEY = { "Critical Strike": "c", Haste: "h", Mastery: "m", Versatility: "v" };

// Slot filter groups, in paper-doll order.
export const SLOT_GROUPS = [
  ["head", "Head"], ["neck", "Neck"], ["shoulder", "Shoulder"], ["back", "Back"],
  ["chest", "Chest"], ["wrist", "Wrist"], ["hands", "Hands"], ["waist", "Waist"],
  ["legs", "Legs"], ["feet", "Feet"], ["ring", "Ring"], ["trinket", "Trinket"],
  ["weapon", "Weapon"], ["offhand", "Off-hand"],
];

export function slotGroup(item) {
  if (item.itemClass === "Weapon") return "weapon";
  if (item.slot === "Off Hand" || item.slot === "Held In Off-hand") return "offhand";
  if (item.slot === "Finger") return "ring";
  return item.slot.toLowerCase();
}

// "Leather · Legs", "Dagger · One-Hand", "Shield", "Ring".
export function typeLabel(item) {
  if (item.itemClass === "Weapon") return `${item.weaponType} · ${item.slot}`;
  if (item.slot === "Off Hand") return "Shield";
  if (item.slot === "Held In Off-hand") return "Off-hand";
  if (item.slot === "Finger") return "Ring";
  return item.armorType ? `${item.armorType} · ${item.slot}` : item.slot;
}

// Can this spec equip the item and does it carry the spec's primary stat?
export function usableBy(spec, item) {
  if (item.primaryStats.length && !item.primaryStats.includes(spec.primaryStat)) return false;
  if (item.itemClass === "Weapon")
    return spec.weapons.slots.includes(item.slot) && spec.weapons.types.includes(item.weaponType);
  if (item.slot === "Off Hand" || item.slot === "Held In Off-hand") return spec.weapons.slots.includes(item.slot);
  return !item.armorType || item.armorType === spec.armorType;
}

// Stat -> 1-based rank in the priority, or null when the source leaves it unranked.
export function ranks(priority) {
  return Object.fromEntries(STATS.map((s) => [s, priority.includes(s) ? priority.indexOf(s) + 1 : null]));
}

// Higher is better: rank 1 = 4 points ... rank 4 = 1, unranked = 0.
export function statScore(rank) {
  return rank ? 5 - rank : 0;
}

export function pairId(a, b) {
  return [KEY[a], KEY[b]].sort().join("");
}

// All six two-stat pairs, best first for this priority.
export function rankedPairs(priority) {
  const r = ranks(priority);
  const pairs = [];
  for (let i = 0; i < STATS.length; i++)
    for (let j = i + 1; j < STATS.length; j++) {
      const [a, b] = [STATS[i], STATS[j]].sort((x, y) => statScore(r[y]) - statScore(r[x]));
      pairs.push({ id: pairId(a, b), stats: [a, b], score: statScore(r[a]) + statScore(r[b]) });
    }
  return pairs.sort((x, y) => y.score - x.score || STATS.indexOf(x.stats[0]) - STATS.indexOf(y.stats[0]));
}

// Item's secondaries sorted best-first, plus its pair id (null unless exactly two).
export function itemStats(item, priority) {
  const r = ranks(priority);
  const stats = [...item.secondaryStats].sort((a, b) => statScore(r[b]) - statScore(r[a]));
  return {
    stats: stats.map((s) => ({ stat: s, rank: r[s] })),
    score: stats.reduce((n, s) => n + statScore(r[s]), 0),
    pair: stats.length === 2 ? pairId(stats[0], stats[1]) : null,
  };
}

// The journal lists each legacy BfA Azerite piece twice: the old item (no
// secondaries in the API) and its current re-issue with real stats. Keep the
// re-issue only.
export function dropAzeriteTwins(items) {
  const withStats = new Set(items.filter((i) => i.secondaryStats.length).map((i) => `${i.instance}|${i.boss}|${i.name}`));
  return items.filter((i) => !(i.notes.includes("azerite-no-secondaries-in-api") && withStats.has(`${i.instance}|${i.boss}|${i.name}`)));
}

// The BiS list for a hero talent: its own list if it has one, else the spec's shared list.
export function bisFor(spec, hero) {
  return spec.bisByHero?.[hero] ?? spec.bis ?? null;
}

// Stat priority for a hero talent: its own order if the source splits them, else the spec's.
export function priorityForHero(spec, hero) {
  return spec.heroStatPriority?.[hero] ?? spec.statPriority;
}

// `source` is "all", "DUNGEON", "RAID", or "BIS" (only the BiS list's items).
// `bis` is the BiS list to use (see bisFor); defaults to the spec's shared list.
// Group usable items as [{ instance, type, bosses: [{ boss, items }] }], keeping
// journal order (items.json is written instance by instance, boss by boss).
export function groupForSpec(items, spec, { priority, pair = "all", slot = "all", source = "all", sort = "boss", bis: bisList } = {}) {
  const prio = priority ?? spec.statPriority;
  const bis = new Map(((bisList ?? spec.bis)?.items ?? []).filter((b) => b.id != null).map((b) => [b.id, b]));
  const out = [];
  const byInstance = new Map();
  for (const item of dropAzeriteTwins(items)) {
    if (!byInstance.has(item.instance)) {
      const g = { instance: item.instance, type: item.instanceType, bosses: [], total: 0 };
      byInstance.set(item.instance, g);
      out.push(g);
    }
    const g = byInstance.get(item.instance);
    if (source !== "all" && source !== "BIS" && item.instanceType !== source) continue;
    if (source === "BIS" && !bis.has(item.id)) continue;
    if (!usableBy(spec, item)) continue;
    g.total++;
    const st = itemStats(item, prio);
    if (pair !== "all" && st.pair !== pair) continue;
    if (slot !== "all" && slotGroup(item) !== slot) continue;
    let b = g.bosses.find((x) => x.boss === item.boss);
    if (!b) g.bosses.push((b = { boss: item.boss, items: [] }));
    const entry = bis.get(item.id);
    b.items.push({ ...item, ...st, bis: entry ? entry.lists ?? ["Overall"] : null, bisNote: entry?.note ?? null });
  }
  if (sort === "stats") for (const g of out) for (const b of g.bosses) b.items.sort((x, y) => y.score - x.score);
  if (source === "BIS") return out.filter((g) => g.bosses.length);
  return out.filter((g) => source === "all" || g.type === source);
}

// Season drops this spec could put in the Catalyst for a set piece in `slot`,
// best stats first. The Catalyst keeps the drop's secondary stats.
export function catalystOptions(items, spec, slot, priority) {
  return dropAzeriteTwins(items)
    .filter((i) => i.slot === slot && usableBy(spec, i) && i.secondaryStats.length)
    .map((i) => ({ ...i, ...itemStats(i, priority) }))
    .sort((a, b) => b.score - a.score);
}

// BiS items that aren't Season drops, split into tier (set pieces and
// off-set pieces), crafted, and anything else.
export function splitOffDrops(bisItems, dropIds) {
  const out = { tier: [], crafted: [], other: [] };
  for (const b of bisItems ?? []) {
    if (b.id != null && dropIds.has(b.id)) continue;
    (b.tier ? out.tier : b.crafted ? out.crafted : out.other).push(b);
  }
  return out;
}

// Slot filter group for a BiS list's free-text slot ("Boots", "Ring 2",
// "Main-Hand", "Cape"...), for items that aren't Season drops.
export function bisSlotGroup(text) {
  const t = String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/^(off ?hand|shield|held in off hand)/.test(t)) return "offhand";
  if (/weapon|^(main|one|two|2) ?hand|^1h|^2h/.test(t)) return "weapon";
  const words = { helm: "head", shoulders: "shoulder", cloak: "back", cape: "back", bracers: "wrist", gloves: "hands", belt: "waist", boots: "feet", finger: "ring", trinkets: "trinket" };
  const w = t.split(" ")[0];
  return words[w] ?? w;
}
