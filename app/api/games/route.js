export const runtime = "nodejs";

function isoDateOnly(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "softball-dashboard/1.0" }
  });
  if (!res.ok) throw new Error(`Upstream failed ${res.status} for ${url}`);
  return res.json();
}

const ESPN_SCOREBOARD =
  "https://site.web.api.espn.com/apis/site/v2/sports/baseball/college-softball/scoreboard";

const NCAA_API = "https://ncaa-api.henrygd.me";

function normalizeStatus(s) {
  const up = (s || "").toUpperCase();
  if (up.includes("FINAL")) return "FINAL";
  if (up.includes("LIVE") || up.includes("IN PROGRESS") || up.includes("INPROGRESS")) return "LIVE";
  return "SCHEDULED";
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
const range = (searchParams.get("range") || "week").toLowerCase();

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
  // If we're past Aug 1, use next year's season.
  const y = now.getFullYear();
  const feb1 = new Date(y, 1, 1); // Feb=1
  const aug1 = new Date(y, 7, 1); // Aug=7

  if (now > aug1) {
    return { start: startOfDay(new Date(y + 1, 1, 1)), end: endOfDay(new Date(y + 1, 7, 1)) };
  }
  // If it's before Feb 1, still show upcoming season.
  if (now < feb1) {
    return { start: startOfDay(feb1), end: endOfDay(aug1) };
  }
  // During season: from today to Aug 1.
  return { start: startOfDay(now), end: endOfDay(aug1) };
}

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
  // fallback
  startDate = startOfDay(now);
  endDate = endOfDay(addDays(now, 7));
}

  return Response.json({ games: allGames });
}

function extractNcaaGames(payload) {
  const games = [];
  const board = payload?.scoreboard || payload;
  const sections = board?.games || board?.scoreboard?.games || [];
  const flat = Array.isArray(sections) ? sections : [];

  for (const g of flat) {
    const home =
      g?.home?.names?.short || g?.home?.names?.seo || g?.home?.short_name || g?.home?.name;
    const away =
      g?.away?.names?.short || g?.away?.names?.seo || g?.away?.short_name || g?.away?.name;

    if (!home || !away) continue;

    const statusText = g?.game?.gameState || g?.gameState || g?.status || g?.game?.status;
    const status = normalizeStatus(statusText);

    const startTime = g?.game?.startTimeEpoch
      ? new Date(g.game.startTimeEpoch * 1000).toISOString()
      : (g?.game?.startTime || g?.startTime || g?.gameTime);

    const homeScore = g?.home?.score ?? g?.home_score ?? null;
    const awayScore = g?.away?.score ?? g?.away_score ?? null;

    const gameUrl = g?.game?.url ? `https://www.ncaa.com${g.game.url}` : null;

    const id =
      g?.game?.gameID || g?.id || `${away}-${home}-${startTime || ""}`.replace(/\s+/g, "_");

    games.push({
      id: `ncaa_${id}`,
      startTime,
      status,
      homeTeam: normalizeTeamName(home),
      awayTeam: normalizeTeamName(away),
      homeScore,
      awayScore,
      gameUrl,
      boxUrl: gameUrl,
      watchUrl: null,
      homeRank: null,
      awayRank: null
    });
  }

  return games;
}

function extractEspnGames(payload) {
  const games = [];
  const events = payload?.events || [];
  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home?.team?.displayName || !away?.team?.displayName) continue;

    const status = normalizeStatus(comp?.status?.type?.description || comp?.status?.type?.name);
    const startTime = comp?.date || ev?.date || null;

    const homeScore = home?.score != null ? Number(home.score) : null;
    const awayScore = away?.score != null ? Number(away.score) : null;

    const homeRank = home?.curatedRank?.current ?? null;
    const awayRank = away?.curatedRank?.current ?? null;

    const gameUrl =
      ev?.links?.find((l) => l?.rel?.includes("desktop"))?.href || ev?.links?.[0]?.href || null;

    games.push({
      id: `espn_${ev?.id || `${away.team.displayName}-${home.team.displayName}-${startTime || ""}`}`,
      startTime,
      status,
      homeTeam: normalizeTeamName(home.team.displayName),
      awayTeam: normalizeTeamName(away.team.displayName),
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

function mergeGames(ncaaGames, espnGames) {
  const out = [];
  const usedEspn = new Set();

  for (const n of ncaaGames) {
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < espnGames.length; i++) {
      if (usedEspn.has(i)) continue;
      const e = espnGames[i];

      const sameTeams =
        (n.homeTeam === e.homeTeam && n.awayTeam === e.awayTeam) ||
        (n.homeTeam === e.awayTeam && n.awayTeam === e.homeTeam);

      if (!sameTeams) continue;

      let score = 10;
      const nd = n.startTime ? new Date(n.startTime) : null;
      const ed = e.startTime ? new Date(e.startTime) : null;
      if (nd && ed) {
        const diffHrs = Math.abs(nd.getTime() - ed.getTime()) / (1000 * 60 * 60);
        if (diffHrs < 6) score += 5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const e = espnGames[bestIdx];
      usedEspn.add(bestIdx);

      out.push({
        ...n,
        watchUrl: e.watchUrl || n.watchUrl,
        homeRank: e.homeRank ?? n.homeRank,
        awayRank: e.awayRank ?? n.awayRank,
        homeScore: n.homeScore ?? e.homeScore,
        awayScore: n.awayScore ?? e.awayScore,
        status: n.status !== "SCHEDULED" ? n.status : e.status
      });
    } else {
      out.push(n);
    }
  }

  for (let i = 0; i < espnGames.length; i++) {
    if (usedEspn.has(i)) continue;
    out.push(espnGames[i]);
  }

  return out;
}

function normalizeTeamName(name) {
  if (!name) return name;
  const n = String(name).trim();

  const map = new Map([
  // Short names used in your UI -> Canonical names
  ["Boise St", "Boise State"],
  ["Boise State", "Boise State"],

  ["Iowa", "Iowa"],
  ["UC Davis", "UC Davis"],

  ["Cal Poly", "Cal Poly"],

  ["Cal", "California"],
  ["California", "California"],

  ["Nevada", "Nevada"],

  ["Columbia", "Columbia"],

  ["Santa Clara", "Santa Clara"],

  ["Weber St", "Weber State"],
  ["Weber State", "Weber State"],

  ["Sac State", "Sacramento State"],
  ["Sacramento St", "Sacramento State"],
  ["Sacramento State", "Sacramento State"],

  ["Oklahoma", "Oklahoma"],
  ["Oklahoma University", "Oklahoma"],
  ["Oklahoma Sooners", "Oklahoma"],

  ["Maine", "Maine"],

  ["Idaho St", "Idaho State"],
  ["Idaho State", "Idaho State"],

  ["Fresno", "Fresno State"],
  ["Fresno St", "Fresno State"],
  ["Fresno State", "Fresno State"],

  ["SC State", "South Carolina State"],
  ["South Carolina State", "South Carolina State"],

  ["Princeton", "Princeton"],

  ["Stanford Cardinal", "Stanford"],
  ["Stanford", "Stanford"],

  ["Nebraska Kearney", "Nebraska-Kearney"],
  ["Nebraska–Kearney", "Nebraska-Kearney"],
  ["Nebraska-Kearney", "Nebraska-Kearney"],

  ["Stanislaus St", "Stanislaus State"],
  ["CSU Stanislaus", "Stanislaus State"],
  ["Stanislaus State", "Stanislaus State"],

  ["Southern Oregon", "Southern Oregon"],
]);

  if (map.has(n)) return map.get(n);
  return n.replace(/\s+/g, " ");
}
