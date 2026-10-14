import { trueBis, situationalBis, SHORT, SLOT_GROUPS, groupForSpec, rankedPairs, typeLabel, slotGroup, bisFor, priorityForHero, itemStats, catalystOptions, statOrder, toggleStat, effectTags } from "./gear.js?v=12";

const $ = (id) => document.getElementById(id);
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const STORE = "gear-guide:v1";

// Last spec, build per spec, and filters. Storage can be unavailable (private
// mode, blocked site data), so every access is guarded and defaults still work.
// `stats`: the secondary stats an item must carry (none = all items).
let state = { spec: null, hero: {}, variant: {}, stats: null, slot: "all", source: "all" };
try { Object.assign(state, JSON.parse(localStorage.getItem(STORE)) ?? {}); } catch {}
delete state.pair; // replaced by `stats`
delete state.sort; // sort buttons removed
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };

const ROLE = { TANK: "Tank", HEALER: "Healer", DAMAGE: "DPS" };
const SOURCES = [["all", "M+ and raid"], ["DUNGEON", "Mythic+"], ["RAID", "Raid"], ["BIS", "★ Best in Slot"]];

let items = [], specs = [], meta = {};

async function load() {
  const [i, s] = await Promise.all(["data/items.json", "data/specs.json"].map((u) =>
    fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); })));
  items = i.items;
  specs = s.specs;
  meta = { season: i.season, generatedAt: i.generatedAt };
}

const currentSpec = () => specs.find((s) => s.id === state.spec) ?? specs[0];
// The list view is open when the URL names a spec (#spec=250); otherwise the landing page.
const hashSpec = () => +new URLSearchParams(location.hash.slice(1)).get("spec");
const inList = () => specs.some((s) => s.id === hashSpec());

// Hero talent chosen for a spec (remembered per spec), defaulting to the first.
const heroFor = (spec) => (spec.heroTalents?.includes(state.hero?.[spec.id]) ? state.hero[spec.id] : spec.heroTalents?.[0] ?? null);

function priorityFor(spec) {
  const v = spec.statVariants?.find((x) => x.label === state.variant[spec.id]);
  return v ? v.priority : priorityForHero(spec, heroFor(spec));
}

// A new spec, hero talent or build starts from its two best stats.
const bestStats = () => priorityFor(currentSpec()).slice(0, 2);
const changed = () => { state.stats = bestStats(); save(); if (inList()) syncHash(); render(); };

function specPicker() {
  const byClass = Map.groupBy(specs, (s) => s.class);
  $("spec").innerHTML = [...byClass].map(([cls, list]) =>
    `<optgroup label="${esc(cls)}">${list.map((s) =>
      `<option value="${s.id}">${esc(s.spec)} ${esc(cls)} (${ROLE[s.role] ?? s.role})</option>`).join("")}</optgroup>`).join("");
  $("spec").onchange = () => { state.spec = +$("spec").value; state.slot = "all"; changed(); };
  $("variant").onchange = () => { state.variant[state.spec] = $("variant").value; changed(); };
  $("hero").onchange = () => { state.hero = { ...state.hero, [state.spec]: $("hero").value }; changed(); };
  $("go").onclick = () => { state.slot = "all"; save(); location.hash = `spec=${state.spec}`; };
}

function syncHash() {
  history.replaceState(null, "", `#spec=${state.spec}`);
}

// Best in Slot shows the whole list: it clears the stat and slot filters, and
// choosing a stat or slot afterwards goes back to all Season drops.
function pick(key) {
  if (key === "source" && state.source === "BIS") { state.stats = []; state.slot = "all"; }
  if ((key === "stats" || key === "slot") && state.source === "BIS") state.source = "all";
}

function chips(el, list, key) {
  el.innerHTML = list.map(([v, label, n, off]) =>
    `<button class="chip" data-v="${esc(v)}" aria-pressed="${state[key] === v}"${off ? " disabled" : ""}>${label}${n != null ? `<span class="n">${n}</span>` : ""}</button>`).join("");
  el.querySelectorAll("button").forEach((b) => (b.onclick = () => { state[key] = b.dataset.v; pick(key); save(); render(); }));
}

