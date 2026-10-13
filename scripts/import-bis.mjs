#!/usr/bin/env node
// Imports best-in-slot lists from BiS pages saved in a browser (Wowhead,
// Icy Veins or Archon) into data/specs.json, then refreshes docs/data/.
//
// Usage: node scripts/import-bis.mjs [files or folders...] [--dry-run] [--force] [--any-source] [--spec <id>]
//   Default input: bis-pages/ (every .html / .htm file in it).
//   --dry-run     parse and report, write nothing.
//   --force       import even if the page's patch/season can't be confirmed.
//   --any-source  import even if the page's site isn't the spec's chosen source.
//   --spec <id>   spec ID to use when the page URL doesn't identify it.
//
// Each page must be for the current game version: its title or text has to
// name patch >= config/bis.json "minPatch" or Midnight Season 2+, it can't be
// a PTR/beta page, and at least one listed item must be a current drop in
// data/items.json. Which site a spec takes its list from is set in
// config/bis.json ("defaultSource", "bySpec": { "<spec id>": "Icy Veins" }).

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------- parsing

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e] ?? m);
const clean = (s) => decode(s).replace(/\s+/g, " ").trim();

// The page's own URL: Chrome's "saved from url" comment, canonical link or og:url.
export function pageUrl(html) {
  return (
    html.match(/<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i)?.[1] ??
    html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1] ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)/i)?.[1] ??
    null
  );
}

export function siteOf(url, html) {
  const s = `${url ?? ""} ${html.slice(0, 5000)}`;
  if (/wowhead\.com/i.test(url ?? "")) return "Wowhead";
  if (/icy-veins\.com/i.test(url ?? "")) return "Icy Veins";
  if (/archon\.gg/i.test(url ?? "")) return "Archon";
  if (/wowhead\.com/i.test(s)) return "Wowhead";
  if (/icy-veins/i.test(s)) return "Icy Veins";
  if (/archon\.gg/i.test(s)) return "Archon";
  return null;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");

// Spec from the page URL, e.g. wowhead.com/guide/classes/rogue/outlaw/bis-gear,
// icy-veins.com/wow/outlaw-rogue-pve-dps-gear-best-in-slot,
// archon.gg/wow/builds/outlaw/rogue/mythic-plus/gear-and-tier-set/...
export function specFromUrl(url, specs) {
  if (!url) return null;
  const find = (cls, spec) => specs.find((s) => slug(s.class) === cls && slug(s.spec) === spec) ?? null;
  let m = url.match(/wowhead\.com\/(?:[a-z-]+\/)?guides?\/classes\/([a-z-]+)\/([a-z-]+)\//i);
  if (m) return find(m[1].toLowerCase(), m[2].toLowerCase());
  m = url.match(/archon\.gg\/wow\/builds\/([a-z-]+)\/([a-z-]+)\//i);
  if (m) return find(m[2].toLowerCase(), m[1].toLowerCase());
  m = url.match(/icy-veins\.com\/wow\/([a-z-]+)-pve-/i);
  if (m) return specs.find((s) => m[1].toLowerCase() === `${slug(s.spec)}-${slug(s.class)}`) ?? null;
  return null;
}

// Wowhead guides ship their body as markup inside WH.markup.printHtml("...").
// Turn it into equivalent HTML so one walker handles every site.
export function wowheadMarkupToHtml(html) {
  const out = [];
  for (const m of html.matchAll(/WH\.markup\.printHtml\(\s*"((?:[^"\\]|\\.)*)"/gi)) {
    let s;
    try { s = JSON.parse(`"${m[1]}"`); } catch { continue; }
    out.push(
      s
        .replace(/</g, "&lt;")
        .replace(/\[item=(\d+)[^\]]*\]/gi, '<a href="/item=$1"></a>')
        .replace(/\[(\/?)(h[1-6]|table|tr|td|th|tabs|tab|ul|ol|li|b)((?:\s[^\]]*)?)\]/gi, (_, sl, tag, attrs) => `<${sl}${tag}${attrs.replace(/(\w+)=([^\s"']+)/g, '$1="$2"')}>`)
        .replace(/\[[^\]]*\]/g, " "),
    );
  }
  return out.join("\n");
}

