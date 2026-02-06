// -------------------------
// n8n Node: Match Record Normalizer (Production-Safe V5.1)
// -------------------------

// --- 1. Input Extraction Helper ---
function getInput() {
  if (typeof item !== 'undefined' && item.json) return item.json;
  if (typeof items !== 'undefined' && items.length > 0 && items[0].json) return items[0].json;
  if (typeof $input !== 'undefined' && $input.item) return $input.item.json;
  if (typeof data !== 'undefined') return data;
  return {};
}

const inputData = getInput();

// --- 2. QA Structure & Versioning ---
const QA_VERSION = "5.1";
const now = new Date().toISOString();

// Helper to init QA block
function initQA(inputType) {
    return {
        status: "ok", // ok | warning | soft_error
        warnings: [],
        errors: [],
        meta: {
            normalizer_version: QA_VERSION,
            input_type: inputType,
            timestamp: now
        },
        markets_total: 0,
        markets_merged: [],
        markets_from_flat_only: [],
        markets_from_comparison_only: [],
        markets_skipped_invalid: 0
    };
}

// --- 3. Data Unwrapping & Detection ---
let raw;
if (inputData.response && Array.isArray(inputData.response)) {
  raw = inputData.response[0];
} else if (inputData.data) {
  raw = Array.isArray(inputData.data) ? inputData.data[0] : inputData.data;
} else {
  raw = inputData;
}

// Check Input Type
const isAlreadyNormalized = (raw && raw.match_id && raw.odds && raw.odds.best);
const qa = initQA(isAlreadyNormalized ? "normalized" : "raw");

// --- 4. Logic Branching: Passthrough (Already Normalized) ---
if (isAlreadyNormalized) {
    qa.status = "warning"; // Passthrough is technically a warning state (idempotency)
    qa.warnings.push("input_already_normalized");

    // Preserve existing QA info if present, but wrap in new structure
    if (raw.qa && raw.qa.warnings) {
        qa.warnings.push(...raw.qa.warnings);
    }

    // Self-Healing: Groups
    if (!raw.odds.groups) {
        raw.odds.groups = generateGroups(raw.odds.best);
        qa.warnings.push("repaired_missing_groups");
    }

    // Assign new QA block
    raw.qa = qa;

    // Output
    return [{ json: raw }];
}

// --- 5. Logic Branching: Raw Input (Normalize) ---

// Guard: Missing ID
if (!raw || (!raw.id && !raw.match_id)) {
   qa.status = "soft_error";
   qa.errors.push("missing_id");
   return [{ json: { error: "No valid match ID found", qa } }];
}

// Canonical ID (Fix: prioritize match_id)
const matchId = raw.match_id || raw.id;

// --- 6. Helpers & Config ---

function isValidOdds(val) {
  if (val === undefined || val === null || val === "") return false;
  const n = Number(val);
  return Number.isFinite(n) && n > 1.0;
}

function normalizePercent(val) {
  if (val === undefined || val === null) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (n > 1) return Number((n / 100).toFixed(4));
  return Number(n.toFixed(4));
}

