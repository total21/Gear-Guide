import { SHORT, SLOT_GROUPS, groupForSpec, rankedPairs, typeLabel, slotGroup } from "./gear.js";

const $ = (id) => document.getElementById(id);
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const STORE = "gear-guide:v1";

// Last spec, build per spec, and filters. Storage can be unavailable (private
// mode, blocked site data), so every access is guarded and defaults still work.
let state = { spec: null, variant: {}, pair: "all", slot: "all", source: "all", sort: "boss" };
try { Object.assign(state, JSON.parse(localStorage.getItem(STORE)) ?? {}); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };

const ROLE = { TANK: "Tank", HEALER: "Healer", DAMAGE: "DPS" };
const SOURCES = [["all", "M+ and raid"], ["DUNGEON", "Mythic+"], ["RAID", "Raid"]];
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

function priorityFor(spec) {
  const v = spec.statVariants?.find((x) => x.label === state.variant[spec.id]);
  return v ? v.priority : spec.statPriority;
}

function specPicker() {
  const byClass = Map.groupBy(specs, (s) => s.class);
  $("spec").innerHTML = [...byClass].map(([cls, list]) =>
    `<optgroup label="${esc(cls)}">${list.map((s) =>
      `<option value="${s.id}">${esc(s.spec)} ${esc(cls)} (${ROLE[s.role] ?? s.role})</option>`).join("")}</optgroup>`).join("");
  $("spec").onchange = () => { state.spec = +$("spec").value; state.slot = "all"; state.pair = "all"; save(); syncHash(); render(); };
  $("variant").onchange = () => { state.variant[state.spec] = $("variant").value; save(); render(); };
}

function syncHash() {
  history.replaceState(null, "", `#spec=${state.spec}`);
}

function chips(el, list, key) {
  el.innerHTML = list.map(([v, label, n]) =>
    `<button class="chip" data-v="${esc(v)}" aria-pressed="${state[key] === v}">${label}${n != null ? `<span class="n">${n}</span>` : ""}</button>`).join("");
  el.querySelectorAll("button").forEach((b) => (b.onclick = () => { state[key] = b.dataset.v; save(); render(); }));
}

function statChip({ stat, rank }) {
  return `<span class="stat r${rank ?? 0}" title="${esc(stat)}${rank ? ` (#${rank} for this spec)` : " (unranked)"}">${SHORT[stat]}${rank ? `<sup>#${rank}</sup>` : ""}</span>`;
}

function itemRow(it, topPair, specName) {
  const top = topPair && it.pair === topPair;
  const notes = [];
  if (it.notes.includes("no-stats-in-api")) notes.push("No stats in the game data API yet; check the tooltip in game.");
  else if (it.notes.includes("azerite-no-secondaries-in-api")) notes.push("Secondary stats not in the game data API (legacy Azerite item).");
  else if (!it.secondaryStats.length) notes.push(it.slot === "Trinket" ? "No secondary stats (on-use or proc effect)." : "No secondary stats.");
  const type = typeLabel(it) + (it.tag ? ` · ${it.tag}` : "");
  return `<li class="${top ? "top" : ""}${it.bis ? " bis" : ""}">
    <div class="name"><a href="https://www.wowhead.com/item=${it.id}" target="_blank" rel="noopener">${esc(it.name)}</a>${top ? `<span class="badge b-top" title="Best stat pair for ${esc(specName)}">Top pair</span>` : ""}${it.bis ? `<span class="badge b-bis">BiS</span>` : ""}</div>
    <div class="stats">${it.stats.map(statChip).join("")}</div>
    <div class="type">${esc(type)}</div>
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

  // Build (hero talent / content) variants of the stat priority.
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
      (spec.statNotes ? `. ${esc(spec.statNotes)}` : "")
    : "No stat priority recorded for this spec yet.";

  const pairs = rankedPairs(prio);
  const topPair = prio.length >= 2 ? pairs[0].id : null;
  const opts = { priority: prio, source: state.source, sort: state.sort };

  // Chip counts ignore their own filter so you can see what each choice yields.
  const flat = (groups) => groups.flatMap((g) => g.bosses.flatMap((b) => b.items));
  const forPairs = flat(groupForSpec(items, spec, { ...opts, slot: state.slot }));
  const forSlots = flat(groupForSpec(items, spec, { ...opts, pair: state.pair }));
  const slotCount = Object.groupBy(forSlots, slotGroup);
  const avail = SLOT_GROUPS.filter(([k]) => slotCount[k]);
  if (state.slot !== "all" && !avail.some(([k]) => k === state.slot)) state.slot = "all";

  chips($("pairs"), [["all", "All stats", null], ...pairs.map((p) =>
    [p.id, `${p.id === topPair ? "★ " : ""}${p.stats.map((s) => SHORT[s]).join(" / ")}`, forPairs.filter((i) => i.pair === p.id).length])], "pair");
  chips($("slots"), [["all", "All slots", null], ...avail.map(([k, l]) => [k, l, slotCount[k].length])], "slot");
  chips($("sources"), SOURCES.map(([k, l]) => [k, l, null]), "source");
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
      ? g.bosses.filter((b) => b.items.length).map((b) => `<h3>${esc(b.boss)}</h3><ul>${b.items.map((i) => itemRow(i, topPair, label)).join("")}</ul>`).join("")
      : `<div class="none">Nothing here for ${esc(label)}.</div>`;
    html += `</section>`;
  }
  $("list").innerHTML = html || `<div class="none">No drops match these filters.</div>`;
  $("count").textContent = `${n} item${n === 1 ? "" : "s"} shown` + (topPair ? ` · ${nTop} with the top pair` : "");

  const bis = spec.bis ?? {};
  $("foot").innerHTML =
    `<p>Stat chips are ranked for this spec: <span class="stat r1">#1</span> best, then <span class="stat r2">#2</span>, <span class="stat r3">#3</span>, <span class="stat r4">#4</span>. Highlighted rows have the spec's two best stats.</p>` +
    `<p>${bis.items?.length
      ? `BiS markers from <a href="${esc(bis.url ?? "#")}" target="_blank" rel="noopener">${esc(bis.source)}</a>, checked ${esc(bis.date)}.`
      : `BiS markers are not filled in for ${esc(label)} yet.`}</p>` +
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
