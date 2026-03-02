"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "softball_dashboard_v2_settings";

/**
 * A small “pretty label” helper for chips.
 * - Boise State -> Boise St
 * - Sacramento State -> Sacramento St
 * - Otherwise returns original name.
 */
function shortTeamLabel(name) {
  if (!name) return "";
  const n = String(name).trim();

  // Common / nicer abbreviations
  const map = new Map([
    ["California", "Cal"],
    ["Boise State", "Boise St"],
    ["Weber State", "Weber St"],
    ["Sacramento State", "Sac State"],
    ["Idaho State", "Idaho St"],
    ["Fresno State", "Fresno St"],
    ["South Carolina State", "SC State"],
    ["Stanislaus State", "Stanislaus St"],
    ["Nebraska-Kearney", "Nebraska-Kearney"]
  ]);
  if (map.has(n)) return map.get(n);

  // Generic “State” -> “St” shortening (nice, but not too aggressive)
  if (n.endsWith(" State")) return n.replace(/ State$/, " St");

  return n;
}

function formatLocalDateTime(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    const date = d.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${date} • ${time}`;
  } catch {
    return "";
  }
}

export default function Page() {
  // view maps to your API "range"
  const [view, setView] = useState("today"); // today | week | month | season
  const [liveOnly, setLiveOnly] = useState(false);

  // Pinned list = the shortlist the user curates
  const [pinnedTeams, setPinnedTeams] = useState(() => [
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
    "Southern Oregon"
  ]);

  // Selected teams = what’s currently “ON” for filtering.
  // IMPORTANT: if this set becomes empty, we show ALL games (no filtering).
  const [selectedTeams, setSelectedTeams] = useState(() => new Set());

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

      if (Array.isArray(parsed?.pinnedTeams) && parsed.pinnedTeams.length) {
        setPinnedTeams(parsed.pinnedTeams);
      }

      if (Array.isArray(parsed?.selectedTeams)) {
        setSelectedTeams(new Set(parsed.selectedTeams));
      } else if (parsed?.selectedTeams === "ALL_PINNED") {
        // backward/optional mode
        setSelectedTeams(new Set(parsed?.pinnedTeams || []));
      }
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
          pinnedTeams,
          selectedTeams: Array.from(selectedTeams)
        })
      );
    } catch {
      // ignore
    }
  }, [view, liveOnly, pinnedTeams, selectedTeams]);

  async function fetchGames() {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ range: view }).toString();
      const res = await fetch(`/api/games?${qs}`);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data = await res.json();

      const list = Array.isArray(data?.games) ? data.games : [];
      setGames(list);
      setLastUpdated(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      );
    } catch (e) {
      setError(e?.message || "Failed to load games.");
    } finally {
      setLoading(false);
    }
  }

  // initial load + refresh loop
  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Build ALL teams automatically from returned games (home + away)
  const allTeams = useMemo(() => {
    const set = new Set();
    for (const g of games) {
      if (g?.homeTeam) set.add(g.homeTeam);
      if (g?.awayTeam) set.add(g.awayTeam);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  // If pinnedTeams contains things that never appear in feed (or renamed),
  // keep them, but also allow adding from feed easily.
  const pinnedSet = useMemo(() => new Set(pinnedTeams), [pinnedTeams]);

  function toggleTeam(team) {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }

  function selectAllPinned() {
    setSelectedTeams(new Set(pinnedTeams));
  }

  function clearSelectionShowAll() {
    setSelectedTeams(new Set()); // empty = show all games
  }

  function addPinnedTeam(team) {
    if (!team) return;
    setPinnedTeams((prev) => {
      if (prev.includes(team)) return prev;
      return [...prev, team].sort((a, b) => a.localeCompare(b));
    });
    setTeamSearch("");
  }

  function removePinnedTeam(team) {
    setPinnedTeams((prev) => prev.filter((t) => t !== team));
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      next.delete(team);
      return next;
    });
  }

  const searchMatches = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return [];
    return allTeams
      .filter((t) => !pinnedSet.has(t))
      .filter((t) => t.toLowerCase().includes(q))
      .slice(0, 12);
  }, [teamSearch, allTeams, pinnedSet]);

  const filtered = useMemo(() => {
    const sel = selectedTeams;

    // ✅ Show all games when nothing is selected
    let list = games;
    if (sel.size > 0) {
      list = games.filter((g) => {
        const hit =
          (g.homeTeam && sel.has(g.homeTeam)) || (g.awayTeam && sel.has(g.awayTeam));
        return hit;
      });
    }

    if (liveOnly) list = list.filter((g) => g.status === "LIVE");

    list = [...list].sort((a, b) => {
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
          <button onClick={() => setView("month")} style={btnStyle(view === "month")}>
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
        {/* Pinned Teams */}
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong>Pinned Teams</strong>
            <span style={{ fontSize: 12, color: "#555" }}>
              (click to filter • empty selection shows ALL games)
            </span>

            <div style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>
              Updated: {lastUpdated || "—"}
            </div>
          </div>

          {/* controls */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button onClick={selectAllPinned} style={btnStyle(false)}>
              Select all pinned
            </button>
            <button onClick={clearSelectionShowAll} style={btnStyle(false)}>
              Show all games
            </button>

            <div style={{ marginLeft: "auto", minWidth: 260, position: "relative" }}>
              <input
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Search teams to add…"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  outline: "none"
                }}
              />

              {searchMatches.length > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    top: 44,
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    overflow: "hidden",
                    boxShadow: "0 12px 30px rgba(0,0,0,0.10)",
                    zIndex: 5
                  }}
                >
                  {searchMatches.map((t) => (
                    <button
                      key={t}
                      onClick={() => addPinnedTeam(t)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: "none",
                        background: "#fff",
                        cursor: "pointer"
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* pinned chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {pinnedTeams.map((t) => {
              const on = selectedTeams.has(t);
              return (
                <div
                  key={t}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    overflow: "hidden"
                  }}
                >
                  <button
                    onClick={() => toggleTeam(t)}
                    style={{
                      padding: "8px 10px",
                      border: "none",
                      background: on ? "#111" : "#fff",
                      color: on ? "#fff" : "#111",
                      fontSize: 13,
                      cursor: "pointer"
                    }}
                    title={t}
                  >
                    {shortTeamLabel(t)}
                  </button>

                  <button
                    onClick={() => removePinnedTeam(t)}
                    style={{
                      padding: "8px 10px",
                      border: "none",
                      background: on ? "#111" : "#fff",
                      color: on ? "#fff" : "#111",
                      cursor: "pointer",
                      borderLeft: on ? "1px solid rgba(255,255,255,0.25)" : "1px solid #ddd"
                    }}
                    title={`Remove ${t} from pinned`}
                    aria-label={`Remove ${t} from pinned`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
            Feed teams detected: <strong>{allTeams.length}</strong>
          </div>
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
                  <div style={{ fontWeight: 700 }}>
                    {g.awayRank ? `#${g.awayRank} ` : ""}
                    {shortTeamLabel(g.awayTeam) || g.awayTeam}{" "}
                    <span style={{ fontWeight: 400 }}>at</span>{" "}
                    {g.homeRank ? `#${g.homeRank} ` : ""}
                    {shortTeamLabel(g.homeTeam) || g.homeTeam}
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
