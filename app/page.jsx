"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "softball_dashboard_v2_settings";

function formatLocalTime(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatLocalDate(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function normalizeLabel(name) {
  if (!name) return "";
  return String(name).trim().replace(/\s+/g, " ");
}

export default function Page() {
  const [view, setView] = useState("today"); // today | week | month | season
  const [liveOnly, setLiveOnly] = useState(false);

  // selectedTeams = active filter selection
  // IMPORTANT: empty set => show ALL games
  const [selectedTeams, setSelectedTeams] = useState(() => new Set());

  // pinnedTeams = saved shortlist (always shown)
  const [pinnedTeams, setPinnedTeams] = useState(() => new Set(["Stanford", "Oklahoma"]));

  // show/hide the "All teams" list
  const [showAllTeams, setShowAllTeams] = useState(false);

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState("");

  const [teamSearch, setTeamSearch] = useState("");

  // Load saved settings
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      if (parsed?.view) setView(parsed.view);
      if (typeof parsed?.liveOnly === "boolean") setLiveOnly(parsed.liveOnly);
      if (typeof parsed?.showAllTeams === "boolean") setShowAllTeams(parsed.showAllTeams);

      if (Array.isArray(parsed?.selectedTeams)) setSelectedTeams(new Set(parsed.selectedTeams));
      if (Array.isArray(parsed?.pinnedTeams)) setPinnedTeams(new Set(parsed.pinnedTeams));
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
          showAllTeams,
          selectedTeams: Array.from(selectedTeams),
          pinnedTeams: Array.from(pinnedTeams)
        })
      );
    } catch {
      // ignore
    }
  }, [view, liveOnly, showAllTeams, selectedTeams, pinnedTeams]);

  async function fetchGames() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/games?range=${encodeURIComponent(view)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data = await res.json();

      setGames(Array.isArray(data?.games) ? data.games : []);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (e) {
      setError(e?.message || "Failed to load games.");
      setGames([]);
    } finally {
      setLoading(false);
    }
  }

  // Initial load + refresh loop
  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Build team list automatically from current games
  const allTeams = useMemo(() => {
    const s = new Set();
    for (const g of games) {
      if (g?.homeTeam) s.add(normalizeLabel(g.homeTeam));
      if (g?.awayTeam) s.add(normalizeLabel(g.awayTeam));
    }
    return Array.from(s).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [games]);

  // Search matches (for adding to pinned)
  const searchMatches = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return [];
    // show up to 12 matches
    return allTeams
      .filter((t) => t.toLowerCase().includes(q))
      .slice(0, 12);
  }, [teamSearch, allTeams]);

  function toggleTeam(team) {
    const t = normalizeLabel(team);
    if (!t) return;
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function selectAll() {
    setSelectedTeams(new Set(allTeams));
  }

  function clearSelection() {
    setSelectedTeams(new Set()); // EMPTY => show all games
  }

  function pinTeam(team) {
    const t = normalizeLabel(team);
    if (!t) return;
    setPinnedTeams((prev) => {
      const next = new Set(prev);
      next.add(t);
      return next;
    });
    setTeamSearch("");
  }

  function unpinTeam(team) {
    const t = normalizeLabel(team);
    setPinnedTeams((prev) => {
      const next = new Set(prev);
      next.delete(t);
      return next;
    });
  }

  // Filtered games
  const filtered = useMemo(() => {
    let list = Array.isArray(games) ? [...games] : [];

    // empty selection => show ALL games
    if (selectedTeams.size > 0) {
      list = list.filter((g) => {
        const h = normalizeLabel(g?.homeTeam);
        const a = normalizeLabel(g?.awayTeam);
        return (h && selectedTeams.has(h)) || (a && selectedTeams.has(a));
      });
    }

    if (liveOnly) list = list.filter((g) => g?.status === "LIVE");

    list.sort((a, b) => {
      const ta = new Date(a?.startTime || 0).getTime();
      const tb = new Date(b?.startTime || 0).getTime();
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
          <button onClick={() => setView("month")} style={btnStyle(view === "month")}>Next 30</button>
          <button onClick={() => setView("season")} style={btnStyle(view === "season")}>Season</button>

          <label style={toggleStyle}>
            <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
            Live games only
          </label>

          <button onClick={fetchGames} style={btnStyle(false)}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 10 }}>
        {/* Teams */}
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong>Teams</strong>
            <span style={{ fontSize: 12, color: "#555" }}>
              (toggles are saved automatically • empty selection = show all games)
            </span>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "#555" }}>Updated: {lastUpdated || "—"}</div>

              <label style={toggleStyle}>
                <input
                  type="checkbox"
                  checked={showAllTeams}
                  onChange={(e) => setShowAllTeams(e.target.checked)}
                />
                All teams
              </label>

              <button onClick={selectAll} style={smallBtn}>Select all</button>
              <button onClick={clearSelection} style={smallBtn}>Clear</button>
            </div>
          </div>

          {/* Pinned (always visible) */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
              <strong style={{ color: "#111" }}>Pinned</strong> (your shortlist)
            </div>

            {Array.from(pinnedTeams).length === 0 ? (
              <div style={{ fontSize: 12, color: "#555" }}>No pinned teams yet.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Array.from(pinnedTeams)
                  .sort((a, b) => a.localeCompare(b))
                  .map((t) => {
                    const on = selectedTeams.has(t);
                    return (
                      <div key={t} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <button
                          onClick={() => toggleTeam(t)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 999,
                            border: "1px solid #ddd",
                            background: on ? "#111" : "#fff",
                            color: on ? "#fff" : "#111",
                            fontSize: 13,
                            fontWeight: 700
                          }}
                          title="Toggle filter"
                        >
                          📌 {t}
                        </button>
                        <button
                          onClick={() => unpinTeam(t)}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 999,
                            border: "1px solid #ddd",
                            background: "#fff",
                            cursor: "pointer",
                            fontWeight: 900
                          }}
                          title="Remove from pinned"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Search + Add to pinned */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Search teams to pin (ex: Princeton, UC Davis, San Diego)..."
                style={{
                  flex: "1 1 320px",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  fontSize: 13
                }}
              />
              <div style={{ fontSize: 12, color: "#555" }}>Type a school name (mascots are handled).</div>
            </div>

            {teamSearch.trim() && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {searchMatches.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#555" }}>No matches.</div>
                ) : (
                  searchMatches.map((t) => (
                    <button
                      key={t}
                      onClick={() => pinTeam(t)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: "1px solid #ddd",
                        background: "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                      title="Add to pinned"
                    >
                      + {t}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* All teams list (big) - controlled by toggle */}
          {showAllTeams ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13 }}>All teams (from current results)</strong>
                <span style={{ fontSize: 12, color: "#555" }}>
                  {allTeams.length ? `${allTeams.length} found` : "No teams found yet (try Refresh)."}
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {allTeams.map((t) => {
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
                      title="Toggle filter"
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        {/* Games */}
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
                  <div style={{ fontWeight: 800 }}>
                    {g.awayRank ? `#${g.awayRank} ` : ""}{g.awayTeam}{" "}
                    <span style={{ fontWeight: 400 }}>at</span>{" "}
                    {g.homeRank ? `#${g.homeRank} ` : ""}{g.homeTeam}
                  </div>

                  <div style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>
                    {formatLocalDate(g.startTime)} • {formatLocalTime(g.startTime)}
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
    <span style={{ padding: "3px 10px", borderRadius: 999, background: s.bg, color: s.fg, fontSize: 12, fontWeight: 800 }}>
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
    fontWeight: 800,
    cursor: "pointer"
  };
}

const toggleStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  border: "1px solid #ddd",
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 800,
  background: "#fff"
};

const smallBtn = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "#fff",
  fontWeight: 800,
  cursor: "pointer"
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
  fontWeight: 800,
  fontSize: 13
};
