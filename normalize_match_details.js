// -------------------------
// n8n Node: Match Details Normalizer
// -------------------------

// --- 1. Input Extraction Helper ---
// Robustly determines the input object regardless of n8n execution mode (Run Once vs Run Each)
function getInput() {
  if (typeof item !== 'undefined' && item.json) return item.json;
  if (typeof items !== 'undefined' && items.length > 0 && items[0].json) return items[0].json;
  if (typeof $input !== 'undefined' && $input.item) return $input.item.json;
  if (typeof data !== 'undefined') return data; // Fallback for local testing if 'data' global is set
  return {};
}

const inputData = getInput();

// --- 2. Data Unwrapping ---
// FootyStats responses can be:
// A) { response: [ { ... } ] }  (API v2 style)
// B) { data: { ... } }          (Match Details style)
// C) { ... }                    (Directly merged)

let raw;
if (inputData.response && Array.isArray(inputData.response)) {
  raw = inputData.response[0];
} else if (inputData.data) {
  // If 'data' is an array, take first; if object, take it.
  raw = Array.isArray(inputData.data) ? inputData.data[0] : inputData.data;
} else {
  // Assume input is already the raw object
  raw = inputData;
}

// Guard: If we still don't have an ID, abort or return error
if (!raw || !raw.id) {
   // Return empty or error object so n8n flow doesn't crash hard, or let it flow
   // n8n expects an array of objects return.
   return [{ json: { error: "No valid match data found", input_keys: Object.keys(inputData) } }];
}

// --- 3. Destructuring ---
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
} = raw;

// --- 4. Configuration: Odds Mapping ---
// Maps FootyStats 'odds_comparison' keys to Internal Keys.
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

// --- 5. Helpers ---
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

// --- 6. Main Logic: Extract Odds ---
const extracted_odds = {};

if (odds_comparison) {
  for (const [fsMarket, marketData] of Object.entries(odds_comparison)) {
    const mapping = ODDS_MAPPING[fsMarket];
    if (!mapping) continue;

    for (const [fsSelection, bookies] of Object.entries(marketData)) {
      const stats = getOddsStats(bookies);
      if (!stats) continue;

      if (mapping.is_line_market) {
        const parsed = parseSelectionKey(fsSelection);
        if (parsed.line !== null && !isNaN(parsed.line)) {
          if (!extracted_odds[mapping.type]) extracted_odds[mapping.type] = {};
          if (!extracted_odds[mapping.type][parsed.line]) extracted_odds[mapping.type][parsed.line] = {};
          extracted_odds[mapping.type][parsed.line][parsed.key] = stats;
        }
      } else {
        const internalSel = mapping.selections[fsSelection];
        if (internalSel) {
          if (!extracted_odds[mapping.type]) extracted_odds[mapping.type] = {};
          extracted_odds[mapping.type][internalSel] = stats;
        }
      }
    }
  }
}

// --- 7. Fallback: Flat Odds Fields ---
const flat_mappings = [
  { fs: 'odds_ft_1', target: '1X2', sel: '1' },
  { fs: 'odds_ft_x', target: '1X2', sel: 'X' },
  { fs: 'odds_ft_2', target: '1X2', sel: '2' },
  { fs: 'odds_btts_yes', target: 'BTTS', sel: 'yes' },
  { fs: 'odds_btts_no', target: 'BTTS', sel: 'no' },
];

flat_mappings.forEach(map => {
  const val = parseFloat(raw[map.fs]);
  if (!isNaN(val) && val > 0) {
    if (!extracted_odds[map.target]) extracted_odds[map.target] = {};
    if (!extracted_odds[map.target][map.sel]) {
       extracted_odds[map.target][map.sel] = { max: val, avg: val, count: 1, source: "flat_fallback" };
    }
  }
});

// --- 8. Output Construction ---
const outputItem = {
  match_id: id,
  match_status: status,
  fixture_date: date_unix, 
  meta: {
    season: season,
    round_id: roundID,
    game_week: game_week,
    home_team: { id: homeID, name: home_name },
    away_team: { id: awayID, name: away_name }
  },
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
  odds: extracted_odds,
  h2h_summary: h2h ? {
    previous_matches_count: h2h.previous_matches_results ? h2h.previous_matches_results.totalMatches : 0,
    home_wins: h2h.previous_matches_results ? h2h.previous_matches_results.team_a_wins : 0,
    away_wins: h2h.previous_matches_results ? h2h.previous_matches_results.team_b_wins : 0,
    draws: h2h.previous_matches_results ? h2h.previous_matches_results.draw : 0
  } : null
};

// Return array for n8n
return [ { json: outputItem } ];
