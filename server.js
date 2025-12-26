import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Statbotics REST API base
 * Docs show endpoints like GET /v3/team/{team}
 */
const STATBOTICS_BASE = "https://api.statbotics.io"; // upstream base

// Optional request logging (helps confirm cron + GPT calls)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

function withDefaultFilters(query) {
  // Default to PNW unless user specifies district/state/country explicitly
  const q = { ...query };
  const hasRegion = !!(q.district || q.state || q.country);
  if (!hasRegion) q.district = "pnw";
  return q;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 10000); // 10s default
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });

    if (!r.ok) {
      const text = await r.text();
      const err = new Error(`Upstream error ${r.status}: ${text}`);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(path, queryObj = {}) {
  const url = new URL(`${STATBOTICS_BASE}${path}`);
  for (const [k, v] of Object.entries(queryObj)) {
    if (v !== undefined && v !== null && String(v).length > 0) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** Health + ping */
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "frc-data-proxy" });
});

// Alias so you can keep using /ping like your other service
app.get("/ping", (req, res) => {
  res.json({ ok: true, service: "frc-data-proxy", ping: true });
});

/**
 * FRIENDLY ENDPOINTS (recommended for GPT usage)
 * These map directly to Statbotics v3 endpoints.
 */

// Team snapshot
app.get("/team/:team", async (req, res) => {
  try {
    const team = req.params.team;
    const url = buildUrl(`/v3/team/${team}`);
    const data = await fetchJson(url);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: "team lookup failed", detail: String(err.message || err) });
  }
});

// Team-year snapshot (useful for “last 3 years” comparisons)
app.get("/team/:team/year/:year", async (req, res) => {
  try {
    const { team, year } = req.params;
    const url = buildUrl(`/v3/team_year/${team}/${year}`);
    const data = await fetchJson(url);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: "team-year lookup failed", detail: String(err.message || err) });
  }
});

// Event snapshot
app.get("/event/:event", async (req, res) => {
  try {
    const event = req.params.event;
    const url = buildUrl(`/v3/event/${event}`);
    const data = await fetchJson(url);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: "event lookup failed", detail: String(err.message || err) });
  }
});

// List teams with region filters (defaults to district=pnw if none provided)
app.get("/teams", async (req, res) => {
  try {
    const q = withDefaultFilters(req.query);
    const url = buildUrl(`/v3/teams`, q);
    const data = await fetchJson(url);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: "teams query failed", detail: String(err.message || err) });
  }
});

// List events with region filters (defaults to district=pnw if none provided)
app.get("/events", async (req, res) => {
  try {
    const q = withDefaultFilters(req.query);
    const url = buildUrl(`/v3/events`, q);
    const data = await fetchJson(url);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: "events query failed", detail: String(err.message || err) });
  }
});

/**
 * GENERIC PASSTHROUGH (for anything we didn’t “friendly wrap” yet)
 * Use: /statbotics?path=v3/team/254 OR /statbotics?path=v3/events&year=2025&district=pnw
 *
 * (Query-param style avoids issues with slashes in GPT Actions.)
 */
app.get("/statbotics", async (req, res) => {
  try {
    const { path, ...rest } = req.query;
    if (!path) {
      return res.status(400).json({ error: "missing required query param: path" });
    }
    const safePath = String(path).startsWith("/") ? String(path) : `/${path}`;
    const url = buildUrl(safePath, rest);
    const data = await fetchJson(url);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: "statbotics proxy error", detail: String(err.message || err) });
  }
});

// Last N seasons for a team (defaults: last 4 years including current year)
app.get("/team/:team/years", async (req, res) => {
  try {
    const team = req.params.team;
    const n = Number(req.query.n ?? 4);
    const endYear = Number(req.query.endYear ?? new Date().getFullYear());

    if (!Number.isFinite(n) || n < 1 || n > 10) {
      return res.status(400).json({ error: "n must be between 1 and 10" });
    }
    if (!Number.isFinite(endYear) || endYear < 1992 || endYear > 2100) {
      return res.status(400).json({ error: "endYear must be a valid year" });
    }

    const years = [];
    let y = endYear;
    while (years.length < n) {
      // Skip years with no official season
      if (y === 2021) { y--; continue; } // no FRC season
      years.push(y);
      y--;
    }

    const results = [];
    for (const year of years) {
      const url = buildUrl(`/v3/team_year/${team}/${year}`);
      try {
        const data = await fetchJson(url);
        results.push({
          team: data.team,
          year: data.year,
          name: data.name,
          district: data.district,
          // IMPORTANT: correct meaning
          epa_points_mean: data.epa?.total_points?.mean ?? null,   // e.g., 77.7
          epa_points_sd: data.epa?.total_points?.sd ?? null,
          unitless_epa: data.epa?.unitless ?? null,               // e.g., 1840
          norm_epa: data.epa?.norm ?? null,                       // e.g., 1746 (unitless normalized)
          world_rank: data.epa?.ranks?.total?.rank ?? null
        });
      } catch (e) {
        // If a specific year isn't found (rookie year or missing data), return nulls for that year
        results.push({
          team: Number(team),
          year,
          error: String(e.message || e)
        });
      }
    }

    res.json({ team: Number(team), endYear, n, seasons: results });
  } catch (err) {
    res.status(500).json({ error: "team years lookup failed", detail: String(err.message || err) });
  }
});