// Group Generator (Shared)
function generateGroups(bestOdds) {
    const groups = {
        "ft_1x2": ["ft_1x2_home", "ft_1x2_draw", "ft_1x2_away"],
        "ht_1x2": ["ht_1x2_home", "ht_1x2_draw", "ht_1x2_away"],
        "2h_1x2": ["2h_1x2_home", "2h_1x2_draw", "2h_1x2_away"],
        "dc": ["dc_1x", "dc_12", "dc_x2"],
        "btts": ["btts_yes", "btts_no"],
        "ht_btts": ["ht_btts_yes", "ht_btts_no"],
        "2h_btts": ["2h_btts_yes", "2h_btts_no"],
        "dnb": ["dnb_home", "dnb_away"],
        "cs_home": ["cs_home_yes", "cs_home_no"],
        "cs_away": ["cs_away_yes", "cs_away_no"],
        "corners_1x2": ["corners_1x2_home", "corners_1x2_draw", "corners_1x2_away"]
    };

    const keys = Object.keys(bestOdds);
    keys.forEach(key => {
        const goalMatch = key.match(/^(ft|ht|2h)_goals_(over|under)_([\d.]+)$/);
        if (goalMatch) {
            const [_, period, type, line] = goalMatch;
            const groupKey = `${period}_goals_${line}`;
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(key);
        }

        // New Corner Keys
        const cornerMatch = key.match(/^corners_ou_(over|under)_([\d.]+)$/);
        if (cornerMatch) {
            const [_, type, line] = cornerMatch;
            const groupKey = `corners_ou_${line}`;
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(key);
        }

        // Legacy Corner Keys (Support Alias)
        const legacyMatch = key.match(/^corners_(over|under)_([\d.]+)$/);
        if (legacyMatch) {
             const [_, type, line] = legacyMatch;
             // Map legacy keys to NEW groups so devigging works
             const groupKey = `corners_ou_${line}`;
             if (!groups[groupKey]) groups[groupKey] = [];
             groups[groupKey].push(key);
        }
    });

    return groups;
}

// Flat Mappings
const FLAT_ODDS_MAP = {
  "odds_ft_1": "ft_1x2_home",
  "odds_ft_x": "ft_1x2_draw",
  "odds_ft_2": "ft_1x2_away",
  "odds_ft_over05": "ft_goals_over_0.5",
  "odds_ft_under05": "ft_goals_under_0.5",
  "odds_ft_over15": "ft_goals_over_1.5",
  "odds_ft_under15": "ft_goals_under_1.5",
  "odds_ft_over25": "ft_goals_over_2.5",
  "odds_ft_under25": "ft_goals_under_2.5",
  "odds_ft_over35": "ft_goals_over_3.5",
  "odds_ft_under35": "ft_goals_under_3.5",
  "odds_ft_over45": "ft_goals_over_4.5",
  "odds_ft_under45": "ft_goals_under_4.5",
  "odds_btts_yes": "btts_yes",
  "odds_btts_no": "btts_no",
  "odds_doublechance_1x": "dc_1x",
  "odds_doublechance_12": "dc_12",
  "odds_doublechance_x2": "dc_x2",
  "odds_dnb_1": "dnb_home",
  "odds_dnb_2": "dnb_away",
  "odds_1st_half_result_1": "ht_1x2_home",
  "odds_1st_half_result_x": "ht_1x2_draw",
  "odds_1st_half_result_2": "ht_1x2_away",
  "odds_1st_half_over05": "ht_goals_over_0.5",
  "odds_1st_half_under05": "ht_goals_under_0.5",
  "odds_1st_half_over15": "ht_goals_over_1.5",
  "odds_1st_half_under15": "ht_goals_under_1.5",
  "odds_1st_half_over25": "ht_goals_over_2.5",
  "odds_1st_half_under25": "ht_goals_under_2.5",
  "odds_1st_half_over35": "ht_goals_over_3.5",
  "odds_1st_half_under35": "ht_goals_under_3.5",
  "odds_2nd_half_result_1": "2h_1x2_home",
  "odds_2nd_half_result_x": "2h_1x2_draw",
  "odds_2nd_half_result_2": "2h_1x2_away",
  "odds_2nd_half_over05": "2h_goals_over_0.5",
  "odds_2nd_half_under05": "2h_goals_under_0.5",
  "odds_2nd_half_over15": "2h_goals_over_1.5",
  "odds_2nd_half_under15": "2h_goals_under_1.5",
  "odds_2nd_half_over25": "2h_goals_over_2.5",
  "odds_2nd_half_under25": "2h_goals_under_2.5",
  "odds_2nd_half_over35": "2h_goals_over_3.5",
  "odds_2nd_half_under35": "2h_goals_under_3.5",
  "odds_btts_1st_half_yes": "ht_btts_yes",
  "odds_btts_1st_half_no": "ht_btts_no",
  "odds_btts_2nd_half_yes": "2h_btts_yes",
  "odds_btts_2nd_half_no": "2h_btts_no",
  "odds_team_to_score_first_1": "fgs_home",
  "odds_team_to_score_first_x": "fgs_none",
  "odds_team_to_score_first_2": "fgs_away",
  "odds_win_to_nil_1": "win_to_nil_home",
  "odds_win_to_nil_2": "win_to_nil_away",
  "odds_team_a_cs_yes": "cs_home_yes",
  "odds_team_a_cs_no": "cs_home_no",
  "odds_team_b_cs_yes": "cs_away_yes",
  "odds_team_b_cs_no": "cs_away_no",
  "odds_corners_1": "corners_1x2_home",
  "odds_corners_x": "corners_1x2_draw",
  "odds_corners_2": "corners_1x2_away",
};

