"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "softball_dashboard_v2_settings";

/**
 * Normalize team names coming back from APIs so filters/pills match consistently.
 * Keep this lightweight—just handles common punctuation/dashes/extra spaces.
 */
function normalizeTeamName(name) {
  if (!name) return "";
  return String(name)
    .trim()
    .replace(/[–—]/g, "-") // normalize en/em dashes to hyphen
    .replace(/\s+/g, " "); // collapse whitespace
}

// Optional: pretty short names for the UI pills + matchup display.
// Anything not listed will fall back to the normalized name.
const DISPLAY_NAME = {
  "Boise State": "Boise St",
  "UC Davis": "UC Davis",
  California: "Cal",
  "Weber State": "Weber St",
  "Sacramento State": "Sac State",
  "Idaho State": "Idaho St",
  "Fresno State": "Fresno St",
  "South Carolina State": "SC State",
  "Nebraska-Kearney": "Nebraska-Kearney",
  "Stanislaus State": "Stanislaus St"
};

function formatLocalDateTime(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    const date = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${date} • ${time}`;
  } catch {
    return "";
  }
}

export default function Page() {
  // IMPORTANT:
  // Your API route now expects `range` (today | week | 30 | season).
  const [view, setView] = useState("today"); // today | week | 30 | season
  const [liveOnly, setLiveOnly] = useState(false);

  // games from API (we will normalize team names before storing here)
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState("");

  // Dynamic team list built from fetched games
  const allTeams = useMemo(() => {
    const s = new Set();
    for (const g of games) {
      if (g?.homeTeam) s.add(g.homeTeam);
      if (g?.awayTeam) s.add(g.awayTeam);
    }
    // Sort for stable UI
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [games]);

  // Selected teams (dynamic)
  const [selectedTeams, setSelectedTeams] = useState(() => new Set());

  // Load saved settings
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.view) setView(parsed.view);
      if (typeof parsed?.liveOnly === "boolean") setLiveOnly(parsed.liveOnly);
      if (Array.isArray(parsed?.selectedTeams)) setSelectedTeams(new Set(parsed.selectedTeams));
    } catch {
      // ignore
    }
  }, []);

  // Save settings
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          view,
          liveOnly,
          selectedTeams: Array.from(selectedTeams)
        })
      );
    } catch {
      // ignore
    }
  }, [view, liveOnly, selectedTeams]);

  // Fetch games from API using `range`
  async function fetchGames() {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ range: view }).toString();
      const res = await fetch(`/api/games?${qs}`);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data = await res.json();

      const rawGames = Array.isArray(data?.games) ? data.games : [];

      // Normalize team names for consistency throughout UI
      const normalized = rawGames.map((g) => ({
        ...g,
        homeTeam: normalizeTeamName(g.homeTeam),
        awayTeam: normalizeTeamName(g.awayTeam)
      }));

      setGames(normalized);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (e) {
      setError(e?.message || "Failed to load games.");
      setGames([]);
    } finally {
      setLoading(false);
    }
  }

  // Initial load + refresh loop (live scores)
  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 30_000); // 30s refresh
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Keep selectedTeams in sync when the available team list changes:
  // - If user has NOTHING selected (empty set), that means "Show all" (by your request).
  // - Otherwise, keep their selection but drop teams that no longer exist in the current range.
  useEffect(() => {
    setSelectedTeams((prev) => {
      if (!prev || prev.size === 0) return prev; // empty means "show all", preserve
      const next = new Set();
      for (const t of prev) if (allTeams.includes(t)) next.add(t);
      return next;
    });
  }, [allTeams]);

  function toggleTeam(team) {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }

  function clearTeams() {
    // Empty set = show ALL games (per your requirement)
    setSelectedTeams(new Set());
  }

  function selectAllTeams() {
    setSelectedTeams(new Set(allTeams));
  }

  // Filter games:
  // - If selectedTeams is empty => show all games
  // - Else show only games involving selected teams
  const filtered = useMemo(() => {
    const sel = selectedTeams;

    let list = games.filter((g) => {
      if (!sel || sel.size === 0) return true; // SHOW ALL when nothing selected

      const hit =
        (g.homeTeam && sel.has(g.homeTeam)) || (g.awayTeam && sel.has(g.awayTeam));
      return hit;
    });

    if (liveOnly) list = list.filter((g) => g.status === "LIVE");

    list.sort((a, b) => {
      const ta = new Date(a.startTime || 0).getTime();
      const tb = new Date(b.startTime || 0).getTime();
      return ta - tb;
    });

    return list;
  }, [games, selectedTeams, liveOnly]);

  return (
    <div style={{ padding: 14, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <h1 style={{ margin: "6px 0", fontSize: 20 }}>🥎 Softball Dashboard (Private)</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setView("today")} style={btnStyle(view === "today")}>
            Today
          </button>
          <button onClick={() => setView("week")} style={btnStyle(view === "week")}>
            This Week
          </button>
          <button onClick={() => setView("30")} style={btnStyle(view === "30")}>
            Next 30
          </button>
          <button onClick={() => setView("season")} style={btnStyle(view === "season")}>
            Season
          </button>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              border: "1px solid #ddd",
              borderRadius: 12
            }}
          >
            <input
              type="checkbox"
              checked={liveOnly}
              onChange={(e) => setLiveOnly(e.target.checked)}
            />
            Live games only
          </label>

          <button onClick={fetchGames} style={btnStyle(false)}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 10 }}>
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong>Teams</strong>
            <span style={{ fontSize: 12, color: "#555" }}>
              (toggles are saved automatically • empty selection = show all games)
            </span>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "#555" }}>Updated: {lastUpdated || "—"}</div>
              <button onClick={selectAllTeams} style={miniBtn}>
                Select all
              </button>
              <button onClick={clearTeams} style={miniBtn}>
                Clear
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {allTeams.length === 0 ? (
              <div style={{ fontSize: 13, color: "#555" }}>
                No teams found yet (try Refresh).
              </div>
            ) : (
              allTeams.map((t) => {
                const on = selectedTeams.size === 0 ? false : selectedTeams.has(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTeam(t)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 999,
                      border: "1px solid #ddd",
                      background: on ? "#111" : "#fff",
                      color: on ? "#fff" : "#111",
                      fontSize: 13
                    }}
                    title={t}
                  >
                    {DISPLAY_NAME[t] || t}
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong>Games</strong>
            <span style={{ fontSize: 12, color: "#555" }}>{filtered.length} shown</span>
          </div>

          {error ? <div style={{ marginTop: 10, color: "crimson" }}>{error}</div> : null}

          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {filtered.map((g) => (
              <div key={g.id} style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>
                    {g.awayRank ? `#${g.awayRank} ` : ""}
                    {DISPLAY_NAME[g.awayTeam] || g.awayTeam}{" "}
                    <span style={{ fontWeight: 400 }}>at</span>{" "}
                    {g.homeRank ? `#${g.homeRank} ` : ""}
                    {DISPLAY_NAME[g.homeTeam] || g.homeTeam}
                  </div>
                  <div style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>
                    {formatLocalDateTime(g.startTime)}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center"
                  }}
                >
                  <StatusPill status={g.status} />
                  <span style={{ fontSize: 14 }}>
                    {g.status === "SCHEDULED" ? "Scheduled" : ""}
                    {g.status === "LIVE" ? `LIVE • ${g.awayScore ?? "-"}–${g.homeScore ?? "-"}` : ""}
                    {g.status === "FINAL" ? `Final • ${g.awayScore ?? "-"}–${g.homeScore ?? "-"}` : ""}
                  </span>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {g.watchUrl ? (
                    <a href={g.watchUrl} target="_blank" rel="noreferrer" style={linkBtn}>
                      📺 Watch
                    </a>
                  ) : null}
                  {g.gameUrl ? (
                    <a href={g.gameUrl} target="_blank" rel="noreferrer" style={linkBtn}>
                      📋 Game info
                    </a>
                  ) : null}
                  {g.boxUrl ? (
                    <a href={g.boxUrl} target="_blank" rel="noreferrer" style={linkBtn}>
                      📊 Box score
                    </a>
                  ) : null}
                </div>
              </div>
            ))}

            {!loading && filtered.length === 0 ? (
              <div style={{ color: "#555", marginTop: 8 }}>
                No matching games found in this view/date range.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <footer style={{ marginTop: 16, fontSize: 12, color: "#666" }}>
        Tip: iPhone → open your Vercel link → Share → “Add to Home Screen” for an app-like icon.
      </footer>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    SCHEDULED: { text: "Scheduled", bg: "#f3f3f3", fg: "#222" },
    LIVE: { text: "LIVE", bg: "#111", fg: "#fff" },
    FINAL: { text: "Final", bg: "#f3f3f3", fg: "#222" }
  };
  const s = map[status] || map.SCHEDULED;
  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: 12,
        fontWeight: 700
      }}
    >
      {s.text}
    </span>
  );
}

function btnStyle(active) {
  return {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid #ddd",
    background: active ? "#111" : "#fff",
    color: active ? "#fff" : "#111",
    fontWeight: 700,
    cursor: "pointer"
  };
}

const miniBtn = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  color: "#111",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 12
};

const cardStyle = {
  border: "1px solid #ddd",
  borderRadius: 18,
  padding: 12,
  boxShadow: "0 1px 8px rgba(0,0,0,0.04)"
};

const linkBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #ddd",
  textDecoration: "none",
  color: "#111",
  fontWeight: 700,
  fontSize: 13
};
