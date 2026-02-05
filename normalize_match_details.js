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
  pre_match_home_ppg,
  pre_match_away_ppg,
  team_a_xg_prematch,
  team_b_xg_prematch,
  status,
  h2h,
  odds_comparison
} = data.response ? data.response[0] : (data.data || data); // Handle both wrapped and unwrapped

// --- CONFIGURATION: ODDS MAPPING ---
// Maps FootyStats 'odds_comparison' keys to our Internal Keys.
const ODDS_MAPPING = {
  "FT Result": {
    type: "1X2",
    selections: { "Home": "1", "Draw": "X", "Away": "2" }
  },
  "Both Teams To Score": {
    type: "BTTS",
    selections: { "Yes": "yes", "No": "no" }
  },
  "Double Chance": {
    type: "double_chance",
    selections: { "Home/Draw": "1X", "Home/Away": "12", "Draw/Away": "X2" }
  },
  "Draw No Bet": {
    type: "DNB",
    selections: { "Home": "1", "Away": "2" }
  },
  "Goals Over/Under": {
    type: "over_under",
    // These keys often appear as "Over 0.5", "Under 2.5", etc.
    // We will parse the selection string dynamically.
    is_line_market: true
  },
  "1st Half Goals": {
    type: "over_under_1h",
    is_line_market: true
  },
  "Half Time Result": {
    type: "1X2_1h",
    selections: { "Home": "1", "Draw": "X", "Away": "2" }
  }
};

// --- HELPER: Calculate Stats from Bookmakers ---
function getOddsStats(bookmakerObj) {
  if (!bookmakerObj || typeof bookmakerObj !== 'object') return null;

  const values = Object.values(bookmakerObj)
    .map(v => parseFloat(v))
    .filter(v => !isNaN(v) && v > 1.0); // Filter valid odds

  if (values.length === 0) return null;

  const max = Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;

  return { max: parseFloat(max.toFixed(3)), avg: parseFloat(avg.toFixed(3)), count: values.length };
}

// --- HELPER: Normalize Selection Key ---
// E.g., "Over 2.5" -> { key: "over", line: 2.5 }
function parseSelectionKey(selKey) {
  const lower = selKey.toLowerCase();
  if (lower.includes("over")) {
    const parts = lower.split(" ");
    const line = parts[parts.length - 1];
    return { key: "over", line: parseFloat(line) };
  }
  if (lower.includes("under")) {
    const parts = lower.split(" ");
    const line = parts[parts.length - 1];
    return { key: "under", line: parseFloat(line) };
  }
  return { key: selKey, line: null };
}

// --- MAIN LOGIC: Extract Odds ---
const extracted_odds = {};

if (odds_comparison) {
  for (const [fsMarket, marketData] of Object.entries(odds_comparison)) {
    const mapping = ODDS_MAPPING[fsMarket];

    // Skip unmapped markets for now, or log them if needed
    if (!mapping) continue;

    for (const [fsSelection, bookies] of Object.entries(marketData)) {
      const stats = getOddsStats(bookies);
      if (!stats) continue;

      if (mapping.is_line_market) {
        // Handle Over/Under Lines dynamically
        const parsed = parseSelectionKey(fsSelection);
        if (parsed.line !== null && !isNaN(parsed.line)) {
          // Structure: odds.over_under[2.5].over = ...
          if (!extracted_odds[mapping.type]) extracted_odds[mapping.type] = {};
          if (!extracted_odds[mapping.type][parsed.line]) extracted_odds[mapping.type][parsed.line] = {};

          extracted_odds[mapping.type][parsed.line][parsed.key] = stats;
        }
      } else {
        // Handle Fixed Selections (1X2, BTTS)
        const internalSel = mapping.selections[fsSelection];
        if (internalSel) {
          if (!extracted_odds[mapping.type]) extracted_odds[mapping.type] = {};
          extracted_odds[mapping.type][internalSel] = stats;
        }
      }
    }
  }
}

// --- FALLBACK: Flat Odds Fields ---
// If detailed comparison is missing for a key, try to fill from flat fields (data.odds_ft_1, etc.)
// Note: Flat fields are usually just one value (likely average or a specific bookie).
// We treat them as 'avg' and 'max' equal if we don't have better data.

const flat_mappings = [
  { fs: 'odds_ft_1', target: '1X2', sel: '1' },
  { fs: 'odds_ft_x', target: '1X2', sel: 'X' },
  { fs: 'odds_ft_2', target: '1X2', sel: '2' },
  { fs: 'odds_btts_yes', target: 'BTTS', sel: 'yes' },
  { fs: 'odds_btts_no', target: 'BTTS', sel: 'no' },
  // Add O/U if needed, though usually they are plentiful in comparison
];

flat_mappings.forEach(map => {
  const val = parseFloat(data[map.fs]);
  if (!isNaN(val) && val > 0) {
    if (!extracted_odds[map.target]) extracted_odds[map.target] = {};
    // Only set if not already present from detailed comparison
    if (!extracted_odds[map.target][map.sel]) {
       extracted_odds[map.target][map.sel] = { max: val, avg: val, count: 1, source: "flat_fallback" };
    }
  }
});


// --- OUTPUT CONSTRUCTION ---
return {
  match_id: id,
  match_status: status,
  fixture_date: date_unix, // Unix timestamp
  meta: {
    season: season,
    round_id: roundID,
    game_week: game_week,
    home_team: { id: homeID, name: home_name },
    away_team: { id: awayID, name: away_name }
  },
  // Cleaned Pre-Match Stats (Stats available BEFORE the match starts)
  pre_match_stats: {
    ppg: {
      home: parseFloat(pre_match_home_ppg) || 0,
      away: parseFloat(pre_match_away_ppg) || 0
    },
    xg: {
      home: parseFloat(team_a_xg_prematch) || 0,
      away: parseFloat(team_b_xg_prematch) || 0
    }
  },
  // Normalized Odds (Max/Avg)
  odds: extracted_odds,
  // H2H Summary (Raw for now, can be processed further if needed)
  h2h_summary: h2h ? {
    previous_matches_count: h2h.previous_matches_results ? h2h.previous_matches_results.totalMatches : 0,
    home_wins: h2h.previous_matches_results ? h2h.previous_matches_results.team_a_wins : 0,
    away_wins: h2h.previous_matches_results ? h2h.previous_matches_results.team_b_wins : 0,
    draws: h2h.previous_matches_results ? h2h.previous_matches_results.draw : 0
  } : null
};