// Regex Mappings (New + Legacy Support)
const FLAT_REGEX_MAP = [
  // New Standard
  { pattern: /^odds_corners_over_(\d+)$/, map: (m) => `corners_ou_over_${m[1]/10}` },
  { pattern: /^odds_corners_under_(\d+)$/, map: (m) => `corners_ou_under_${m[1]/10}` },

  // Legacy Alias (Generate duplicate key for compat, marked as legacy later)
  { pattern: /^odds_corners_over_(\d+)$/, map: (m) => `corners_over_${m[1]/10}`, isLegacy: true },
  { pattern: /^odds_corners_under_(\d+)$/, map: (m) => `corners_under_${m[1]/10}`, isLegacy: true },
];

function flatKeyToMarketKeys(flatKey) {
  const results = [];
  if (FLAT_ODDS_MAP[flatKey]) results.push({ key: FLAT_ODDS_MAP[flatKey], isLegacy: false });

  for (const r of FLAT_REGEX_MAP) {
    const match = flatKey.match(r.pattern);
    if (match) {
        results.push({ key: r.map(match), isLegacy: r.isLegacy });
    }
  }
  return results; // Returns array of keys to populate
}

function toMarketKeys(category, selection) {
  const c = category.trim();
  const s = selection.trim();
  const sl = s.toLowerCase();
  const keys = [];

  // Helper to push
  const add = (k) => keys.push({ key: k, isLegacy: false });
  const addLegacy = (k) => keys.push({ key: k, isLegacy: true });

  // 1X2
  if (c === "FT Result") {
    if (sl === "home") add("ft_1x2_home");
    if (sl === "draw") add("ft_1x2_draw");
    if (sl === "away") add("ft_1x2_away");
  }
  if (c === "Half Time Result") {
    if (sl === "home") add("ht_1x2_home");
    if (sl === "draw") add("ht_1x2_draw");
    if (sl === "away") add("ht_1x2_away");
  }
  if (c === "Second Half Result") {
    if (sl === "home") add("2h_1x2_home");
    if (sl === "draw") add("2h_1x2_draw");
    if (sl === "away") add("2h_1x2_away");
  }

  // Double Chance
  if (c === "Double Chance") {
    if (sl === "home/draw" || sl === "home/x") add("dc_1x");
    if (sl === "home/away" || sl === "12") add("dc_12");
    if (sl === "draw/away" || sl === "x/away") add("dc_x2");
  }

  // Draw No Bet
  if (c === "Draw No Bet") {
    if (sl === "home" || sl === "1") add("dnb_home");
    if (sl === "away" || sl === "2") add("dnb_away");
  }

  // Goals
  if (c === "Goals Over/Under" || c === "1st Half Goals" || c === "2nd Half Goals") {
    let prefix = "ft_goals";
    if (c === "1st Half Goals") prefix = "ht_goals";
    if (c === "2nd Half Goals") prefix = "2h_goals";

    if (sl.startsWith("over")) {
      const line = sl.replace("over", "").trim();
      add(`${prefix}_over_${line}`);
    }
    if (sl.startsWith("under")) {
      const line = sl.replace("under", "").trim();
      add(`${prefix}_under_${line}`);
    }
  }

  // BTTS
  if (c === "Both Teams To Score") {
    if (sl === "yes") add("btts_yes");
    if (sl === "no") add("btts_no");
  }
  if (c === "Both Teams to Score in 1st Half") {
    if (sl === "yes") add("ht_btts_yes");
    if (sl === "no") add("ht_btts_no");
  }
  if (c === "Both Teams to Score in 2nd Half") {
    if (sl === "yes") add("2h_btts_yes");
    if (sl === "no") add("2h_btts_no");
  }

  // Corners (New + Legacy)
  if (c === "Corners") {
    if (sl.startsWith("over")) {
      const line = sl.replace("over", "").trim();
      add(`corners_ou_over_${line}`);
      addLegacy(`corners_over_${line}`);
    }
    if (sl.startsWith("under")) {
      const line = sl.replace("under", "").trim();
      add(`corners_ou_under_${line}`);
      addLegacy(`corners_under_${line}`);
    }
  }

  if (c === "Corners 1X2" || c === "Corner Match Bet") {
    if (sl === "home" || sl === "1") add("corners_1x2_home");
    if (sl === "draw" || sl === "x") add("corners_1x2_draw");
    if (sl === "away" || sl === "2") add("corners_1x2_away");
  }

  // Clean Sheet
  if (c === "Clean Sheet - Home") {
    if (sl === "yes") add("cs_home_yes");
    if (sl === "no") add("cs_home_no");
  }
  if (c === "Clean Sheet - Away") {
    if (sl === "yes") add("cs_away_yes");
    if (sl === "no") add("cs_away_no");
  }

  // Win to Nil
  if (c === "Win To Nil") {
    if (sl === "1" || sl === "home") add("win_to_nil_home");
    if (sl === "2" || sl === "away") add("win_to_nil_away");
  }

  return keys;
}

