// app/api/games/route.js
export const runtime = "nodejs";

const ESPN_SCOREBOARD =
  "https://site.web.api.espn.com/apis/site/v2/sports/baseball/college-softball/scoreboard";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "softball-dashboard/1.0" }
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
  // If we're past Aug 1, use next year's season.
  const y = now.getFullYear();
  const feb1 = new Date(y, 1, 1); // Feb=1
  const aug1 = new Date(y, 7, 1); // Aug=7

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

function normalizeTeamName(name) {
  if (!name) return "";
  let n = String(name).trim();

  // normalize dashes + whitespace
  n = n.replace(/[–—]/g, "-").replace(/\s+/g, " ");

  // If ESPN/NCAA includes mascots ("Princeton Tigers"), strip to school name.
  // We do this by matching known schools first (best accuracy).
  const SCHOOL_PREFIXES = [
    "Boise State",
    "Iowa",
    "UC Davis",
    "Cal Poly",
    "California",
    "Nevada",
    "Columbia",
    "Santa Clara",
    "Weber State",
    "Sacramento State",
    "Oklahoma",
    "Maine",
    "Idaho State",
    "Fresno State",
    "South Carolina State",
    "Princeton",
    "Stanford",
    "Nebraska-Kearney",
    "Stanislaus State",
    "Southern Oregon",
    "San Jose State",
    "San Diego",
    "Oregon",
    "Oregon State",
    "UCLA",
    "Washington",
    "Virginia",
    "Virginia Tech",
    "Texas",
    "Texas A&M",
    "Ole Miss",
    "Notre Dame",
    "Ohio State",
    "Penn State",
    "North Carolina",
    "Florida",
    "Florida State",
    "Tennessee",
    "LSU",
    "Louisiana",
    "New Mexico",
    "New Mexico State",
    "North Texas",
    "Grand Canyon",
    "Pacific",
    "Niagara",
    "Nicholls",
    "Oakland",
    "Seattle U",
    "UCF",
    "UNC Wilmington",
    "UT Arlington",
    "UTEP",
    "UTSA",
    "Wichita State",
    "Wisconsin",
    "North Dakota State",
    "Northern Illinois",
    "Northern Kentucky",
    "North Florida",
    "Queens University",
    "Radford",
    "Rutgers",
    "Sam Houston",
    "Samford",
    "Saint Mary's",
    "Saint Francis",
    "St. Bonaventure",
    "St. Thomas-Minnesota",
    "Stephen F. Austin",
    "Stetson",
    "Syracuse",
    "Tarleton State",
    "Troy",
    "Tulsa",
    "UAB",
    "UAlbany",
    "UL Monroe",
    "UMBC",
    "UNLV",
    "Utah",
    "Utah State",
    "Utah Tech",
    "Utah Valley",
    "Washington",
    "Weber State",
    "Western Kentucky",
    "Winthrop"
  ];

  for (const school of SCHOOL_PREFIXES) {
    if (n === school) return school;
    if (n.startsWith(school + " ")) return school; // "Princeton Tigers" -> "Princeton"
  }

  // Handle some common short/alt names from feeds
  const ALIASES = new Map([
    ["Cal", "California"],
    ["Sac State", "Sacramento State"],
    ["Sacramento St", "Sacramento State"],
    ["Boise St", "Boise State"],
    ["Idaho St", "Idaho State"],
    ["Fresno St", "Fresno State"],
    ["SC State", "South Carolina State"],
    ["Nebraska Kearney", "Nebraska-Kearney"],
    ["Nebraska–Kearney", "Nebraska-Kearney"],
    ["CSU Stanislaus", "Stanislaus State"],
    ["Stanislaus St", "Stanislaus State"]
  ]);

  if (ALIASES.has(n)) return ALIASES.get(n);

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
    if (!home?.team?.displayName || !away?.team?.displayName) continue;

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
      `${away.team.displayName}-${home.team.displayName}-${startTime || ""}`.replace(/\s+/g, "_");

    games.push({
      id: `espn_${id}`,
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

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const range = (searchParams.get("range") || "week").toLowerCase();

    const { startDate, endDate } = computeRange(range);

    // IMPORTANT: prevent “season” from trying to fetch 150+ days (too many requests)
    // You can raise this later, but this keeps Vercel stable.
    const MAX_DAYS = range === "season" ? 60 : 31;

    const dates = [];
    for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
      dates.push(new Date(d));
      if (dates.length >= MAX_DAYS) break;
    }

    const payloads = await Promise.all(
      dates.map((d) => fetchJson(`${ESPN_SCOREBOARD}?dates=${yyyymmdd(d)}`))
    );

    const all = [];
    for (const p of payloads) all.push(...extractEspnGames(p));

    // Dedup (same game can appear in multiple pulls depending on timezone/timing)
    const byId = new Map();
    for (const g of all) byId.set(g.id, g);
    const allGames = Array.from(byId.values());

    // Filter strictly to the requested window
    const filtered = allGames.filter((g) => {
      if (!g.startTime) return false;
      const t = new Date(g.startTime).getTime();
      return t >= startDate.getTime() && t <= endDate.getTime();
    });

    return Response.json({
      range,
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
