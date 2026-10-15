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
  ["onehand", "One-Hand"], ["twohand", "Two-Hand"], ["offhand", "Off Hand"],
];

export function slotGroup(item) {
  // Bows, guns and crossbows are two-handed; a wand is held like a one-hander.
  if (item.itemClass === "Weapon")
    return item.slot === "Two-Hand" || (item.slot === "Ranged" && item.weaponType !== "Wand") ? "twohand" : "onehand";
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
// `stats` keeps items carrying every listed secondary stat (the stat buttons).
export function groupForSpec(items, spec, { priority, pair = "all", stats = [], slot = "all", source = "all", sort = "boss", bis: bisList } = {}) {
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
    if (stats.length && !stats.every((x) => item.secondaryStats.includes(x))) continue;
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

// Stat buttons: the four secondaries in the spec's priority order, unranked last.
export function statOrder(priority) {
  return [...priority.filter((x) => STATS.includes(x)), ...STATS.filter((x) => !priority.includes(x))];
}

// Stat filter after clicking a stat button: toggles it, keeping at most two
// (items have two secondaries), so a third choice drops the oldest.
export function toggleStat(selected, stat) {
  if (selected.includes(stat)) return selected.filter((x) => x !== stat);
  return [...selected, stat].slice(-2);
}

// "On use" / "Proc" labels for an item's effects, in place of their text
// (the Wowhead tooltip has the details). Equip effects that only reduce the
// raid's Deadly Venom damage are skipped.
export function effectTags(item) {
  const tags = [];
  for (const e of item.effects ?? []) {
    const tag = /^Use:/.test(e.text) ? "On use" : /Deadly Venom/.test(e.text) ? null : "Proc";
    if (tag && !tags.some((t) => t.tag === tag)) tags.push({ tag, text: e.text });
  }
  return tags;
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

// The BiS list as worn: the Overall list's first pick per slot (two rings,
// two trinkets), in paper-doll order. Weapons: the first two-hander alone
// (plus an off-hand when the next pick is labeled one, e.g. Titan's Grip),
// or the first one-hander plus the next one-hand or off-hand pick. Later
// picks for a slot are Wowhead's alternates (situational trinkets, a second
// weapon setup) and are left out, as are catalyst sources (see resolve-bis).
export function trueBis(bisItems, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const picks = (bisItems ?? []).filter((b) => !b.addedBy && (b.lists ?? ["Overall"]).includes("Overall"));
  const twoHand = (b) => byId.get(b.id)?.slot === "Two-Hand" || /\b2 ?h\b|2-hand|two-hand/i.test(b.slot ?? "");
  const offLabel = (b) => /off.?hand|shield/i.test(b.slot ?? "");
  const out = [];
  for (const [key] of SLOT_GROUPS) {
    if (key === "twohand" || key === "offhand") continue;
    // Weapons and off-hands are picked together, at the first hand slot.
    if (key === "onehand") {
      const hands = picks.filter((b) => ["weapon", "offhand"].includes(bisSlotGroup(b.slot)));
      const [first, ...rest] = hands;
      if (!first) continue;
      out.push(first);
      const second = twoHand(first) ? rest.find(offLabel) : rest.find((b) => !twoHand(b) || offLabel(b));
      if (second && (!twoHand(first) || rest[0] === second)) out.push(second);
      continue;
    }
    out.push(...picks.filter((b) => bisSlotGroup(b.slot) === key).slice(0, ["ring", "trinket"].includes(key) ? 2 : 1));
  }
  return out;
}

// Wowhead's alternates: the Overall picks trueBis leaves out (situational
// trinkets, a second weapon setup, extra rings), in list order.
export function situationalBis(bisItems, items) {
  const worn = new Set(trueBis(bisItems, items));
  return (bisItems ?? []).filter((b) => !b.addedBy && (b.lists ?? ["Overall"]).includes("Overall") && !worn.has(b));
}

// How to get a BiS tier piece, for the spec's stat priority:
//   { route: "token", stats }: the raid token or curio; the piece comes with `stats`.
//   { route: "catalyst", from }: catalyze one of these Season drops (best stats
//     first); the piece keeps that drop's secondary stats.
// Wowhead's pick decides, except where it allows any drop in the slot: then the
// best-stat drops, or the token when its own stats are as good.
export function tierRoute(b, items, spec, priority) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const tokenStats = b.tokenStats ?? [];
  if (!b.catalyst && !b.offSet) return { route: "token", stats: tokenStats };
  const named = (b.catalyst?.from ?? []).map((f) => byId.get(f.id)).filter(Boolean);
  if (named.length) return { route: "catalyst", from: named.map((i) => ({ ...i, ...itemStats(i, priority) })) };
  const opts = catalystOptions(items, spec, b.slot, priority);
  const top = opts[0]?.score ?? -1;
  if (!b.offSet && tokenStats.length && itemStats({ secondaryStats: tokenStats }, priority).score >= top)
    return { route: "token", stats: tokenStats };
  return { route: "catalyst", from: opts.filter((o) => o.score === top).slice(0, 2) };
}