const ITEM_RE = /(?:^|[/?&#=\s])item=(\d+)/i;
const attr = (attrs, name) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(1).find((x) => x != null) ?? null;

// Walk the HTML once. Returns table rows and loose item links, each tagged with
// the section it sits in (nearest heading, or enclosing tab name).
export function walk(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const rows = [], links = [];
  let heading = "", inHeading = null, headingBuf = "";
  const tabs = [];
  let row = null, cell = null, link = null;
  const section = () => tabs.at(-1) ?? heading;
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi)) {
    if (m[4] != null) {
      const t = m[4];
      if (inHeading) headingBuf += t;
      if (cell) cell.text += t;
      if (link) link.text += t;
      for (const l of links.slice(-1)) if (l !== link) l.after += t;
      continue;
    }
    const [, close, tagRaw, attrs] = m;
    const tag = tagRaw.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      if (!close) { inHeading = tag; headingBuf = ""; }
      else if (inHeading === tag) { heading = clean(headingBuf); inHeading = null; }
      continue;
    }
    if (tag === "tab") {
      if (!close) tabs.push(clean(attr(attrs, "name") ?? attr(attrs, "title") ?? ""));
      else tabs.pop();
      continue;
    }
    if (tag === "tr") {
      if (!close) row = { section: section(), cells: [], items: [] };
      else if (row) { rows.push(row); row = null; }
      continue;
    }
    if (tag === "td" || tag === "th") {
      if (!close && row) { cell = { text: "" }; row.cells.push(cell); }
      else if (close) cell = null;
      continue;
    }
    if (close) {
      if (tag === "a" && link) { link.name = clean(link.text); link = null; }
      continue;
    }
    const ref = attr(attrs, "href") ?? attr(attrs, "data-wowhead") ?? "";
    const id = ref.match(ITEM_RE)?.[1] ?? attr(attrs, "data-wowhead")?.match(/^item=(\d+)/)?.[1];
    if (!id) continue;
    const l = { id: +id, name: "", text: "", after: "", section: section(), inRow: !!row };
    links.push(l);
    if (row) row.items.push(l);
    if (tag === "a") link = l;
  }
  for (const r of rows) for (const c of r.cells) c.text = clean(c.text);
  for (const l of links) { l.name ||= clean(l.text); l.after = clean(l.after).slice(0, 200); }
  return { rows, links };
}

const BIS_SECTION = /best[\s-]*in[\s-]*slot|\bbis\b/i;
const NOT_BIS = /alternative|tier list|ranking|trinket (?:tier|ranking)|enchant|gem|consumable/i;

export function listName(section) {
  if (/raid/i.test(section)) return "Raid";
  if (/mythic|m\+|dungeon/i.test(section)) return "Mythic+";
  return "Overall";
}

// BiS entries from a walked page: rows in BiS sections (Wowhead, Icy Veins),
// or, for Archon, item links followed by a "BiS" flag.
export function extractBis(walked, site) {
  const out = [];
  for (const r of walked.rows) {
    if (!BIS_SECTION.test(r.section) || NOT_BIS.test(r.section) || !r.items.length) continue;
    const it = r.items[0];
    const slot = r.cells[0]?.text && !r.cells[0].text.includes(it.name || "\u0000") ? r.cells[0].text : null;
    out.push({ id: it.id, name: it.name || r.cells[1]?.text || null, slot, list: listName(r.section) });
  }
  if (!out.length && site === "Archon")
    for (const l of walked.links)
      if (/\bBiS\b/i.test(l.after.split(/\bitem=/)[0])) out.push({ id: l.id, name: l.name || null, slot: null, list: listName(l.section) });
  return out;
}

// ---------------------------------------------------------------- version check

