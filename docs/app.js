import { SHORT, SLOT_GROUPS, groupForSpec, rankedPairs, typeLabel, slotGroup, bisFor, priorityForHero, itemStats, catalystOptions, splitOffDrops, bisSlotGroup } from "./gear.js";

const $ = (id) => document.getElementById(id);
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const STORE = "gear-guide:v1";

// Last spec, build per spec, and filters. Storage can be unavailable (private
// mode, blocked site data), so every access is guarded and defaults still work.
let state = { spec: null, hero: {}, variant: {}, pair: "all", slot: "all", source: "all", sort: "boss" };
try { Object.assign(state, JSON.parse(localStorage.getItem(STORE)) ?? {}); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };

const ROLE = { TANK: "Tank", HEALER: "Healer", DAMAGE: "DPS" };
const SOURCES = [["all", "M+ and raid"], ["DUNGEON", "Mythic+"], ["RAID", "Raid"], ["BIS", "★ Best in Slot"]];
const SORTS = [["boss", "Boss order"], ["stats", "Best stats"]];

let items = [], specs = [], meta = {};

async function load() {
  const [i, s] = await Promise.all(["data/items.json", "data/specs.json"].map((u) =>
    fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); })));
  items = i.items;
  specs = s.specs;
  meta = { season: i.season, generatedAt: i.generatedAt };
}

const currentSpec = () => specs.find((s) => s.id === state.spec) ?? specs[0];

// Hero talent chosen for a spec (remembered per spec), defaulting to the first.
const heroFor = (spec) => (spec.heroTalents?.includes(state.hero?.[spec.id]) ? state.hero[spec.id] : spec.heroTalents?.[0] ?? null);

function priorityFor(spec) {
  const v = spec.statVariants?.find((x) => x.label === state.variant[spec.id]);
  return v ? v.priority : priorityForHero(spec, heroFor(spec));
}

function specPicker() {
  const byClass = Map.groupBy(specs, (s) => s.class);
  $("spec").innerHTML = [...byClass].map(([cls, list]) =>
    `<optgroup label="${esc(cls)}">${list.map((s) =>
      `<option value="${s.id}">${esc(s.spec)} ${esc(cls)} (${ROLE[s.role] ?? s.role})</option>`).join("")}</optgroup>`).join("");
  $("spec").onchange = () => { state.spec = +$("spec").value; state.slot = "all"; state.pair = "all"; save(); syncHash(); render(); };
  $("variant").onchange = () => { state.variant[state.spec] = $("variant").value; save(); render(); };
  $("hero").onchange = () => { state.hero = { ...state.hero, [state.spec]: $("hero").value }; save(); render(); };
}

function syncHash() {
  history.replaceState(null, "", `#spec=${state.spec}`);
}

function chips(el, list, key) {
  el.innerHTML = list.map(([v, label, n, off]) =>
    `<button class="chip" data-v="${esc(v)}" aria-pressed="${state[key] === v}"${off ? " disabled" : ""}>${label}${n != null ? `<span class="n">${n}</span>` : ""}</button>`).join("");
  el.querySelectorAll("button").forEach((b) => (b.onclick = () => { state[key] = b.dataset.v; save(); render(); }));
}

