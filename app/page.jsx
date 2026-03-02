"use client";

import { useEffect, useMemo, useState } from "react";

const TEAMS = [
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
  "Nebraska–Kearney",
  "CSU Stanislaus",
  "Southern Oregon"
];

// Display names (short scoreboard-style)
const DISPLAY_NAME = {
  "Boise State": "Boise St",
  "Iowa": "Iowa",
  "UC Davis": "UC Davis",
  "Cal Poly": "Cal Poly",
  "California": "Cal",
  "Nevada": "Nevada",
  "Columbia": "Columbia",
  "Santa Clara": "Santa Clara",
  "Weber State": "Weber St",
  "Sacramento State": "Sac State",
  "Oklahoma": "Oklahoma",
  "Maine": "Maine",
  "Idaho State": "Idaho St",
  "Fresno State": "Fresno St",
  "South Carolina State": "SC State",
  "Princeton": "Princeton",
  "Stanford": "Stanford",
  "Nebraska–Kearney": "Nebraska-Kearney",
  "CSU Stanislaus": "Stanislaus St",
  "Southern Oregon": "Southern Oregon"
};

const STORAGE_KEY = "softball_dashboard_v1_settings";

function formatLocalTime(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function startOfTodayISO() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.toISOString();
}

function addDaysISO(days) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return d.toISOString();
}

export default function Page() {
  const [view, setView] = useState("today"); // today | week
  const [liveOnly, setLiveOnly] = useState(false);
  const [selectedTeams, setSelectedTeams] = useState(() => new Set(TEAMS));
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState("");

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

  const dateRange = useMemo(() => {
    if (view === "today") return { from: startOfTodayISO(), to: addDaysISO(1) };
    return { from: startOfTodayISO(), to: addDaysISO(7) };
  }, [view]);

  async function fetchGames() {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to
      }).toString();

      const res = await fetch(`/api/games?${qs}`);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data = await res.json();

      setGames(Array.isArray(data?.games) ? data.games : []);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (e) {
      setError(e?.message || "Failed to load games.");
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
  }, [dateRange.from, dateRange.to]);

  function toggleTeam(team) {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const sel = selectedTeams;
    let list = games.filter((g) => {
      const hit =
        (g.homeTeam && sel.has(g.homeTeam)) ||
        (g.awayTeam && sel.has(g.awayTeam));
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
          <button onClick={() => setView("today")} style={btnStyle(view === "today")}>Today</button>
          <button onClick={() => setView("week")} style={btnStyle(view === "week")}>This Week</button>

          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 12 }}>
            <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
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
            <span style={{ fontSize: 12, color: "#555" }}>(toggles are saved automatically)</span>
            <div style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>
              Updated: {lastUpdated || "—"}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {TEAMS.map((t) => {
              const on = selectedTeams.has(t);
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
                >
                  {DISPLAY_NAME[t] || t}
                </button>
              );
            })}
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
                    {g.awayRank ? `#${g.awayRank} ` : ""}{DISPLAY_NAME[g.awayTeam] || g.awayTeam}{" "}
                    <span style={{ fontWeight: 400 }}>at</span>{" "}
                    {g.homeRank ? `#${g.homeRank} ` : ""}{DISPLAY_NAME[g.homeTeam] || g.homeTeam}
                  </div>
                  <div style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>
                    {formatLocalTime(g.startTime)}
                  </div>
                </div>

                <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <StatusPill status={g.status} />
                  <span style={{ fontSize: 14 }}>
                    {g.status === "SCHEDULED" ? "Scheduled" : ""}
                    {g.status === "LIVE" ? `LIVE • ${g.awayScore ?? "-"}–${g.homeScore ?? "-"}` : ""}
                    {g.status === "FINAL" ? `Final • ${g.awayScore ?? "-"}–${g.homeScore ?? "-"}` : ""}
                  </span>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {g.watchUrl ? (
                    <a href={g.watchUrl} target="_blank" rel="noreferrer" style={linkBtn}>📺 Watch</a>
                  ) : null}
                  {g.gameUrl ? (
                    <a href={g.gameUrl} target="_blank" rel="noreferrer" style={linkBtn}>📋 Game info</a>
                  ) : null}
                  {g.boxUrl ? (
                    <a href={g.boxUrl} target="_blank" rel="noreferrer" style={linkBtn}>📊 Box score</a>
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
    <span style={{ padding: "3px 10px", borderRadius: 999, background: s.bg, color: s.fg, fontSize: 12, fontWeight: 700 }}>
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
