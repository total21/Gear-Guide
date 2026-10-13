# Gear-Guide

WoW gear optimizer: a Midnight Season 2 gear farm tool (web app first, in-game addon later).

## Layout

| Path | What it is |
| --- | --- |
| `config/season.json` | The season definition: region, locale, M+ dungeon names and raid names. |
| `scripts/fetch-data.mjs` | Pulls every boss drop from the Blizzard Game Data API and writes `data/`. |
| `scripts/verify-rogue.mjs` | Cross-checks `data/items.json` against the rogue farm list in `web/index.html`. |
| `scripts/build-docs.mjs` | Copies `data/*.json` into `docs/data/` for the website. |
| `scripts/check-app.mjs` | Sanity checks: curated stat data is complete and cited, equip rules hold, the rogue list is reproduced. |
| `data/items.json` | One record per (item, boss) drop. Generated; do not edit by hand. |
| `data/specs.json` | Every retail spec: class, role, armor type, primary stat, plus hand-curated stat priority and BiS. |
| `web/index.html` | Design starting point for the web app (the rogue S2 farm list page, saved unchanged). |
| `docs/` | The web app, published with GitHub Pages: `index.html`, `app.js` (page), `gear.js` (filtering and ranking), `data/` (copied by `npm run build`). |

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

- `armorType`, `primaryStat` and `weapons` are written by the fetch script. Armor type and weapons are not in the API, so they come from tables in `scripts/fetch-data.mjs` (`CLASS_ARMOR`, `SPEC_WEAPONS`). `weapons.slots` uses item inventory types: `"Off Hand"` is a shield, `"Held In Off-hand"` a caster off-hand, `"Ranged"` covers bows, guns, crossbows and wands.
- Everything from `statPriority` down is hand-curated and kept across re-runs.
  - `statPriority` is the secondary stat order, best first. `statPriorityLabel` names that build when the source gives more than one; the others go in `statVariants`, and the app offers them as a "Build" choice.
  - A spec whose full order could not be confirmed has a shorter list and says "Partial" in `statNotes` (currently Balance Druid: Mastery first, the rest unranked).
  - `statSource.checked` is the date the order was read. Change it whenever you re-check.
- `bis` marks best-in-slot items. It is empty for now. When you fill it, cite it:
  ```json
  "bis": { "source": "Icy Veins", "url": "https://...", "date": "2026-10-20", "items": [{ "id": 251130, "note": "Mythic+" }] }
  ```
  `id` is the item ID from `data/items.json`. The app shows a BiS badge on those items. `npm run check` fails if items are listed without a source and date.

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

## Web app

`docs/` is a static site with no build tooling. To run it locally:

```sh
npm run build   # copy data/*.json into docs/data/
npm run serve   # http://localhost:8000
```

Opening `docs/index.html` straight from disk will not work: browsers block loading the JSON from `file://`.

Pick a spec to see every Season 2 Mythic+ and raid drop it can use: its armor type, its primary stat (or no primary, e.g. jewelry), and weapons and off-hands it can equip. Each item's secondary stats are tagged #1 to #4 by the spec's priority. Items with the spec's two best stats are highlighted. Filter by stat pair, slot, and Mythic+ or raid, and sort by boss order or by best stats. The last spec, build choice and filters are remembered in the browser. A link like `.../#spec=260` opens a spec directly. Spec IDs are listed in `data/specs.json`.

### Publishing with GitHub Pages

GitHub serves `docs/` from the `main` branch as is. In the repository on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder: `/docs` → Save**. The site goes live at `https://<owner>.github.io/<repo>/` within a minute or two of each push to `main`. `docs/.nojekyll` turns off Jekyll processing, so files are served unchanged.

Region and locale come from `config/season.json` (`us` / `en_US`). The script uses the dynamic `static-us` namespace, so it always reads the live patch.