const cmpPatch = (a, b) => {
  const [x, y] = [a, b].map((p) => p.split(".").map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

export function versionOf(html, url) {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const text = clean(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")) + " " + wowheadMarkupToHtml(html);
  const patches = [
    ...[...title.matchAll(/(?:^|[\s(—-])(1\d\.\d+(?:\.\d+)?)(?=[\s)—-]|$)/g)].map((m) => m[1]),
    ...[...text.matchAll(/\bpatch\s+(1\d\.\d+(?:\.\d+)?)\b/gi)].map((m) => m[1]),
  ];
  const seasons = [...text.matchAll(/\bMidnight\s+Season\s+(\d+)/gi)].map((m) => +m[1]);
  return {
    title,
    patch: patches.sort(cmpPatch).at(-1) ?? null,
    season: seasons.length ? Math.max(...seasons) : null,
    preview: /\/(?:ptr|beta)(?:-\d+)?\/|beta-mythic-plus|\bptr\b/i.test(url ?? "") || /\b(PTR|Beta)\b/.test(title),
  };
}

export function versionOk(v, minPatch) {
  if (v.preview) return { ok: false, why: "PTR/beta page" };
  if (v.patch && cmpPatch(v.patch, minPatch) >= 0) return { ok: true, why: `patch ${v.patch}` };
  if (v.season >= 2) return { ok: true, why: `Midnight Season ${v.season}` };
  return { ok: false, why: v.patch ? `patch ${v.patch} is older than ${minPatch}` : v.season ? `Season ${v.season} only` : "no patch or season found on the page" };
}

// ---------------------------------------------------------------- import

// Merge raw entries into spec BiS items: one per item ID, with every list it
// appears in. Names come from items.json for current drops.
export function toBisItems(entries, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const merged = new Map();
  for (const e of entries) {
    const drop = byId.get(e.id);
    const m = merged.get(e.id) ?? { slot: e.slot ?? drop?.slot ?? null, name: drop?.name ?? e.name ?? `Item ${e.id}`, id: e.id, lists: [] };
    if (!m.lists.includes(e.list)) m.lists.push(e.list);
    merged.set(e.id, m);
  }
  return [...merged.values()];
}

// Names for BiS items that aren't Season drops (crafted, tier) when the page
// didn't include them, from the Blizzard API. Same auth as fetch-data.mjs;
// on any failure the "Item <id>" placeholder stays.
async function lookUpNames(bisItems, region = "us", locale = "en_US") {
  const missing = bisItems.filter((b) => b.name === `Item ${b.id}`);
  if (!missing.length) return;
  try {
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    const { BLIZZARD_CLIENT_ID: id, BLIZZARD_CLIENT_SECRET: secret } = process.env;
    if (id && secret) headers.Authorization = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://oauth.battle.net/token", { method: "POST", headers, body: "grant_type=client_credentials" });
    if (!res.ok) throw new Error(`token HTTP ${res.status}`);
    const token = (await res.json()).access_token;
    for (const b of missing) {
      const r = await fetch(`https://${region}.api.blizzard.com/data/wow/item/${b.id}?namespace=static-${region}&locale=${locale}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) b.name = (await r.json()).name ?? b.name;
    }
  } catch (e) {
    console.warn(`  (couldn't look up ${missing.length} item name(s): ${e.message})`);
  }
}

async function inputs(args) {
  const files = [];
  for (const a of args.length ? args : [path.join(ROOT, "bis-pages")]) {
    const st = await stat(a).catch(() => null);
    if (!st) { console.warn(`Not found: ${a}`); continue; }
    if (st.isDirectory()) for (const f of (await readdir(a)).sort()) { if (/\.html?$/i.test(f)) files.push(path.join(a, f)); }
    else files.push(a);
  }
  return files;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const DRY = flag("--dry-run"), FORCE = flag("--force"), ANY = flag("--any-source");
  let specOverride = null;
  const si = argv.indexOf("--spec");
  if (si >= 0) { specOverride = +argv[si + 1]; argv.splice(si, 2); }

  const cfg = JSON.parse(await readFile(path.join(ROOT, "config/bis.json"), "utf8"));
  const specsFile = path.join(ROOT, "data/specs.json");
  const specsData = JSON.parse(await readFile(specsFile, "utf8"));
  const { items } = JSON.parse(await readFile(path.join(ROOT, "data/items.json"), "utf8"));
  const dropIds = new Set(items.map((i) => i.id));
  const today = new Date().toISOString().slice(0, 10);
  let changed = 0, failed = 0;

  for (const file of await inputs(argv)) {
    const name = path.relative(ROOT, file);
    const html = await readFile(file, "utf8");
    const url = pageUrl(html);
    const site = siteOf(url, html);
    const spec = specOverride ? specsData.specs.find((s) => s.id === specOverride) : specFromUrl(url, specsData.specs);
    const fail = (why) => { failed++; console.log(`✗ ${name}: ${why}`); };
    if (!site) { fail("can't tell which site this page is from"); continue; }
    if (!spec) { fail(`can't tell the spec from the URL (${url ?? "none found"}); pass --spec <id>`); continue; }
    const want = cfg.bySpec?.[spec.id] ?? cfg.defaultSource;
    if (site !== want && !ANY) { fail(`${spec.spec} ${spec.class} takes BiS from ${want}, this page is ${site} (use --any-source or config/bis.json)`); continue; }
    const v = versionOf(html, url);
    const vc = versionOk(v, cfg.minPatch);
    if (!vc.ok && !FORCE) { fail(`not confirmed as ${cfg.minPatch}+: ${vc.why} (title: "${v.title}")`); continue; }

    const entries = extractBis(walk(html + "\n" + wowheadMarkupToHtml(html)), site);
    const bisItems = toBisItems(entries, items);
    const drops = bisItems.filter((b) => dropIds.has(b.id));
    if (!bisItems.length) { fail("no BiS table found on the page"); continue; }
    if (!drops.length && !FORCE) { fail(`none of its ${bisItems.length} BiS items is a current Season drop; the page may be stale`); continue; }

    if (!DRY) await lookUpNames(bisItems);
    const lists = [...new Set(bisItems.flatMap((b) => b.lists))];
    console.log(`✓ ${name}: ${spec.spec} ${spec.class} from ${site} (${vc.why}${vc.ok ? "" : ", forced"}): ` +
      `${bisItems.length} items in ${lists.join(" / ")}, ${drops.length} of them Season drops`);
    spec.bis = { source: site, url: url ?? null, date: today, patch: v.patch ?? (v.season ? `Midnight Season ${v.season}` : null), items: bisItems };
    changed++;
  }

  if (!changed) { console.log(failed ? "Nothing imported." : "No saved pages found (put them in bis-pages/)."); process.exit(failed ? 1 : 0); }
  if (DRY) { console.log(`Dry run: ${changed} spec(s) would be updated.`); process.exit(failed ? 1 : 0); }
  await writeFile(specsFile, JSON.stringify(specsData, null, 2) + "\n");
  console.log(`Updated ${changed} spec(s) in data/specs.json.`);
  execFileSync(process.execPath, [path.join(ROOT, "scripts/build-docs.mjs")], { stdio: "inherit" });
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
