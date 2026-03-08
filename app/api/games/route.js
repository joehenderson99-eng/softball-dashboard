export const runtime = "nodejs";

const ESPN_SCOREBOARD =
  "https://site.web.api.espn.com/apis/site/v2/sports/baseball/college-softball/scoreboard";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "softball-dashboard/1.0" },
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
  const y = now.getFullYear();
  const feb1 = new Date(y, 1, 1);
  const aug1 = new Date(y, 7, 1);

  if (now > aug1) {
    return {
      start: startOfDay(new Date(y + 1, 1, 1)),
      end: endOfDay(new Date(y + 1, 7, 1))
    };
  }
  if (now < feb1) {
    return { start: startOfDay(feb1), end: endOfDay(aug1) };
  }
  return { start: startOfDay(now), end: endOfDay(aug1) };
}

function computeRange(range) {
  const now = new Date();
  let startDate;
  let endDate;

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

function normalizeTeamName(name) {
  if (!name) return "";
  return String(name).trim().replace(/\s+/g, " ");
}

function pickRecordSummary(comp) {
  const recs = Array.isArray(comp?.records) ? comp.records : [];
  const summary = recs.find((r) => typeof r?.summary === "string")?.summary;
  return summary || null;
}

function pickWatchData(ev, comp) {
  const links = Array.isArray(ev?.links) ? ev.links : [];

  const watchLink =
    links.find(
      (l) =>
        Array.isArray(l?.rel) &&
        l.rel.some((r) => String(r).toLowerCase().includes("watch"))
    )?.href || null;

  const desktopLink =
    links.find(
      (l) =>
        Array.isArray(l?.rel) &&
        l.rel.some((r) => String(r).toLowerCase().includes("desktop"))
    )?.href ||
    links[0]?.href ||
    null;

  const watchUrl = watchLink || desktopLink;

  const broadcasts = Array.isArray(comp?.broadcasts) ? comp.broadcasts : [];
  const networkNames = broadcasts
    .flatMap((b) => {
      if (Array.isArray(b?.names)) return b.names;
      if (typeof b?.name === "string") return [b.name];
      if (typeof b?.market === "string") return [b.market];
      if (typeof b?.type?.shortName === "string") return [b.type.shortName];
      if (typeof b?.type?.name === "string") return [b.type.name];
      return [];
    })
    .map((x) => String(x).trim())
    .filter(Boolean);

  const uniqueNames = [...new Set(networkNames)];
  const watchLabel = uniqueNames.length ? uniqueNames.join(" / ") : null;

  return {
    watchUrl,
    watchLabel,
    gameUrl: desktopLink
  };
}

function extractEspnGames(payload) {
  const games = [];
  const events = payload?.events || [];

  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    if (!comp) continue;

    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    const homeTeam = normalizeTeamName(
      home?.team?.shortDisplayName || home?.team?.displayName || home?.team?.name || ""
    );
    const awayTeam = normalizeTeamName(
      away?.team?.shortDisplayName || away?.team?.displayName || away?.team?.name || ""
    );
    if (!homeTeam || !awayTeam) continue;

    const startTime = comp?.date || ev?.date || null;
    const status = normalizeStatus(comp?.status?.type?.description || comp?.status?.type?.name);

    const homeScore = home?.score != null ? Number(home.score) : null;
    const awayScore = away?.score != null ? Number(away.score) : null;

    const homeRank = home?.curatedRank?.current ?? null;
    const awayRank = away?.curatedRank?.current ?? null;

    const homeRecord = pickRecordSummary(home);
    const awayRecord = pickRecordSummary(away);

    const { watchUrl, watchLabel, gameUrl } = pickWatchData(ev, comp);

    const id =
      ev?.id ||
      `${awayTeam}-${homeTeam}-${startTime || ""}`.replace(/\s+/g, "_");

    games.push({
      id: `espn_${id}`,
      startTime,
      status,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      homeRank,
      awayRank,
      homeRecord,
      awayRecord,
      gameUrl,
      boxUrl: gameUrl,
      watchUrl,
      watchLabel
    });
  }

  return games;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const range = (searchParams.get("range") || "week").toLowerCase();

    const { startDate, endDate } = computeRange(range);

    // ✅ Pull a few extra PREVIOUS days so finals remain visible after games end
    const RECENT_FINAL_LOOKBACK_DAYS = 3;
    const fetchStartDate = startOfDay(addDays(startDate, -RECENT_FINAL_LOOKBACK_DAYS));

    const MAX_DAYS = range === "season" ? 65 : 35;

    const dates = [];
    for (let d = new Date(fetchStartDate); d <= endDate; d = addDays(d, 1)) {
      dates.push(new Date(d));
      if (dates.length >= MAX_DAYS) break;
    }

    const payloads = await Promise.all(
      dates.map((d) => fetchJson(`${ESPN_SCOREBOARD}?dates=${yyyymmdd(d)}`))
    );

    const all = [];
    for (const p of payloads) all.push(...extractEspnGames(p));

    const byId = new Map();
    for (const g of all) byId.set(g.id, g);

    const allGames = Array.from(byId.values()).sort(
      (a, b) => new Date(a?.startTime || 0).getTime() - new Date(b?.startTime || 0).getTime()
    );

    return Response.json({
      range,
      requestedStartDate: startDate.toISOString(),
      requestedEndDate: endDate.toISOString(),
      fetchedStartDate: fetchStartDate.toISOString(),
      fetchedEndDate: endDate.toISOString(),
      fetchedDays: dates.length,
      count: allGames.length,
      games: allGames
    });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