// All stats, then each secondary in the spec's priority order. Stats toggle;
// two selected shows items with both.
function statButtons(prio, counts) {
  const sel = state.stats;
  const el = $("stats");
  el.innerHTML = `<button class="chip" data-v="" aria-pressed="${!sel.length}">All stats</button>` +
    statOrder(prio).map((x) => `<button class="chip" data-v="${esc(x)}" aria-pressed="${sel.includes(x)}">${SHORT[x]}<span class="n">${counts[x] ?? 0}</span></button>`).join("");
  el.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    state.stats = b.dataset.v ? toggleStat(state.stats, b.dataset.v) : [];
    pick("stats"); save(); render();
  }));
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
  return `${itemLink(i.id, i.name)} <span class="where">${esc(i.boss)}</span> ${st.stats.map(statChip).join(" ")}${bestBadge(st.pair, ctx)}`;
}

// Tier piece or off-set piece: the route the BiS list prefers (Catalyst from
// a drop with the right stats, or the raid token / curio), then the other.
function tierRow(b, ctx) {
  const lines = [];
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const token = b.token
    ? `${itemLink(b.token.id, b.token.name)} <span class="where">${esc(b.token.boss)}</span>${b.curio ? ` or ${itemLink(b.curio.id, b.curio.name)} <span class="where">${esc(b.curio.boss)}</span>` : ""}`
    : null;
  if (b.catalyst?.from?.length) {
    lines.push(`<b>Catalyze:</b> ${b.catalyst.from.map((f) => byId.has(f.id) ? catalystSource(byId.get(f.id), ctx) : itemLink(f.id, f.name)).join(" <i>or</i> ")}`);
  } else if (b.catalyst?.any) {
    const opts = catalystOptions(ctx.items, ctx.spec, b.slot, ctx.prio);
    const best = opts.filter((o) => o.score === opts[0]?.score).slice(0, 4);
    lines.push(`<b>Catalyze:</b> any ${esc(b.catalyst.any)}${best.length ? `, best: ${best.map((o) => catalystSource(o, ctx)).join(" <i>or</i> ")}` : ""}`);
  }
  if (token) lines.push(b.catalyst ? `<span class="alt">Or token: ${token}</span>` : `<b>Token:</b> ${token}`);
  const route = b.catalyst ? `<span class="badge b-route" title="Convert a Season drop at the Catalyst; it keeps that drop's secondary stats">Catalyst</span>`
    : `<span class="badge b-route" title="Raid token, or the any-slot curio">Token</span>`;
  return `<li><div class="name">${b.id ? itemLink(b.id, b.name) : searchLink(b.name)}${route}</div>
    <div class="type">${esc(b.slot ?? "")}${b.offSet ? " · off-set piece" : ""}${listsLabel(b)}</div>
    ${fxList(lines)}</li>`;
}

// Crafted item: name and profession. (Embellishments, gems and enchants may
// get their own section later; the resolver keeps that data in `crafted`.)
function craftedRow(b) {
  return `<li><div class="name">${itemLink(b.id, b.name)}<span class="badge b-route">${esc(b.crafted.profession)}</span></div>
    <div class="type">${esc(b.slot ?? "")}${listsLabel(b)}</div></li>`;
}

// Anything else (vendor, currency, world drop...).
function otherRow(b) {
  return `<li><div class="name">${b.id ? itemLink(b.id, b.name) : searchLink(b.name)}</div>
    <div class="type">${esc(b.slot ?? "")}${listsLabel(b)}${b.source ? ` · ${esc(b.source)}` : ""}</div></li>`;
}

function itemRow(it, topPair, spec, bestTitle, where = "") {
  const top = topPair && it.pair === topPair;
  // Trinkets carry the spec's primary stat as a base stat; show it next to any secondaries.
  const prim = it.slot === "Trinket" && it.primaryStats.includes(spec.primaryStat)
    ? `<span class="stat prim" title="Base ${esc(spec.primaryStat)} on this trinket">+${esc(spec.primaryStat.slice(0, 3))}</span>` : "";
  // On-use and proc effects are labeled; the Wowhead tooltip has the text.
  const tags = effectTags(it).map((t) => `<span class="stat tag" title="${esc(t.text)}">${t.tag}</span>`).join("");
  const missing = !it.secondaryStats.length && (it.notes.includes("no-stats-in-api") || it.notes.includes("azerite-no-secondaries-in-api"))
    ? `<span class="stat r0" title="Secondary stats aren't in the game data API; check the tooltip">Stats ?</span>` : "";
  const type = typeLabel(it) + (it.tag ? ` · ${it.tag}` : "");
  return `<li class="${top ? "top" : ""}${it.bis ? " bis" : ""}">
    <div class="name">${itemLink(it.id, it.name)}${top ? `<span class="badge b-top" title="${esc(bestTitle)}">Best stats</span>` : ""}${it.bis ? `<span class="badge b-bis" title="Best in slot (${esc(it.bis.join(", "))})">${it.bis.includes("Overall") ? "BiS" : `BiS · ${esc(it.bis.join(" / "))}`}</span>` : ""}</div>
    <div class="stats">${prim}${it.stats.map(statChip).join("")}${tags}${missing}</div>
    <div class="type">${esc(type)}${where ? ` · ${esc(where)}` : ""}</div>
    ${it.bisNote ? `<div class="craft">${esc(it.noteLabel ?? "BiS")}: ${esc(it.bisNote)}</div>` : ""}
  </li>`;
}

