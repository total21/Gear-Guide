// Armory lookup for the Gear Guide site: a Cloudflare Worker that holds the
// Blizzard API client credentials (which a static site can't keep secret)
// and returns a character's profile and equipped gear.
//
//   GET /character/{region}/{realm-slug}/{name}
//   -> { name, realm, region, className, specName, level, itemLevel,
//        items: [{ id, slot, name, ilvl }] }
//
// Secrets (wrangler secret put ...): BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET.
// Optional var ALLOW_ORIGIN (e.g. https://total21.github.io); default "*".
// See README.md, "Armory lookup".

const REGIONS = new Set(["us", "eu", "kr", "tw"]);
let cached = { token: null, expires: 0 };

async function token(env) {
  if (cached.token && Date.now() < cached.expires) return cached.token;
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (env.BLIZZARD_CLIENT_ID && env.BLIZZARD_CLIENT_SECRET)
    headers.Authorization = "Basic " + btoa(`${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`);
  const res = await fetch("https://oauth.battle.net/token", { method: "POST", headers, body: "grant_type=client_credentials" });
  if (!res.ok) throw new Error(`token: HTTP ${res.status}`);
  const body = await res.json();
  // Renew a minute early.
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };
  return cached.token;
}

export default {
  async fetch(request, env = {}) {
    const cors = { "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*", "Content-Type": "application/json" };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: cors });
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET" } });
    const m = new URL(request.url).pathname.match(/^\/character\/([a-z]{2})\/([a-z0-9-]+)\/([^/]+)$/);
    if (request.method !== "GET" || !m || !REGIONS.has(m[1])) return reply(404, { error: "Use /character/{region}/{realm}/{name}" });
    const [, region, realm, rawName] = m;
    const name = decodeURIComponent(rawName).toLowerCase();
    try {
      const auth = { headers: { Authorization: `Bearer ${await token(env)}` } };
      const base = `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}`;
      const q = `?namespace=profile-${region}&locale=en_US`;
      const [p, e] = await Promise.all([fetch(base + q, auth), fetch(base + "/equipment" + q, auth)]);
      if (p.status === 404) return reply(404, { error: "Character not found. Check the realm and name, and that the character has logged in recently." });
      if (!p.ok || !e.ok) return reply(502, { error: `Armory error (HTTP ${p.ok ? e.status : p.status})` });
      const [profile, gear] = [await p.json(), await e.json()];
      return reply(200, {
        name: profile.name, realm: profile.realm?.name ?? realm, region,
        className: profile.character_class?.name ?? null, specName: profile.active_spec?.name ?? null,
        level: profile.level ?? null, itemLevel: profile.equipped_item_level ?? null,
        items: (gear.equipped_items ?? []).map((i) => ({ id: i.item.id, slot: i.slot?.name ?? null, name: i.name, ilvl: i.level?.value ?? null })),
      });
    } catch (err) {
      return reply(502, { error: `Armory lookup failed (${err.message})` });
    }
  },
};