// Helper: percentile (0–100). Uses linear interpolation between closest ranks.
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

// Benchmarks for EPA metrics by region (uses team_year for reliability)
app.get("/benchmarks/epa", async (req, res) => {
  try {
    const year = Number(req.query.year);
    if (!Number.isFinite(year)) {
      return res.status(400).json({ error: "Missing or invalid 'year' (e.g., year=2025)" });
    }

    const metric = String(req.query.metric || "unitless_epa");

    const percStr = String(req.query.percentiles || "50,75,90");
    const percentiles = percStr
      .split(",")
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 100);

    if (!percentiles.length) {
      return res.status(400).json({ error: "Invalid 'percentiles' (e.g., 50,75,90)" });
    }

    const region = withDefaultFilters(req.query);

    // Get team list for region/year
    const teamsUrl = buildUrl("/v3/teams", {
      year,
      district: region.district,
      state: region.state,
      country: region.country
    });

    const teams = await fetchJson(teamsUrl);
    const teamNums = teams.map(t => t.team).filter(n => Number.isFinite(n));

    if (!teamNums.length) {
      return res.status(502).json({ error: "No teams returned for this region/year" });
    }

    const MAX_TEAMS = Number(req.query.maxTeams ?? 300);
    const capped = teamNums.slice(0, MAX_TEAMS);

    const values = [];
    const errors = [];

    let idx = 0;
    const CONCURRENCY = 10;

    async function worker() {
      while (idx < capped.length) {
        const team = capped[idx++];
        try {
          const ty = await fetchJson(buildUrl(`/v3/team_year/${team}/${year}`));

          let v = null;
          if (metric === "unitless_epa") v = ty.epa?.unitless ?? null;
          else if (metric === "epa_points_mean") v = ty.epa?.total_points?.mean ?? null;
          else if (metric === "epa_points_sd") v = ty.epa?.total_points?.sd ?? null;
          else if (metric === "world_rank") v = ty.epa?.ranks?.total?.rank ?? null;

          if (Number.isFinite(v)) values.push(v);
        } catch (e) {
          errors.push({ team, error: String(e.message || e) });
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    if (!values.length) {
      return res.status(502).json({
        error: "No metric values found via team_year",
        year,
        metric,
        attempted: capped.length,
        errors_sample: errors.slice(0, 5)
      });
    }

    // Percentile helper
    function percentile(sorted, p) {
      const i = (p / 100) * (sorted.length - 1);
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      if (lo === hi) return sorted[lo];
      return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
    }

    const sorted = values.sort((a, b) => a - b);
    const out = {};
    for (const p of percentiles) out[p] = percentile(sorted, p);

    res.json({
      year,
      region: {
        district: region.district || null,
        state: region.state || null,
        country: region.country || null
      },
      metric,
      team_count: values.length,
      percentiles: out
    });

  } catch (err) {
    res.status(500).json({ error: "benchmarks failed", detail: String(err.message || err) });
  }
});

// Global top team by Unitless EPA (fast, O(1))
app.get("/world/top", async (req, res) => {
  try {
    const year = Number(req.query.year);
    const limit = Number(req.query.limit ?? 1);

    if (!Number.isFinite(year)) {
      return res.status(400).json({ error: "Missing or invalid 'year' (e.g., year=2025)" });
    }
    if (!Number.isFinite(limit) || limit < 1 || limit > 10) {
      return res.status(400).json({ error: "limit must be between 1 and 10" });
    }

    // Ask Statbotics for top TeamYears globally, sorted by Unitless EPA
    // (This avoids scanning thousands of teams.)
    const url = buildUrl("/v3/team_years", {
      year,
      metric: "unitless_epa",
      ascending: "false",
      limit
    });

    const rows = await fetchJson(url);

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(502).json({
        error: "Upstream returned no results for /v3/team_years",
        hint: "If this persists, we can fall back to a slower scan with concurrency + caps."
      });
    }

    // Normalize response: return the #1 team (or top N)
    const top = rows.map((ty) => ({
      team: ty.team,
      name: ty.name,
      country: ty.country ?? null,
      state: ty.state ?? null,
      district: ty.district ?? null,
      unitless_epa: ty.epa?.unitless ?? null,
      world_rank: ty.epa?.ranks?.total?.rank ?? null,
      epa_points_mean: ty.epa?.total_points?.mean ?? null,
      epa_points_sd: ty.epa?.total_points?.sd ?? null
    }));

    res.json({
      year,
      ranking_metric: "unitless_epa (descending)",
      count: top.length,
      top
    });
  } catch (err) {
    res.status(500).json({
      error: "world top lookup failed",
      detail: String(err.message || err)
    });
  }
});

// Find best-matching event key by fuzzy name search (fast + deterministic)
app.get("/events/find", async (req, res) => {
  try {
    const year = Number(req.query.year);
    const qRaw = String(req.query.q || "").trim();

    if (!Number.isFinite(year)) {
      return res.status(400).json({ error: "Missing or invalid 'year' (e.g., year=2025)" });
    }
    if (!qRaw) {
      return res.status(400).json({ error: "Missing 'q' search string (e.g., q=osf or q=oregon state fair)" });
    }

    // Optional region hints
    const district = req.query.district ? String(req.query.district) : undefined;
    const state = req.query.state ? String(req.query.state) : undefined;
    const country = req.query.country ? String(req.query.country) : undefined;

    // Pull events list (optionally filtered)
    const events = await fetchJson(buildUrl("/v3/events", {
      year,
      district,
      state,
      country
    }));

    // --- Improved deterministic fuzzy scoring + alias expansion ---
    function normalize(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // Add your shorthand here over time
    const ALIASES = {
      osf: ["oregon state fair", "state fair"],
      dcmp: ["district championship", "district champs", "pnw district championship"],
      cmp: ["championship", "world championship"],
      glp: ["glacier peak"],
      sundome: ["sundome"]
    };

    function expandQuery(q) {
      const base = normalize(q);
      const expansions = new Set([base]);
      if (ALIASES[base]) {
        for (const e of ALIASES[base]) expansions.add(normalize(e));
      }
      return [...expansions];
    }

    function scoreEvent(name, key, q) {
      const n = normalize(name);
      const k = normalize(key);
      const expandedQueries = expandQuery(q);

      let score = 0;
      let tokenHits = 0;

      for (const eq of expandedQueries) {
        if (!eq) continue;

        // Strong match: full phrase exists
        if (n.includes(eq)) score += 200;

        // Token overlap
        const tokens = eq.split(" ").filter(Boolean);
        for (const t of tokens) {
          if (t.length <= 2) continue;
          if (n.includes(t)) {
            score += 25;
            tokenHits++;
          }
        }

        // Abbreviation hint in key or name
        if (eq.length <= 5 && (n.includes(eq) || k.includes(eq))) score += 40;
      }

      // Weak region hints (still ok, but doesn't dominate)
      if (district && n.includes(String(district).toLowerCase())) score += 3;
      if (state && n.includes(String(state).toLowerCase())) score += 3;

      // Tie-breaker: prefer more token hits
      score += tokenHits;

      return score;
    }
    // --- End scoring ---

    const ranked = events
      .map(e => ({
        key: e.key,
        name: e.name,
        week: e.week,
        start_date: e.start_date,
        end_date: e.end_date,
        district: e.district,
        state: e.state,
        country: e.country,
        score: scoreEvent(e.name, e.key, qRaw)
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score === 0) {
      return res.status(404).json({
        error: "No matching event found",
        year,
        q: qRaw,
        hint: "Try a longer query string (e.g., 'oregon state fair') or specify district/state filters"
      });
    }

    // Return best + top suggestions for disambiguation
    res.json({
      year,
      q: qRaw,
      best,
      candidates: ranked.slice(0, 5)
    });

  } catch (err) {
    res.status(500).json({ error: "events find failed", detail: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`frc-data-proxy listening on port ${PORT}`);
});