function render() {
  const spec = currentSpec();
  state.spec = spec.id;
  $("spec").value = spec.id;
  const label = `${spec.spec} ${spec.class}`;
  const home = !inList();
  document.body.classList.toggle("home", home);

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
  if (!Array.isArray(state.stats)) state.stats = prio.slice(0, 2);
  const src = spec.statSource;
  $("prio").innerHTML = prio.length
    ? `<span class="order"><b>Stat priority:</b> ${prio.map((s, i) => statChip({ stat: s, rank: i + 1 })).join(" › ")}</span>` +
      (src ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.site)} (${esc(src.patch)})</a>` : "") +
      (spec.statNotes && !home ? `. ${esc(spec.statNotes)}` : "")
    : "No stat priority recorded for this spec yet.";

  const pairs = rankedPairs(prio);
  const topPair = prio.length >= 2 ? pairs[0].id : null;
  const bestTitle = topPair ? `Has ${label}'s two best secondary stats, ${pairs[0].stats.join(" and ")}` : "";
  const flat = (groups) => groups.flatMap((g) => g.bosses.flatMap((b) => b.items));
  // The BiS list as worn (one pick per slot), plus the drops to catalyze into its tier pieces.
  const worn = trueBis(bisList?.items, items);
  const wornNames = new Set(worn.map((b) => b.name));
  const alternates = situationalBis(bisList?.items, items);
  const bisBadges = { items: [
    ...worn,
    ...(bisList?.items ?? []).filter((b) => b.addedBy && wornNames.has(b.note?.replace(/^Catalyze into /, ""))),
    ...alternates.map((b) => ({ ...b, lists: ["Situational"], note: b.note ? `Situational (${b.note})` : "Situational" })),
  ] };
  const isBis = state.source === "BIS" && !home && worn.length;
  if (state.source === "BIS" && !worn.length) state.source = "all";
  // The landing page counts every drop; the list counts within its filters.
  // Best in Slot ignores the filters, so its buttons count all Season drops.
  const opts = { priority: prio, source: home || isBis ? "all" : state.source, bis: bisBadges };
  if (isBis) { state.stats = []; state.slot = "all"; }
  const slot = home ? "all" : state.slot;
  const stats = state.stats;

  // Button counts ignore their own filter so you can see what each choice yields.
  const forStats = flat(groupForSpec(items, spec, { ...opts, slot }));
  statButtons(prio, Object.fromEntries(statOrder(prio).map((x) => [x, forStats.filter((i) => i.secondaryStats.includes(x)).length])));

  if (home) {
    document.title = "Gear Guide";
    $("title").textContent = "Gear Guide";
    $("sub").textContent = `${meta.season} · Mythic+ and raid gear for your spec, ranked by its stat priority`;
    $("list").innerHTML = $("foot").innerHTML = "";
    refreshTooltips();
    return;
  }
  document.title = `${label} · Gear Guide`;
  $("title").textContent = label;
  $("sub").textContent = `${meta.season} · ${spec.armorType} · ${spec.primaryStat}`;

  const slotCount = Object.groupBy(flat(groupForSpec(items, spec, { ...opts, stats })), slotGroup);
  const avail = SLOT_GROUPS.filter(([k]) => slotCount[k]);
  if (state.slot !== "all" && !avail.some(([k]) => k === state.slot)) state.slot = "all";

  chips($("slots"), [["all", "All slots", null], ...avail.map(([k, l]) => [k, l, slotCount[k].length])], "slot");
  chips($("sources"), SOURCES.map(([k, l]) => k === "BIS" ? [k, l, worn.length, !worn.length] : [k, l, null]), "source");

  let n = 0, html = "";
  if (isBis) {
    // One row per slot in paper-doll order, wherever the item comes from.
    const ctx = { items, spec, prio, pairs, topPair, bestTitle };
    const byId = new Map(items.map((i) => [i.id, i]));
    const row = (b, why) => {
      const drop = b.id != null && byId.get(b.id);
      if (drop) return itemRow({ ...drop, ...itemStats(drop, prio), bis: null, bisNote: why ? b.note : null, noteLabel: "Wowhead" }, topPair, spec, bestTitle, `${drop.instance} · ${drop.boss}`);
      return b.tier ? tierRow(b, ctx) : b.crafted ? craftedRow(b) : otherRow(b);
    };
    n = worn.length + alternates.length;
    html = `<section><h2>Best in Slot<span>${worn.length} items</span></h2><ul>${worn.map((b) => row(b)).join("")}</ul></section>`;
    // Wowhead's alternates for a slot, e.g. defensive trinkets or a second weapon setup.
    if (alternates.length)
      html += `<section><h2>Situational BiS<span>${alternates.length} item${alternates.length === 1 ? "" : "s"}</span></h2>` +
        `<div class="none">Wowhead lists these as alternatives for a slot. Sim your character (e.g. on Raidbots) to find which combination is best for you.</div>` +
        `<ul>${alternates.map((b) => row(b, true)).join("")}</ul></section>`;
  } else {
    const groups = groupForSpec(items, spec, { ...opts, stats, slot: state.slot });
    for (const g of groups) {
      const shown = g.bosses.reduce((k, b) => k + b.items.length, 0);
      if (!shown) continue;
      n += shown;
      html += `<section><h2>${esc(g.instance)}<span>${g.type === "RAID" ? "Raid · " : ""}${shown} item${shown === 1 ? "" : "s"}</span></h2>`;
      html += g.bosses.filter((b) => b.items.length).map((b) => `<h3>${esc(b.boss)}</h3><ul>${b.items.map((i) => itemRow(i, topPair, spec, bestTitle)).join("")}</ul>`).join("");
      html += `</section>`;
    }
  }
  $("list").innerHTML = html || `<div class="none">No drops match these filters.</div>`;
  $("count").textContent = `${n} item${n === 1 ? "" : "s"} shown`;

  const bis = bisList ?? {};
  const heroBis = !!spec.bisByHero?.[hero];
  $("foot").innerHTML =
    `<p>Stats are ranked for this spec: <span class="stat r1">#1</span> <span class="stat r2">#2</span> <span class="stat r3">#3</span> <span class="stat r4">#4</span>. <span class="badge b-top">Best stats</span> marks items with the two best. Hover an item for its Wowhead tooltip.</p>` +
    `<p>${bis.items?.length
      ? `BiS ${heroBis ? `for ${esc(hero)} ` : ""}from <a href="${esc(bis.url ?? "#")}" target="_blank" rel="noopener">${esc(bis.source)}</a>${bis.patch ? ` (${esc(bis.patch)})` : ""}, ${esc(bis.date)}.`
      : `No BiS list for ${esc(label)}${hero ? ` (${esc(hero)})` : ""} yet.`} ` +
    `Drops from the Blizzard Game Data API, ${esc(meta.generatedAt?.slice(0, 10) ?? "")}.</p>`;
  refreshTooltips();
}

// Wowhead's tooltip script (index.html) adds hover tooltips and icons to item
// links; links rendered after it loads need a refresh. Without it (blocked or
// offline) the links still open Wowhead.
function refreshTooltips() {
  try { window.$WowheadPower?.refreshLinks?.(); } catch {}
}

try {
  await load();
  specPicker();
  if (inList()) state.spec = hashSpec();
  render();
  save();
  addEventListener("hashchange", () => {
    if (inList() && hashSpec() !== state.spec) { state.spec = hashSpec(); state.stats = bestStats(); }
    save();
    render();
    scrollTo(0, 0);
  });
} catch (e) {
  $("list").innerHTML = `<div class="err">Could not load the gear data (${esc(e.message)}). If you opened this file directly, serve the folder instead, e.g. <code>npx serve docs</code>.</div>`;
}