// --- 7. Aggregation & Merging ---

const bestOdds = {};
const flatSources = {};
const comparisonSources = {};
let usedLegacyKeys = false;

// Process Flat Odds
for (const key of Object.keys(raw)) {
  if (key.startsWith("odds_")) {
    const marketMaps = flatKeyToMarketKeys(key); // Fix: Correct function name
    const val = raw[key];

    if (!isValidOdds(val)) {
      if (val !== 0 && val !== -1) qa.markets_skipped_invalid++;
      continue;
    }

    if (marketMaps.length > 0) {
        marketMaps.forEach(m => {
            const entry = { odds: Number(val), book: "internal", source: "flat" };
            flatSources[m.key] = entry;
            if (m.isLegacy) usedLegacyKeys = true;
        });
    } else {
      qa.warnings.push(`Flat odds unmapped: ${key}`);
    }
  }
}

// Process Comparison Odds
const { odds_comparison } = raw;
if (odds_comparison) {
  for (const [category, selections] of Object.entries(odds_comparison)) {
    for (const [selection, books] of Object.entries(selections)) {
      const marketMaps = toMarketKeys(category, selection);

      if (marketMaps.length === 0) {
        // Only warn if category seems relevant (simple heuristic)
        if (!category.includes(" handicap")) qa.warnings.push(`Comparison unmapped: ${category} -> ${selection}`);
        continue;
      }

      let bestOdd = 0;
      let bestBook = "";

      for (const [book, valStr] of Object.entries(books)) {
        if (!isValidOdds(valStr)) continue;
        const val = Number(valStr);
        if (val > bestOdd) {
          bestOdd = val;
          bestBook = book;
        }
      }

      if (bestOdd > 1.0) {
          marketMaps.forEach(m => {
              const entry = { odds: bestOdd, book: bestBook, source: "comparison" };
              comparisonSources[m.key] = entry;
              if (m.isLegacy) usedLegacyKeys = true;
          });
      }
    }
  }
}

// Merge Best Odds
const allKeys = new Set([...Object.keys(flatSources), ...Object.keys(comparisonSources)]);

