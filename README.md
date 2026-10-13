# Gear-Guide

WoW gear optimizer: a Midnight Season 2 gear farm tool (web app first, in-game addon later).

## Layout

| Path | What it is |
| --- | --- |
| `config/season.json` | The season definition: region, locale, M+ dungeon names and raid names. |
| `scripts/fetch-data.mjs` | Pulls every boss drop from the Blizzard Game Data API and writes `data/`. |
| `scripts/verify-rogue.mjs` | Cross-checks `data/items.json` against the rogue farm list in `web/index.html`. |
| `data/items.json` | One record per (item, boss) drop. Generated; do not edit by hand. |
| `data/specs.json` | Every retail spec: class, role, armor type, primary stat, plus hand-curated stat priority and BiS. |
| `web/index.html` | Design starting point for the web app (the rogue S2 farm list page, saved unchanged). |

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
  - `azerite-no-secondaries-in-api`: legacy BfA head, shoulder and chest pieces (Kings' Rest, Temple of Sethraliss) are Azerite armor in the item data. The API returns them with no secondaries, so their in-season stats have to be filled in from another source.
  - `no-stats-in-api`: the API returned no stats at all.

`data/specs.json` → `specs[]`: `statPriority` (array) and `bis` (`{ source, date, items }`) start empty. The fetch script keeps them across re-runs, so curated data is safe.

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
4. **Verify:** run `npm run verify`, then review `git diff data/` before committing. A new patch typically shows up as changed item IDs, retuned secondary stats, or added bosses.

Region and locale come from `config/season.json` (`us` / `en_US`). The script uses the dynamic `static-us` namespace, so it always reads the live patch.
