# Gear-Guide

WoW gear optimizer: a Midnight Season 2 gear farm tool (web app first, in-game addon later).

## Layout

| Path | What it is |
| --- | --- |
| `config/season.json` | The season definition: region, locale, M+ dungeon and raid names, class tier set IDs (`tierSets`), and nicknames for bosses used in pasted BiS sources (`bossAliases`). |
| `scripts/fetch-data.mjs` | Pulls every boss drop from the Blizzard Game Data API and writes `data/`. |
| `scripts/verify-rogue.mjs` | Cross-checks `data/items.json` against the rogue farm list in `web/index.html`. |
| `scripts/build-docs.mjs` | Copies `data/*.json` into `docs/data/` for the website. |
| `scripts/import-bis.mjs` | Imports BiS lists from pasted Wowhead table text or saved pages (see "Best in slot lists"). |
| `scripts/resolve-bis.mjs` | Links BiS tier pieces to their set, raid token and catalyst source drop (runs after every import and fetch). |
| `data/tier.json` | Season class tier sets (pieces and slots) and raid tier tokens, from the API. Generated. |
| `data/crafting.json` | The expansion's crafting recipes (profession, category, base reagents, optional reagent slots, crafted item and its built-in effects) and the reagents that count as embellishments, from the API's profession and recipe endpoints. Generated; refresh alone with `node scripts/fetch-data.mjs --crafting-only`. Not copied to `docs/`: the resolver copies what the app needs into `specs.json`. |
| `scripts/check-import.mjs` | Tests for the importer, against hand-written samples in `scripts/fixtures/bis/`. |
| `config/bis.json` | Which site each spec takes its BiS list from, and the minimum patch accepted. |
| `scripts/check-app.mjs` | Sanity checks: curated stat data is complete and cited, equip rules hold, the rogue list is reproduced. |
| `data/items.json` | One record per (item, boss) drop. Generated; do not edit by hand. |
| `data/specs.json` | Every retail spec: class, role, armor type, primary stat, plus hand-curated stat priority and BiS. |
| `web/index.html` | Design starting point for the web app (the rogue S2 farm list page, saved unchanged). |
| `docs/` | The web app, published with GitHub Pages: `index.html`, `app.js` (page), `gear.js` (filtering and ranking), `character.js` (the player's gear: SimC parsing, imports, the farm plan), `data/` (copied by `npm run build`). |

## Data shape

`data/items.json` → `items[]`:

```json
{
  "id": 251130, "name": "Breeches of Deft Deals",
  "instance": "Murder Row", "instanceId": 1304, "instanceType": "DUNGEON",
  "boss": "Zaen Bladesorrow", "encounterId": 2680,
  "slot": "Legs", "itemClass": "Armor", "armorType": "Leather", "weaponType": null,
  "primaryStats": ["Intellect", "Agility"],
  "secondaryStats": ["Critical Strike", "Mastery"],
  "quality": "EPIC", "tag": null, "notes": []
}
```

- Only stat **types** are stored. Values scale with item level (especially on legacy items), so they are not useful here.
- `primaryStats` lists every primary the item can provide (e.g. Int/Agi leather), including the one the API marks inactive for its preview spec.
- `armorType` is `null` for necks, rings, trinkets and cloaks (anyone can wear them).
- Recipes, housing décor, mounts and cosmetics are skipped. An item the journal lists twice under one boss is stored once.
- `effects` lists on-use, proc and equip effects as `{ name, text }`, e.g. `"Use: ... increasing your Critical Strike by 48 for 15 sec."`. Numbers in the text are for `previewItemLevel`, the item level the API previews, not the in-season one.
- `tag` holds the item's subtitle when there is one, e.g. `"Venomcursed"` for raid items with a single secondary plus a proc.
- `notes` flags gaps in the API data:
  - `azerite-no-secondaries-in-api`: legacy BfA head, shoulder and chest pieces (Kings' Rest, Temple of Sethraliss) are Azerite armor in the item data. The API returns them with no secondaries. Each one also has a current re-issue under the same boss, with a new item ID and real secondaries, so the app hides the old copy (see below).
  - `no-stats-in-api`: the API returned no stats at all.

`data/specs.json` → `specs[]`:

```json
{
  "id": 250, "class": "Death Knight", "spec": "Blood", "role": "TANK",
  "armorType": "Plate", "primaryStat": "Strength",
  "weapons": { "slots": ["Two-Hand"], "types": ["Axe", "Mace", "Sword", "Polearm"] },
  "statPriority": ["Haste", "Critical Strike", "Mastery", "Versatility"],
  "statPriorityLabel": "San'layn",
  "statVariants": [{ "label": "Deathbringer", "priority": ["Critical Strike", "Mastery", "Versatility", "Haste"] }],
  "statNotes": "San'layn wants Haste up to about 30% unbuffed; Deathbringer avoids Haste.",
  "statSource": { "site": "Icy Veins", "url": "https://www.icy-veins.com/wow/blood-death-knight-pve-tank-stat-priority",
                  "patch": "12.1", "checked": "2026-10-13", "via": "web search (site not reachable from the build environment)" },
  "bis": { "source": null, "url": null, "date": null, "items": [] }
}
```

- `armorType`, `primaryStat`, `weapons` and `heroTalents` (the spec's two hero talent trees, from the API) are written by the fetch script. Armor type and weapons are not in the API, so they come from tables in `scripts/fetch-data.mjs` (`CLASS_ARMOR`, `SPEC_WEAPONS`). `weapons.slots` uses item inventory types: `"Off Hand"` is a shield, `"Held In Off-hand"` a caster off-hand, `"Ranged"` covers bows, guns, crossbows and wands.
- Everything from `statPriority` down is hand-curated and kept across re-runs.
  - `statPriority` is the secondary stat order, best first. `statPriorityLabel` names that build when the source gives more than one; the others go in `statVariants`, and the app offers them as a "Build" choice.
  - A spec whose full order could not be confirmed has a shorter list and says "Partial" in `statNotes` (currently Balance Druid: Mastery first, the rest unranked).
  - `statSource.checked` is the date the order was read. Change it whenever you re-check.
- `bis` is the spec's best-in-slot list, written by `npm run import-bis` (see below):
  ```json
  "bis": { "source": "Wowhead", "url": "https://www.wowhead.com/guide/classes/rogue/outlaw/bis-gear",
           "date": "2026-10-20", "patch": "12.1.5",
           "items": [{ "slot": "Neck", "name": "Aqirbane Reliquary", "id": 268265, "lists": ["Overall", "Mythic+"] }] }
  ```
  `bisByHero` holds lists for a single hero talent, keyed by its name: `{ "Deathbringer": { ...same shape... } }`. A hero talent uses its own list if it has one, otherwise the shared `bis`. Likewise `heroStatPriority` (`{ "Deathbringer": [...] }`) overrides `statPriority` for one hero talent.
  `id` is the item ID, or `null` for pasted items that aren't Season drops. Those also keep `source` ("Crafting", a boss for tier pieces) and `crafting` (embellishments or reagents listed in parentheses). Items that aren't in `data/items.json` are kept and shown in their own sections: tier, crafted, and other. `lists` says which of the page's lists it's on: `Overall`, `Raid`, `Mythic+`. `npm run check` fails if a listed drop's name doesn't match its ID or the spec can't use it.

The journal lists each legacy BfA Azerite piece from Kings' Rest and Temple of Sethraliss twice: the old item with no secondaries in the API, and its current re-issue with real stats. The app shows only the re-issue.

## Re-running each patch

Requirements: Node 22.21+ (no npm dependencies).

1. **Credentials.** Create a client at <https://develop.battle.net/access/clients> and export them. Never commit them; `.env` is git-ignored.
   ```sh
   export BLIZZARD_CLIENT_ID=...
   export BLIZZARD_CLIENT_SECRET=...
   ```
   In an environment where a proxy injects the Battle.net credentials, leave these unset. Also set `NODE_USE_ENV_PROXY=1` so Node's `fetch` honors `HTTPS_PROXY`.
2. **Update `config/season.json`** if the season changed: dungeon pool, raid(s), region. Names must match the Encounter Journal exactly. To list valid names:
   ```sh
   curl -H "Authorization: Bearer $TOKEN" \
     "https://us.api.blizzard.com/data/wow/journal-expansion/505?namespace=static-us&locale=en_US"
   ```
   Expansion `505` is the journal's "Current Season" tab, which lists the season's dungeons and raids.
3. **Fetch:**
   ```sh
   npm run fetch          # items.json + specs.json
   npm run fetch:specs    # specs.json only
   ```
   The script resolves instance IDs by name, so new patches need no ID changes. It warns about any drop missing secondaries in the API.
4. **Verify:** run `npm run verify` and `npm run check`, then review `git diff data/` before committing. A new patch typically shows up as changed item IDs, retuned secondary stats, or added bosses. `npm run fetch` also refreshes `docs/data/`; after editing `data/specs.json` by hand, run `npm run build`.

## Best in slot lists

`npm run import-bis` reads every `.txt` and `.html` file in `bis-pages/` (git-ignored) and writes each spec's `bis` list. Preview with `npm run import-bis -- --dry-run`, then run `npm run check` and commit `data/specs.json` and `docs/data/`.

### Pasted text (quickest)

1. On the spec's Wowhead BiS page (`https://www.wowhead.com/guide/classes/<class>/<spec>/bis-gear`), check it's for Patch 12.1+ / Midnight Season 2.
2. Select a BiS table (Slot, Item, Source) and copy it. Paste it into a text file in `bis-pages/` named after the spec, e.g. `outlaw-rogue.txt` or `260.txt`. Put several tables in one file with a heading line before each:
   ```
   Patch 12.1.5
   Overall BiS
   Slot	Item	Source
   Head	Gaze of the Coiled Watcher	Ula'tek (The Venomous Abyss)
   Chest	Chosen Bloodslayer's Vest	Tier / Catalyst
   Mythic+ BiS
   Hands	Gauntlets of Fevered Defense	Kystia Manaheart (Murder Row)
   ```
   Start with `Spec: Blood Death Knight`, and add `Hero: Deathbringer` when the list is only for one hero talent (leave it out when both share it). The `Patch` line is optional; if present it must be 12.1 or later. Names Wowhead repeats ("Spellbreaker's Bracers Spellbreaker's Bracers") are collapsed, and parentheses in the Slot or Item column ("Ring (Prismatic Focusing Iris)") are kept as the item's crafting note. Headings containing "Raid" or "Mythic+" start those lists. Anything else is "Overall".

Each line is matched by finding the name of a Season drop the spec can use inside it, so the spacing between columns doesn't matter. Lines that name no drop but start with a slot (crafted, tier, catalyst) are kept as "not from Season drops". With tabs between columns their name is exact; with single spaces the source text stays attached to it. The importer prints every non-drop and every skipped line, so check the output. A file where no line names a usable Season drop is rejected as probably stale.

### Saved pages

Pages saved with Ctrl+S / Cmd+S → "Webpage, HTML only" also work, from Wowhead, Icy Veins or Archon. The importer:
- reads the page URL saved in the file to tell the site and spec (`--spec <id>` if it can't);
- skips pages from a site other than the spec's chosen source. The default is Wowhead; set others per spec in `config/bis.json`, e.g. `"bySpec": { "260": "Icy Veins" }`, or pass `--any-source`;
- rejects pages it can't confirm as current: PTR/beta pages, pages whose title or text names nothing newer than `minPatch` (12.1) or Midnight Season 2, and pages where no BiS item is a current Season drop. `--force` overrides;
- reads the Overall / Raid / Mythic+ BiS tables (not trinket tier lists, alternatives, gems or enchants). For Archon, it takes items flagged "BiS";
- looks up missing item names in the Blizzard API.

The saved-page parser was written without access to the real pages and is tested only against hand-made samples in `scripts/fixtures/bis/`. If a real page imports badly, add it as a fixture and adjust `scripts/import-bis.mjs`.

### Tier pieces and the catalyst

`npm run resolve-bis` (also run by `import-bis` and `fetch`) looks up every BiS item that belongs to the class's tier set in `data/tier.json` and adds:
- `id`, `slot` (the API's slot, whatever the paste said) and `tier` (the set name);
- `token` / `curio`: the raid token for that slot and class (e.g. Venomcast Effigy from The Twin Fangs for mail heads) and the any-slot Slumbering Coil Curio from Ula'tek;
- `catalyst`: which Season drop(s) to convert, when Wowhead's Source names a dungeon or boss other than the token's boss, or says "Catalyst" ("Catalyst the Kith'ix Gloves" → Aberrant Commander's Gauntlets from Kith'ix). With "Catalyst" or "Tier Set" but no place it's `{ any: "Mail Head" }` (convert any Season drop in that slot). Those source drops are added to the BiS list with the note "Catalyze into <tier piece>", so they get the BiS badge.

Off-set pieces, which share the set's name but sit outside the five token slots (e.g. Damned Necrolyte's Shackles, a wrist), get `tier`, `offSet: true` and a `catalyst` route only. They come from the Catalyst, not a token.

Crafted items, matched by name to a recipe in `data/crafting.json`, get their `id` and a `crafted` object with these fields:
- `profession`, `category`;
- `reagents`: the base reagents and quantities;
- `optional`: the optional reagent slots;
- `embellishable`, `customStats`: whether the recipe has an "Add Embellishment" or "Customize Secondary Stats" slot;
- `builtIn`: the effects of items that come embellished;
- `embellishments` and `otherReagents`: the reagents Wowhead names in parentheses, split by whether the "Add Embellishment" slot accepts them, each with the profession that makes it.

Boss names in pasted sources are matched loosely (one typo per word), and nicknames go in `bossAliases` in `config/season.json`. New season: update `tierSets` with the new set IDs (`/data/wow/item-set/index`, the highest IDs) and run `npm run fetch`.

## Web app

`docs/` is a static site with no build tooling. To run it locally:

```sh
npm run build   # copy data/*.json into docs/data/
npm run serve   # http://localhost:8000
```

Opening `docs/index.html` straight from disk will not work: browsers block loading the JSON from `file://`.

The page uses a dark theme.

**Landing page.** It opens on a landing page with the name, the spec, hero talent and build pickers, the spec's stat priority, and the stat buttons. The stat buttons start on the spec's two best stats. **Show gear** opens the list on M+ and raid drops with the chosen stats, whatever view was open last.

**The list.** It shows every Season 2 Mythic+ and raid drop the spec can use: its armor type, its primary stat (or no primary, e.g. jewelry), and the weapons and off-hands it can equip.
- **Stats:** each item's secondary stats are tagged #1 to #4 by the spec's priority. Items with the two best stats are highlighted and badged "Best stats".
- **Trinkets** show the base primary stat they give the spec.
- **Effects** are labeled "On use" or "Proc" rather than spelled out.
- **Tooltips:** item links get Wowhead's hover tooltips and icons from Wowhead's tooltip script (`wow.zamimg.com/js/tooltips.js`). Without it, the links still open Wowhead.
- **BiS items** are badged, with "Mythic+" or "Raid" when they're only on that list.

**Filters.**
- **Stat buttons:** All stats, then the four secondaries in the spec's priority order. Each button toggles; with two selected the list shows items with both, and a third choice replaces the oldest.
- Then slot. Weapons are split into One-Hand (including main-hands and wands), Two-Hand (including bows, guns and crossbows) and Off Hand (shields and held-in-off-hand items). A chip only appears when the spec has drops for it.
- Then Mythic+, raid or Best in Slot.

**Best in Slot view.** Picking Best in Slot clears the stat and slot filters. Choosing a stat or slot afterwards goes back to all Season drops. The view shows the list as worn, one row per slot in paper-doll order: two rings, two trinkets, and one two-hander or a main hand plus off hand. It takes the first pick per slot from Wowhead's Overall list. Later picks are Wowhead's alternates, such as situational trinkets, extra rings or a second weapon setup. They go in a **Situational BiS** section below, with Wowhead's reason (e.g. "Defense", "for M+") and a note to sim your character. In the other views they're badged "BiS · Situational".
- **Season drops** show their stats and where they drop.
- **Tier pieces** show one route, badged Token or Catalyst. **Token** means the BiS piece comes from the raid token or the any-slot curio; the row shows the stats it comes with (`tokenStats`, from the API). **Catalyst** names the exact drop to catalyze and the stats the piece keeps from it. Wowhead's pick decides the route. Where Wowhead allows any drop in the slot, the row names the best-stat drop for the selected priority. It names at most two when they tie, and it picks the token when the token piece's own stats are as good.
- **Crafted items** show their profession. The resolver also keeps the recipe's embellishments and reagents in `crafted` for a later gems, enchants and embellishments section.

In the other views, BiS badges mark the worn items and the drops to catalyze into their tier pieces.

**Links and memory.** The last spec, build choice and filters are remembered in the browser. A link like `.../#spec=260` opens a spec's list directly; the "Gear Guide" link goes back to the landing page. Spec IDs are listed in `data/specs.json`.

### My character

The **My character** tab next to the farm list tracks the gear a player already has. The site stays fully static: no server, no accounts. There are two ways to fill it in:
- **SimulationCraft:** paste the `/simc` export from the SimulationCraft addon, the community standard. Equipped gear and gear in bags count as acquired; Great Vault choices don't.
- **By hand:** every item in the farm list, the Best in Slot view and the character page has a **+ Owned** button, which toggles to **✓ Owned**. Gear the SimC import shows the character wearing also gets an **Equipped** badge.

Loading a character switches the list to its spec. A later import replaces what the previous import brought in, but keeps items ticked by hand. Tabards and shirts are skipped.

What it does with that gear:
- **Farm list:** acquired items are hidden. **Hide owned** turns that off; acquired items then show dimmed.
- **Best in Slot view:** shows "N of 16 collected".
- **Character page:** three sections:
  - **Best in Slot checklist:** for the selected spec and hero talent, with your item level for each piece you have.
  - **Where to farm:** the missing BiS items grouped by dungeon, raid, Crafting or Catalyst, with the most items first.
  - **Acquired:** everything acquired, with the item level and where it came from.

The character is saved in the browser only (`localStorage`, key `gear-guide:character:v1`).

### Publishing with GitHub Pages

GitHub serves `docs/` from the `main` branch as is. In the repository on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder: `/docs` → Save**. The site goes live at `https://<owner>.github.io/<repo>/` within a minute or two of each push to `main`. `docs/.nojekyll` turns off Jekyll processing, so files are served unchanged.

Region and locale come from `config/season.json` (`us` / `en_US`). The script uses the dynamic `static-us` namespace, so it always reads the live patch.