function statChip({ stat, rank }) {
  return `<span class="stat r${rank ?? 0}" title="${esc(stat)}${rank ? ` (#${rank} for this spec)` : " (unranked)"}">${SHORT[stat]}${rank ? `<sup>#${rank}</sup>` : ""}</span>`;
}

const itemLink = (id, name) => `<a href="https://www.wowhead.com/item=${id}" target="_blank" rel="noopener">${esc(name)}</a>`;

const searchLink = (name) => `<a href="https://www.wowhead.com/search?q=${encodeURIComponent(name)}" target="_blank" rel="noopener">${esc(name)}</a>`;
const bestBadge = (pair, ctx) => pair && pair === ctx.topPair ? `<span class="badge b-top" title="${esc(ctx.bestTitle)}">Best stats</span>` : "";
const listsLabel = (b) => (b.lists?.length && b.lists.join() !== "Overall" ? ` · ${esc(b.lists.join(" / "))}` : "");
const fxList = (lines) => (lines.length ? `<ul class="fx">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : "");

// A Season drop to put in the Catalyst, with its stats (the Catalyst keeps them).
function catalystSource(i, ctx) {
  const st = itemStats(i, ctx.prio);
  return `${itemLink(i.id, i.name)} <span class="where">${esc(i.boss)} · ${esc(i.instance)}</span> ${st.stats.map(statChip).join(" ")}${bestBadge(st.pair, ctx)}`;
}

// Tier piece or off-set piece: the route the BiS list prefers (Catalyst from
// a drop with the right stats, or the raid token / curio), then the other.
function tierRow(b, ctx) {
  const link = b.id ? itemLink(b.id, b.name) : searchLink(b.name);
  const lines = [];
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const catalyst = !!b.catalyst;
  const tokenLine = b.token
    ? `<b>Raid token:</b> ${itemLink(b.token.id, b.token.name)} <span class="where">${esc(b.token.boss)}</span>${b.curio ? ` or <b>curio:</b> ${itemLink(b.curio.id, b.curio.name)} <span class="where">${esc(b.curio.boss)}</span>` : ""}`
    : null;
  if (b.catalyst?.from?.length) {
    lines.push(`<b>Catalyze:</b> ${b.catalyst.from.map((f) => byId.has(f.id) ? catalystSource(byId.get(f.id), ctx) : itemLink(f.id, f.name)).join(" <i>or</i> ")}`);
  } else if (b.catalyst?.any) {
    const opts = catalystOptions(ctx.items, ctx.spec, b.slot, ctx.prio);
    const best = opts.filter((o) => o.score === opts[0]?.score).slice(0, 4);
    lines.push(`<b>Catalyze:</b> any ${esc(b.catalyst.any)} Season drop` +
      (best.length ? `. Best stats for this slot: ${best.map((o) => catalystSource(o, ctx)).join(" <i>or</i> ")}` : ""));
  }
  if (tokenLine) lines.push(catalyst ? `<span class="alt">Or ${tokenLine.replace("<b>Raid token:</b>", "the raid token")}, which comes with the set's fixed stats.</span>` : tokenLine);
  const route = catalyst ? `<span class="badge b-route" title="Convert a Season drop at the Catalyst; it keeps that drop's secondary stats">Catalyst</span>`
    : `<span class="badge b-route" title="Raid token, or the any-slot curio">Token</span>`;
  return `<li><div class="name">${link}${route}</div>
    <div class="type">${esc(b.slot ?? "")} · ${b.offSet ? `off-set piece, ${esc(b.tier)}` : esc(b.tier)}${listsLabel(b)}${b.source ? ` · Wowhead: ${esc(b.source)}` : ""}</div>
    ${fxList(lines)}</li>`;
}

// Crafted item: profession, embellishment, reagents.
function craftedRow(b, ctx) {
  const c = b.crafted;
  const named = (x) => `${searchLink(x.name)}${x.profession ? ` <span class="where">${esc(x.profession)}</span>` : ""}`;
  const lines = [];
  if (c.builtIn?.length) lines.push(`<b>Embellishment:</b> built in. ${c.builtIn.map(esc).join(" ")}`);
  else if (c.embellishments.length) lines.push(`<b>Embellishment:</b> ${c.embellishments.map(named).join(", ")}`);
  else if (c.embellishable) lines.push(`<b>Embellishment:</b> <span class="alt">slot available; Wowhead names none for this item</span>`);
  if (c.customStats && ctx.topPair) {
    const best = ctx.pairs[0].stats.map((s) => statChip({ stat: s, rank: ctx.prio.indexOf(s) + 1 })).join(" ");
    lines.push(`<b>Secondary stats:</b> you choose them when crafting; pick ${best}<span class="badge b-top" title="${esc(ctx.bestTitle)}">Best stats</span>`);
  }
  if (c.otherReagents.length) lines.push(`<b>Other reagents (Wowhead):</b> ${c.otherReagents.map(named).join(", ")}`);
  lines.push(`<b>Base reagents:</b> ${c.reagents.map((r) => `${searchLink(r.name)}${r.quantity > 1 ? ` ×${r.quantity}` : ""}`).join(", ")}`);
  if (c.optional.length) lines.push(`<span class="alt"><b>Optional slots:</b> ${c.optional.map(esc).join(", ")}</span>`);
  return `<li><div class="name">${itemLink(b.id, b.name)}<span class="badge b-route">${esc(c.profession)}</span></div>
    <div class="type">${esc(b.slot ?? "")} · ${esc(c.profession)}, ${esc(c.category)}${listsLabel(b)}</div>
    ${fxList(lines)}</li>`;
}

// Anything else (vendor, currency, world drop...).
function otherRow(b) {
  return `<li><div class="name">${b.id ? itemLink(b.id, b.name) : searchLink(b.name)}</div>
    <div class="type">${esc(b.slot ?? "")}${listsLabel(b)}${b.source ? ` · Wowhead: ${esc(b.source)}` : ""}</div>
    ${b.crafting?.length ? fxList([`<b>Notes:</b> ${esc(b.crafting.join("; "))}`]) : ""}</li>`;
}

// "Use: ..." -> <b>Use:</b> ...
function effectLine(e) {
  const m = e.text.match(/^(Use|Equip|Chance on hit):\s*/);
  return `<li title="${esc(e.name ?? "")}">${m ? `<b>${m[1]}:</b> ${esc(e.text.slice(m[0].length))}` : esc(e.text)}</li>`;
}

function itemRow(it, topPair, spec, bestTitle) {
  const top = topPair && it.pair === topPair;
  const notes = [];
  if (it.notes.includes("no-stats-in-api")) notes.push("No stats in the game data API yet; check the tooltip in game.");
  else if (it.notes.includes("azerite-no-secondaries-in-api")) notes.push("Secondary stats not in the game data API (legacy Azerite item).");
  else if (!it.secondaryStats.length && !it.effects?.length) notes.push("No secondary stats.");
  // Trinkets carry the spec's primary stat as a base stat; show it next to any secondaries.
  const prim = it.slot === "Trinket" && it.primaryStats.includes(spec.primaryStat)
    ? `<span class="stat prim" title="Base ${esc(spec.primaryStat)} on this trinket">+${esc(spec.primaryStat.slice(0, 3))}</span>` : "";
  const type = typeLabel(it) + (it.tag ? ` · ${it.tag}` : "");
  return `<li class="${top ? "top" : ""}${it.bis ? " bis" : ""}">
    <div class="name"><a href="https://www.wowhead.com/item=${it.id}" target="_blank" rel="noopener">${esc(it.name)}</a>${top ? `<span class="badge b-top" title="${esc(bestTitle)}">Best stats</span>` : ""}${it.bis ? `<span class="badge b-bis" title="Best in slot (${esc(it.bis.join(", "))})">${it.bis.includes("Overall") ? "BiS" : `BiS · ${esc(it.bis.join(" / "))}`}</span>` : ""}</div>
    <div class="stats">${prim}${it.stats.map(statChip).join("")}</div>
    <div class="type">${esc(type)}</div>
    ${it.bisNote ? `<div class="craft">BiS: ${esc(it.bisNote)}</div>` : ""}
    ${it.effects?.length ? `<ul class="fx">${it.effects.map(effectLine).join("")}</ul>` : ""}
    ${notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}
  </li>`;
}

function render() {
  const spec = currentSpec();
  state.spec = spec.id;
  $("spec").value = spec.id;
  const label = `${spec.spec} ${spec.class}`;
  document.title = `${label} · S2 Gear Farm List`;
  $("title").textContent = `${label} S2 Farm List`;
  $("sub").textContent = `${meta.season} · ${spec.armorType}, ${spec.primaryStat}, every Mythic+ and raid drop this spec can use`;

  const hero = heroFor(spec);
  $("hero").innerHTML = (spec.heroTalents ?? []).map((h) => `<option>${esc(h)}</option>`).join("");
  $("hero").value = hero ?? "";
  const bisList = bisFor(spec, hero);

  // Content variants of the stat priority (raid vs Mythic+, defensive vs offensive...).
  const variants = spec.statVariants ?? [];
  $("variant").hidden = $("variant-label").hidden = !variants.length;
  if (variants.length) {
    const opts = [spec.statPriorityLabel ?? "Default", ...variants.map((v) => v.label)];
    $("variant").innerHTML = opts.map((o, i) => `<option value="${i ? esc(o) : ""}">${esc(o)}</option>`).join("");
    $("variant").value = state.variant[spec.id] ?? "";
  }

  const prio = priorityFor(spec);
  const src = spec.statSource;
  $("prio").innerHTML = prio.length
    ? `<span class="order"><b>Stat priority:</b> ${prio.map((s, i) => statChip({ stat: s, rank: i + 1 })).join(" › ")}</span>` +
      (src ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.site)} (${esc(src.patch)})</a>, checked ${esc(src.checked)}` : "") +
      (spec.heroStatPriority?.[hero] ? `. Order for ${esc(hero)}` : "") +
      (spec.statNotes ? `. ${esc(spec.statNotes)}` : "")
    : "No stat priority recorded for this spec yet.";

  const pairs = rankedPairs(prio);
  const topPair = prio.length >= 2 ? pairs[0].id : null;
  const bestTitle = topPair ? `Has ${label}'s two best secondary stats, ${pairs[0].stats.join(" and ")}` : "";
  const flat = (groups) => groups.flatMap((g) => g.bosses.flatMap((b) => b.items));
  // BiS items that aren't Season drops get their own sections in the BiS view.
  const split = splitOffDrops(bisList?.items, new Set(items.map((i) => i.id)));
  const offDrops = [...split.tier, ...split.crafted, ...split.other];
  const nBis = flat(groupForSpec(items, spec, { priority: prio, source: "BIS", bis: bisList })).length + offDrops.length;
  if (state.source === "BIS" && !nBis) state.source = "all";
  const opts = { priority: prio, source: state.source, sort: state.sort, bis: bisList };

  // Chip counts ignore their own filter so you can see what each choice yields.
  const forPairs = flat(groupForSpec(items, spec, { ...opts, slot: state.slot }));
  const forSlots = flat(groupForSpec(items, spec, { ...opts, pair: state.pair }));
  const slotCount = Object.groupBy(forSlots, slotGroup);
  // The pair filter doesn't apply to them, so they count only when it's off.
  if (state.source === "BIS" && state.pair === "all")
    for (const b of offDrops) (slotCount[bisSlotGroup(b.slot)] ??= []).push(b);
  const avail = SLOT_GROUPS.filter(([k]) => slotCount[k]);
  if (state.slot !== "all" && !avail.some(([k]) => k === state.slot)) state.slot = "all";

  chips($("pairs"), [["all", "All stats", null], ...pairs.map((p) =>
    [p.id, `${p.id === topPair ? "★ " : ""}${p.stats.map((s) => SHORT[s]).join(" / ")}`, forPairs.filter((i) => i.pair === p.id).length])], "pair");
  chips($("slots"), [["all", "All slots", null], ...avail.map(([k, l]) => [k, l, slotCount[k].length])], "slot");
  chips($("sources"), SOURCES.map(([k, l]) => k === "BIS" ? [k, l, nBis, !nBis] : [k, l, null]), "source");
  chips($("sorts"), SORTS.map(([k, l]) => [k, l, null]), "sort");

  const groups = groupForSpec(items, spec, { ...opts, pair: state.pair, slot: state.slot });
  let n = 0, nTop = 0, html = "";
  for (const g of groups) {
    const shown = g.bosses.reduce((k, b) => k + b.items.length, 0);
    if (!shown && g.total) continue;
    n += shown;
    nTop += g.bosses.reduce((k, b) => k + b.items.filter((i) => topPair && i.pair === topPair).length, 0);
    html += `<section><h2>${esc(g.instance)}<span>${g.type === "RAID" ? "Raid · " : ""}${shown} item${shown === 1 ? "" : "s"}</span></h2>`;
    html += shown
      ? g.bosses.filter((b) => b.items.length).map((b) => `<h3>${esc(b.boss)}</h3><ul>${b.items.map((i) => itemRow(i, topPair, spec, bestTitle)).join("")}</ul>`).join("")
      : `<div class="none">Nothing here for ${esc(label)}.</div>`;
    html += `</section>`;
  }
  // BiS items that aren't Season drops: tier, crafted, anything else. They
  // have no fixed stat pair, so the pair filter hides them.
  if (state.source === "BIS" && state.pair === "all") {
    const ctx = { items, spec, prio, pairs, topPair, bestTitle };
    const inSlot = (b) => state.slot === "all" || bisSlotGroup(b.slot) === state.slot;
    const section = (title, blurb, list, row) => {
      n += list.length;
      return list.length
        ? `<section><h2>${title}<span>${list.length} item${list.length === 1 ? "" : "s"}</span></h2><div class="none">${blurb}</div><ul>${list.map((b) => row(b, ctx)).join("")}</ul></section>` : "";
    };
    html +=
      section("Tier set", "Raid token or curio, or the Catalyst: convert a Season drop and keep its secondary stats.", split.tier.filter(inSlot), tierRow) +
      section("Crafted", "Embellishments and reagents from the profession recipe (Blizzard API) and Wowhead's notes.", split.crafted.filter(inSlot), craftedRow) +
      section("Other sources", "Not from Season dungeons, raids, crafting or the Catalyst.", split.other.filter(inSlot), otherRow);
  }
  $("list").innerHTML = html || `<div class="none">No drops match these filters.</div>`;
  $("count").textContent = `${n} item${n === 1 ? "" : "s"} shown` + (topPair ? ` · ${nTop} with the best stats` : "");

  const bis = bisList ?? {};
  const heroBis = !!spec.bisByHero?.[hero];
  $("foot").innerHTML =
    `<p>Stat chips are ranked for this spec: <span class="stat r1">#1</span> best, then <span class="stat r2">#2</span>, <span class="stat r3">#3</span>, <span class="stat r4">#4</span>. Highlighted rows marked <span class="badge b-top">Best stats</span> have the spec's two best secondary stats.</p>` +
    `<p>${bis.items?.length
      ? `BiS ${heroBis ? `for ${esc(hero)}` : "(shared by both hero talents)"} from <a href="${esc(bis.url ?? "#")}" target="_blank" rel="noopener">${esc(bis.source)}</a>${bis.patch ? ` (${esc(bis.patch)})` : ""}, imported ${esc(bis.date)}.`
      : `No BiS list for ${esc(label)}${hero ? ` (${esc(hero)})` : ""} yet.`}</p>` +
    `<p>Effect numbers come from the game data API at the item's preview item level; in-season values are higher.</p>` +
    `<p>Drops from the Blizzard Game Data API (${esc(meta.generatedAt?.slice(0, 10) ?? "")}). Item names link to Wowhead. Stat values scale with item level, so only stat types are shown.</p>`;
}

try {
  await load();
  specPicker();
  const fromHash = +new URLSearchParams(location.hash.slice(1)).get("spec");
  if (specs.some((s) => s.id === fromHash)) state.spec = fromHash;
  render();
  syncHash();
  save();
  addEventListener("hashchange", () => {
    const id = +new URLSearchParams(location.hash.slice(1)).get("spec");
    if (specs.some((s) => s.id === id) && id !== state.spec) { state.spec = id; save(); render(); }
  });
} catch (e) {
  $("list").innerHTML = `<div class="err">Could not load the gear data (${esc(e.message)}). If you opened this file directly, serve the folder instead, e.g. <code>npx serve docs</code>.</div>`;
}
