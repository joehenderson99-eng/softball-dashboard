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
  const fromIso = searchParams.get("from");
  const toIso = searchParams.get("to");
  if (!fromIso || !toIso) {
    return Response.json({ games: [], error: "Missing from/to" }, { status: 400 });
  }

  const from = new Date(fromIso);
  const to = new Date(toIso);
  const dates = [];
  for (
    let d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    d < to;
    d.setDate(d.getDate() + 1)
  ) {
    dates.push(new Date(d));
  }

  const allGames = [];

  for (const d of dates) {
    const dateStr = isoDateOnly(d.toISOString());
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(5, 7);
    const day = dateStr.slice(8, 10);

    const ncaaD1Path = `/scoreboard/softball/d1/${y}/${m}/${day}`;
    const ncaaD2Path = `/scoreboard/softball/d2/${y}/${m}/${day}`;

    const [ncaaD1, ncaaD2, espn] = await Promise.allSettled([
      fetchJson(`${NCAA_API}${ncaaD1Path}`),
      fetchJson(`${NCAA_API}${ncaaD2Path}`),
      fetchJson(`${ESPN_SCOREBOARD}?dates=${y}${m}${day}`)
    ]);

    const ncaaItems = [];
    if (ncaaD1.status === "fulfilled") ncaaItems.push(...extractNcaaGames(ncaaD1.value));
    if (ncaaD2.status === "fulfilled") ncaaItems.push(...extractNcaaGames(ncaaD2.value));

    const espnItems = espn.status === "fulfilled" ? extractEspnGames(espn.value) : [];

    const merged = mergeGames(ncaaItems, espnItems);
    allGames.push(...merged);
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
    ["Cal", "California"],
    ["California", "California"],
    ["Sacramento St", "Sacramento State"],
    ["Sacramento State", "Sacramento State"],
    ["Stanford Cardinal", "Stanford"],
    ["Stanford", "Stanford"],
    ["Nebraska Kearney", "Nebraska–Kearney"],
    ["Nebraska–Kearney", "Nebraska–Kearney"]
  ]);

  if (map.has(n)) return map.get(n);
  return n.replace(/\s+/g, " ");
}
