// -------------------------
// n8n Node: Match Record Normalizer (Robust & Self-Healing)
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

// --- 2. Data Unwrapping ---
let raw;
if (inputData.response && Array.isArray(inputData.response)) {
  raw = inputData.response[0];
} else if (inputData.data) {
  raw = Array.isArray(inputData.data) ? inputData.data[0] : inputData.data;
} else {
  raw = inputData;
}

// --- 3. Helpers ---
function flatKeyToMarketKey(flatKey) {
  // A) Flat Field Mapping
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

  const FLAT_REGEX_MAP = [
    { pattern: /^odds_corners_over_(\d+)$/, map: (m) => `corners_ou_over_${m[1]/10}` },
    { pattern: /^odds_corners_under_(\d+)$/, map: (m) => `corners_ou_under_${m[1]/10}` },
  ];

  if (FLAT_ODDS_MAP[flatKey]) return FLAT_ODDS_MAP[flatKey];
  for (const r of FLAT_REGEX_MAP) {
    const match = flatKey.match(r.pattern);
    if (match) return r.map(match);
  }
  return null;
}

function toMarketKey(category, selection) {
  const c = category.trim();
  const s = selection.trim();
  const sl = s.toLowerCase();

  // 1X2
  if (c === "FT Result") {
    if (sl === "home") return "ft_1x2_home";
    if (sl === "draw") return "ft_1x2_draw";
    if (sl === "away") return "ft_1x2_away";
  }
  if (c === "Half Time Result") {
    if (sl === "home") return "ht_1x2_home";
    if (sl === "draw") return "ht_1x2_draw";
    if (sl === "away") return "ht_1x2_away";
  }
  if (c === "Second Half Result") {
    if (sl === "home") return "2h_1x2_home";
    if (sl === "draw") return "2h_1x2_draw";
    if (sl === "away") return "2h_1x2_away";
  }

  // Double Chance
  if (c === "Double Chance") {
    if (sl === "home/draw" || sl === "home/x") return "dc_1x";
    if (sl === "home/away" || sl === "12") return "dc_12";
    if (sl === "draw/away" || sl === "x/away") return "dc_x2";
  }

  // Draw No Bet
  if (c === "Draw No Bet") {
    if (sl === "home" || sl === "1") return "dnb_home";
    if (sl === "away" || sl === "2") return "dnb_away";
  }

  // Goals
  if (c === "Goals Over/Under" || c === "1st Half Goals" || c === "2nd Half Goals") {
    let prefix = "ft_goals";
    if (c === "1st Half Goals") prefix = "ht_goals";
    if (c === "2nd Half Goals") prefix = "2h_goals";

    if (sl.startsWith("over")) {
      const line = sl.replace("over", "").trim();
      return `${prefix}_over_${line}`;
    }
    if (sl.startsWith("under")) {
      const line = sl.replace("under", "").trim();
      return `${prefix}_under_${line}`;
    }
  }

  // BTTS
  if (c === "Both Teams To Score") {
    if (sl === "yes") return "btts_yes";
    if (sl === "no") return "btts_no";
  }
  if (c === "Both Teams to Score in 1st Half") {
    if (sl === "yes") return "ht_btts_yes";
    if (sl === "no") return "ht_btts_no";
  }
  if (c === "Both Teams to Score in 2nd Half") {
    if (sl === "yes") return "2h_btts_yes";
    if (sl === "no") return "2h_btts_no";
  }

  // Corners
  if (c === "Corners") {
    if (sl.startsWith("over")) {
      const line = sl.replace("over", "").trim();
      return `corners_ou_over_${line}`;
    }
    if (sl.startsWith("under")) {
      const line = sl.replace("under", "").trim();
      return `corners_ou_under_${line}`;
    }
  }
  if (c === "Corners 1X2" || c === "Corner Match Bet") {
    if (sl === "home" || sl === "1") return "corners_1x2_home";
    if (sl === "draw" || sl === "x") return "corners_1x2_draw";
    if (sl === "away" || sl === "2") return "corners_1x2_away";
  }

  // Clean Sheet
  if (c === "Clean Sheet - Home") {
    if (sl === "yes") return "cs_home_yes";
    if (sl === "no") return "cs_home_no";
  }
  if (c === "Clean Sheet - Away") {
    if (sl === "yes") return "cs_away_yes";
    if (sl === "no") return "cs_away_no";
  }

  // Win to Nil
  if (c === "Win To Nil") {
    if (sl === "1" || sl === "home") return "win_to_nil_home";
    if (sl === "2" || sl === "away") return "win_to_nil_away";
  }

  return null;
}

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
    // Goals O/U
    const goalMatch = key.match(/^(ft|ht|2h)_goals_(over|under)_([\d.]+)$/);
    if (goalMatch) {
      const [_, period, type, line] = goalMatch;
      const groupKey = `${period}_goals_${line}`;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(key);
    }
    // Corners O/U
    const cornerMatch = key.match(/^corners_ou_(over|under)_([\d.]+)$/);
    if (cornerMatch) {
      const [_, type, line] = cornerMatch;
      const groupKey = `corners_ou_${line}`;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(key);
    }
  });

  return groups;
}

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

