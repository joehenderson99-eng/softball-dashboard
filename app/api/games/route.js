// app/api/games/route.js
export const runtime = "nodejs";

const ESPN_SCOREBOARD =
  "https://site.web.api.espn.com/apis/site/v2/sports/baseball/college-softball/scoreboard";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "softball-dashboard/1.0" },
    // Vercel edge/CDN can cache a bit; for live-ish scores you can keep it dynamic:
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Upstream failed ${res.status} for ${url}`);
  return res.json();
}

function normalizeStatus(s) {
  const up = (s || "").toUpperCase();
  if (up.includes("FINAL")) return "FINAL";
  if (up.includes("LIVE") || up.includes("IN PROGRESS") || up.includes("INPROGRESS")) return "LIVE";
  return "SCHEDULED";
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function getSeasonRange(now = new Date()) {
  // Softball "season-ish" window: Feb 1 -> Aug 1.
  const y = now.getFullYear();
  const feb1 = new Date(y, 1, 1);
  const aug1 = new Date(y, 7, 1);

  if (now > aug1) {
    return { start: startOfDay(new Date(y + 1, 1, 1)), end: endOfDay(new Date(y + 1, 7, 1)) };
  }
  if (now < feb1) {
    return { start: startOfDay(feb1), end: endOfDay(aug1) };
  }
  return { start: startOfDay(now), end: endOfDay(aug1) };
}

function computeRange(range) {
  const now = new Date();
  let startDate, endDate;

  if (range === "today") {
    startDate = startOfDay(now);
    endDate = endOfDay(now);
  } else if (range === "week") {
    startDate = startOfDay(now);
    endDate = endOfDay(addDays(now, 7));
  } else if (range === "month" || range === "30") {
    startDate = startOfDay(now);
    endDate = endOfDay(addDays(now, 30));
  } else if (range === "season") {
    const r = getSeasonRange(now);
    startDate = r.start;
    endDate = r.end;
  } else {
    startDate = startOfDay(now);
    endDate = endOfDay(addDays(now, 7));
  }

  return { startDate, endDate };
}

function yyyymmdd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// --- TEAM NORMALIZATION ---
//
// ESPN often returns "Princeton Tigers", "Santa Clara Broncos", etc.
// This function tries hard to convert to just the school name.
//
// Strategy:
// 1) normalize punctuation/dashes/whitespace
// 2) apply aliases (Cal -> California, Sac State -> Sacramento State, etc.)
// 3) strip mascot words by matching the "school portion":
//    - if the name has 2+ words and last word is likely a mascot (plural/known patterns),
//      remove trailing mascot chunk.
//    - also handle "State", "St.", "University" cases carefully.
function normalizeTeamName(name) {
  if (!name) return "";

  let n = String(name)
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");

  const ALIASES = new Map([
    ["Cal", "California"],
    ["Boise St", "Boise State"],
    ["Sac State", "Sacramento State"],
    ["Sacramento St", "Sacramento State"],
    ["Idaho St", "Idaho State"],
    ["Fresno St", "Fresno State"],
    ["SC State", "South Carolina State"],
    ["Nebraska Kearney", "Nebraska-Kearney"],
    ["Nebraska–Kearney", "Nebraska-Kearney"],
    ["CSU Stanislaus", "Stanislaus State"],
    ["Stanislaus St", "Stanislaus State"],
    ["San José State", "San Jose State"]
  ]);
  if (ALIASES.has(n)) n = ALIASES.get(n);

  // If already a short school-like name, return it
  if (n.split(" ").length <= 2) return n;

  // Common mascot-ish endings (very safe heuristics)
  // - Plurals: Tigers, Broncos, Hornets, Ducks, etc.
  // - Single-word mascots typically end with "s" (not always, but often)
  // We'll strip only the LAST word if it looks like a mascot, keeping the school part.
  const parts = n.split(" ");
  const last = parts[parts.length - 1];

  const looksLikeMascot =
    /^[A-Z][a-z]+s$/.test(last) || // Tigers, Broncos, Hornets, Ducks...
    /^(Aggies|Tigers|Broncos|Hornets|Ducks|Beavers|Bruins|Huskies|Spartans|Tommies|Boilermakers|Royals|Rebels|Volunteers|Sooners|Gators|Seminoles|Tar\s?Heels|Wildcats|Panthers|Cowgirls|Lions|Bison|Ospreys|Knights|Seahawks|Roadrunners|Shockers|Badgers|Blazers|Great\s?Danes|Warhawks|Retrievers|Ragin'\s?Cajuns)$/i.test(
      last
    );

  if (looksLikeMascot) {
    // Strip only the mascot word
    n = parts.slice(0, -1).join(" ");
  }

  // Re-apply aliases once more after stripping
  n = n.replace(/\s+/g, " ").trim();
  if (ALIASES.has(n)) n = ALIASES.get(n);

  return n;
}

function extractEspnGames(payload) {
  const games = [];
  const events = payload?.events || [];

  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home?.team || !away?.team) continue;

    // IMPORTANT:
    // shortDisplayName is usually the SCHOOL without mascot (best for your filtering).
    const homeName =
      home.team.shortDisplayName || home.team.displayName || home.team.name || home.team.abbreviation;
    const awayName =
      away.team.shortDisplayName || away.team.displayName || away.team.name || away.team.abbreviation;

    if (!homeName || !awayName) continue;

    const startTime = comp?.date || ev?.date || null;
    const status = normalizeStatus(comp?.status?.type?.description || comp?.status?.type?.name);

    const homeScore = home?.score != null ? Number(home.score) : null;
    const awayScore = away?.score != null ? Number(away.score) : null;

    const homeRank = home?.curatedRank?.current ?? null;
    const awayRank = away?.curatedRank?.current ?? null;

    const gameUrl =
      ev?.links?.find((l) => l?.rel?.includes("desktop"))?.href || ev?.links?.[0]?.href || null;

    const id =
      ev?.id ||
      `${awayName}-${homeName}-${startTime || ""}`.replace(/\s+/g, "_");

    games.push({
      id: `espn_${id}`,
      startTime,
      status,
      homeTeam: normalizeTeamName(homeName),
      awayTeam: normalizeTeamName(awayName),
      homeScore,
      awayScore,
      gameUrl,
      boxUrl: gameUrl,
      watchUrl: gameUrl,
      homeRank,
      awayRank
    });
  }

  return games;
}

async function fetchInBatches(urls, batchSize = 10) {
  const out = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((u) => fetchJson(u)));
    out.push(...results);
  }
  return out;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    // Support either:
    // - /api/games?range=week
    // OR
    // - /api/games?from=ISO&to=ISO
    const range = (searchParams.get("range") || "").toLowerCase();
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    let startDate, endDate;
    if (from && to) {
      startDate = startOfDay(new Date(from));
      endDate = endOfDay(new Date(to));
    } else {
      const computed = computeRange(range || "week");
      startDate = computed.startDate;
      endDate = computed.endDate;
    }

    // Keep Vercel stable. You can raise this later.
    const MAX_DAYS = range === "season" ? 90 : 35;

    const dates = [];
    for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
      dates.push(new Date(d));
      if (dates.length >= MAX_DAYS) break;
    }

    const urls = dates.map((d) => `${ESPN_SCOREBOARD}?dates=${yyyymmdd(d)}`);
    const payloads = await fetchInBatches(urls, 10);

    const all = [];
    for (const p of payloads) all.push(...extractEspnGames(p));

    // Dedup
    const byKey = new Map();
    for (const g of all) {
      const key = `${g.startTime || ""}|${g.awayTeam}|${g.homeTeam}`;
      byKey.set(key, g);
    }
    const allGames = Array.from(byKey.values());

    // Filter to window (if we have startTime)
    const filtered = allGames.filter((g) => {
      if (!g.startTime) return false;
      const t = new Date(g.startTime).getTime();
      return t >= startDate.getTime() && t <= endDate.getTime();
    });

    // Sort
    filtered.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    return Response.json({
      range: range || (from && to ? "custom" : "week"),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      fetchedDays: dates.length,
      count: filtered.length,
      games: filtered
    });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