for (const key of allKeys) {
  const flat = flatSources[key];
  const comp = comparisonSources[key];

  if (flat && comp) {
    bestOdds[key] = (flat.odds >= comp.odds) ? flat : comp;
    qa.markets_merged.push(key);
  } else if (flat) {
    bestOdds[key] = flat;
    qa.markets_from_flat_only.push(key);
  } else if (comp) {
    bestOdds[key] = comp;
    qa.markets_from_comparison_only.push(key);
  }
}

qa.markets_total = Object.keys(bestOdds).length;
if (usedLegacyKeys) qa.warnings.push("deprecated_corner_keys_used");

const oddsGroups = generateGroups(bestOdds);

// --- 8. Signals & Extraction ---

const {
  homeID, awayID, date_unix, season, roundID, game_week,
  home_name, away_name, status, stadium_name, home_image, away_image,
  pre_match_home_ppg, pre_match_away_ppg,
  team_a_xg_prematch, team_b_xg_prematch, total_xg_prematch,
  home_ppg, away_ppg, h2h
} = raw;

const signals = {
  ppg: {
    home: Number(pre_match_home_ppg || home_ppg || 0),
    away: Number(pre_match_away_ppg || away_ppg || 0)
  },
  xg: {
    home: Number(team_a_xg_prematch || 0),
    away: Number(team_b_xg_prematch || 0),
    total: Number(total_xg_prematch || 0)
  },
  potentials: {}
};

// QA Signals
if (!signals.ppg.home) qa.warnings.push("missing_ppg_home");
if (!signals.ppg.away) qa.warnings.push("missing_ppg_away");
if (!signals.xg.home) qa.warnings.push("missing_xg_home");
if (!signals.xg.away) qa.warnings.push("missing_xg_away");

// Potentials
for (const key of Object.keys(raw)) {
  if (key.endsWith("_potential")) {
    const prob = normalizePercent(raw[key]);
    if (prob !== null) signals.potentials[key] = prob;
  }
}

// H2H
let h2hClean = null;
if (h2h) {
  h2hClean = {
    summary: {
      matches_total: h2h.previous_matches_results?.totalMatches || 0,
      home_wins: h2h.previous_matches_results?.team_a_wins || 0,
      away_wins: h2h.previous_matches_results?.team_b_wins || 0,
      draws: h2h.previous_matches_results?.draw || 0,
      p_home_win: normalizePercent(h2h.previous_matches_results?.team_a_win_percent),
      p_away_win: normalizePercent(h2h.previous_matches_results?.team_b_win_percent),
      avg_goals: h2h.betting_stats?.avg_goals || null,
      p_over05: normalizePercent(h2h.betting_stats?.over05Percentage),
      p_over15: normalizePercent(h2h.betting_stats?.over15Percentage),
      p_over25: normalizePercent(h2h.betting_stats?.over25Percentage),
      p_btts: normalizePercent(h2h.betting_stats?.bttsPercentage),
    },
    history_snippet: h2h.previous_matches_ids ? h2h.previous_matches_ids.slice(0, 5) : []
  };
}

// Check QA Status
if (qa.warnings.length > 0) qa.status = "warning";
if (qa.errors.length > 0) qa.status = "soft_error"; // Override warning

// --- 9. Final Output ---
const outputItem = {
  match_id: matchId,
  meta: {
    season,
    round_id: roundID,
    game_week,
    date_unix,
    status
  },
  teams: {
    home: { id: homeID, name: home_name, image: home_image },
    away: { id: awayID, name: away_name, image: away_image }
  },
  context: {
    stadium: stadium_name,
    home_ppg: signals.ppg.home,
    away_ppg: signals.ppg.away,
    team_a_xg_prematch: signals.xg.home,
    team_b_xg_prematch: signals.xg.away,
    total_xg_prematch: signals.xg.total,
    ...signals.potentials
  },
  signals: signals,
  odds: {
    best: bestOdds,
    groups: oddsGroups,
    sources: {
      flat: flatSources,
      comparison: comparisonSources
    }
  },
  h2h: h2hClean,
  qa
};

return [ { json: outputItem } ];