// --- 4. Logic Branching ---

// Case A: Input is Already Normalized (Pass-through + Repair)
if (raw && raw.match_id && raw.odds && raw.odds.best) {
    if (!raw.qa) raw.qa = {};
    if (!raw.qa.warnings) raw.qa.warnings = [];
    raw.qa.warnings.push("input_already_normalized");

    // Self-Healing: Generate Groups if missing
    if (!raw.odds.groups) {
        raw.odds.groups = generateGroups(raw.odds.best);
        raw.qa.warnings.push("repaired_missing_groups");
    }

    return [{ json: raw }];
}

// Case B: Raw Input (Normalize)
if (!raw || !raw.id) {
   return [{ json: { error: "No valid match data found (missing raw.id)", input_keys: Object.keys(inputData) } }];
}

const {
  id,
  homeID,
  awayID,
  date_unix,
  season,
  roundID,
  game_week,
  home_name,
  away_name,
  status,
  h2h,
  odds_comparison,
  stadium_name,
  home_image,
  away_image,
  pre_match_home_ppg,
  pre_match_away_ppg,
  team_a_xg_prematch,
  team_b_xg_prematch,
  total_xg_prematch,
  home_ppg,
  away_ppg
} = raw;

// QA Container
const qa = {
  markets_total: 0,
  markets_from_flat_only: [],
  markets_from_comparison_only: [],
  markets_merged: [],
  markets_skipped_invalid: 0,
  warnings: []
};

// --- 6. Odds Aggregation ---
const flatSources = {};
for (const key of Object.keys(raw)) {
  if (key.startsWith("odds_")) {
    const marketKey = flatKeyToMarketKey(key);
    const val = raw[key];

    if (!isValidOdds(val)) {
      if (val !== 0 && val !== -1) {
         qa.markets_skipped_invalid++;
      }
      continue;
    }

    if (marketKey) {
      flatSources[marketKey] = { odds: Number(val), book: "internal", source: "flat" };
    } else {
      qa.warnings.push(`Flat odds unmapped: ${key}`);
    }
  }
}

const comparisonSources = {};
if (odds_comparison) {
  for (const [category, selections] of Object.entries(odds_comparison)) {
    for (const [selection, books] of Object.entries(selections)) {
      const marketKey = toMarketKey(category, selection);

      if (!marketKey) {
        qa.warnings.push(`Comparison unmapped: ${category} -> ${selection}`);
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
        comparisonSources[marketKey] = { odds: bestOdd, book: bestBook, source: "comparison" };
      }
    }
  }
}

const bestOdds = {};
const allKeys = new Set([...Object.keys(flatSources), ...Object.keys(comparisonSources)]);

for (const key of allKeys) {
  const flat = flatSources[key];
  const comp = comparisonSources[key];

  if (flat && comp) {
    if (flat.odds >= comp.odds) {
      bestOdds[key] = flat;
    } else {
      bestOdds[key] = comp;
    }
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

const oddsGroups = generateGroups(bestOdds);

// --- 8. Signals & H2H Extraction ---

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
  potentials: {} // To be populated
};

if (!signals.ppg.home) qa.warnings.push("missing_ppg_home");
if (!signals.ppg.away) qa.warnings.push("missing_ppg_away");
if (!signals.xg.home) qa.warnings.push("missing_xg_home");
if (!signals.xg.away) qa.warnings.push("missing_xg_away");

for (const key of Object.keys(raw)) {
  if (key.endsWith("_potential")) {
    const prob = normalizePercent(raw[key]);
    if (prob !== null) {
      signals.potentials[key] = prob;
    }
  }
}

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

const outputItem = {
  match_id: id,
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
    stadium: stadium_name
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
