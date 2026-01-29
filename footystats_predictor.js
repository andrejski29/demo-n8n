/**
 * FootyStats Predictor Engine (v1)
 * Designed for n8n Code Node (JavaScript)
 *
 * INSTRUCTIONS FOR N8N:
 * 1. Copy the entire content of this file.
 * 2. Paste it into an n8n "Code" node.
 * 3. Ensure the input to the node is the merged JSON array from FootyStats.
 * 4. The node will output the analysis for the first match found in the input.
 *
 * This script consumes FootyStats API data (Merge.json structure),
 * computes probabilities using a Poisson model, and generates ranked betting picks.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  season_current: "2025/2026",
  season_prev: "2024/2025",
  season_format_filter: "Domestic League",

  // Data Blending Weights
  weight_season_current: 0.85,
  weight_season_prev: 0.15,

  // Lambda Estimation Weights (Season vs Form)
  weight_lambda_season: 0.65,
  weight_lambda_form: 0.35, // Last 5

  // Guardrails
  lambda_min: 0.2,
  lambda_max: 3.5,
  league_avg_goals_fallback: 1.25, // Per team

  // Picks
  min_edge: 0.0, // Minimum edge to consider a value pick
  debug: true
};

// ============================================================================
// 1. DATA PARSER & NORMALIZER
// ============================================================================
class DataParser {
  constructor(inputArray) {
    this.rawData = inputArray;
    this.matchDetails = null;
    this.homeStats = [];
    this.awayStats = [];
    this.homeLast5 = null;
    this.awayLast5 = null;
  }

  parse() {
    // 1. Identify Match Details (Single Object with specific fields)
    // 2. Identify Team Stats (Arrays of objects)
    // 3. Identify Last X Stats (Objects with last_x)

    // The Merge.json is an array of API response objects.
    // We iterate through them to categorize.

    // In n8n, input might be wrapped. We assume the raw array is passed.
    if (!Array.isArray(this.rawData)) {
      throw new Error("Input is not an array. Ensure Merge.json structure is passed.");
    }

    this.rawData.forEach(item => {
        // Unpack "json" if wrapped in n8n structure, then "data"
        let root = item;
        if (item.json) root = item.json;

        const dataPayload = root.data || root;

        // Check for Match Details (has homeID, awayID, odds_comparison)
        if (dataPayload.homeID && dataPayload.awayID && !Array.isArray(dataPayload)) {
            this.matchDetails = dataPayload;
            return;
        }

        // Check for Team Stats (Array of season objects)
        if (Array.isArray(dataPayload)) {
            // We need to figure out if this array belongs to Home or Away team.
            // We can't know for sure until we have matchDetails to compare IDs.
            // So we store them temp and assign later.
            // However, usually the order in Merge is Home, Away.
            // Better approach: Check IDs against matchDetails once found.
            // BUT: We might find stats before match details.

            // Let's store all arrays found and assign them after loop.
            // Actually, let's look at the first element to see the ID.
            if (dataPayload.length > 0) {
               // Store primarily based on ID match later
               this.homeStats.push(dataPayload); // Temp storage, will filter later
            }
        }

        // Check for Last X (Has last_x property)
        if (dataPayload.last_x) {
             // Again, need ID to confirm Home vs Away
             // We will store in a bucket to sort later.
             this.tempLastX = this.tempLastX || [];
             this.tempLastX.push(dataPayload);
        }
    });

    if (!this.matchDetails) {
        throw new Error("Match Details not found in input data.");
    }

    // Now resolve Home/Away stats based on IDs
    const homeID = this.matchDetails.homeID;
    const awayID = this.matchDetails.awayID;

    // Filter the arrays we found to find the one matching Home ID
    // The rawData contains multiple arrays (one for home, one for away).
    // We flatmap the inputs that were arrays.

    let allTeamSeasons = [];
    this.rawData.forEach(item => {
        let root = item;
        if (item.json) root = item.json;
        const d = root.data || root;

        if(Array.isArray(d)) {
            allTeamSeasons = allTeamSeasons.concat(d);
        }
    });

    // Select Home Team Rows
    this.homeStatsRows = this._selectSeasonRows(allTeamSeasons, homeID);

    // Select Away Team Rows
    this.awayStatsRows = this._selectSeasonRows(allTeamSeasons, awayID);

    // Resolve Last X
    // The input structure for Last X in Merge.json is usually a single object per file content.
    // We check this.tempLastX if popualted, or scan rawData again looking for single objects with 'last_x'

    this.rawData.forEach(item => {
        let root = item;
        if (item.json) root = item.json;
        const d = root.data || root;

        if (d.last_x && d.id) {
            if (d.id === homeID) this.homeLast5 = d;
            if (d.id === awayID) this.awayLast5 = d;
        }
        // Sometimes Last X is inside an array? No, usually single object.
        // But in the provided Merge.json example, it looks like an array of objects is returned for the team stats
        // and separate objects for Last X.
    });
  }

  _selectSeasonRows(allRows, teamID) {
    // Filter by Team ID and Domestic League
    const teamRows = allRows.filter(r => r.id === teamID && (r.season_format === CONFIG.season_format_filter || r.season_format === "Domestic League"));

    const current = teamRows.find(r => r.season === CONFIG.season_current);
    const prev = teamRows.find(r => r.season === CONFIG.season_prev);

    return {
        current: current || null,
        prev: prev || null
    };
  }

  getCleanInput() {
      return {
          match_id: this.matchDetails.id,
          home_team: this.matchDetails.home_name,
          away_team: this.matchDetails.away_name,
          season_rows_used: {
              home: {
                  current: !!this.homeStatsRows.current,
                  prev: !!this.homeStatsRows.prev
              },
              away: {
                  current: !!this.awayStatsRows.current,
                  prev: !!this.awayStatsRows.prev
              }
          }
      };
  }
}

// ============================================================================
// 2. FEATURE ENGINEERING
// ============================================================================
class FeatureEngineer {
    constructor(parserData) {
        this.data = parserData;
        this.debug = {};
    }

    calculate() {
        // Calculate Weighted Stats for Home and Away
        const homeStats = this._blendStats(this.data.homeStatsRows, "home");
        const awayStats = this._blendStats(this.data.awayStatsRows, "away");

        // Calculate Lambdas (Expected Goals)
        // Method: Strength Based
        // Home Goals Exp = (Home Attack Strength * Away Defence Strength * League Avg Home Goals)
        // OR simpler v1: Weighted Avg of Scored + Conceded

        // Using User Requested Method:
        // Weighted blend of Season Stats (65%) + Last 5 Form (35%)

        // 1. Derive Season-Based Expectation
        // Home Team at Home:
        const h_attack = homeStats.seasonScoredAVG_home || 0;
        const h_concede = homeStats.seasonConcededAVG_home || 0;

        // Away Team at Away:
        const a_attack = awayStats.seasonScoredAVG_away || 0;
        const a_concede = awayStats.seasonConcededAVG_away || 0;

        // Basic Poisson Lambda:
        // Lambda Home = (Home Scored Home + Away Conceded Away) / 2  <-- Simple approximation
        // Better: Weighting recent form.

        const h_form_scored = this.data.homeLast5 ? (this.data.homeLast5.stats.seasonScoredAVG_overall || 0) : h_attack;
        const a_form_conceded = this.data.awayLast5 ? (this.data.awayLast5.stats.seasonConcededAVG_overall || 0) : a_concede;

        const a_form_scored = this.data.awayLast5 ? (this.data.awayLast5.stats.seasonScoredAVG_overall || 0) : a_attack;
        const h_form_conceded = this.data.homeLast5 ? (this.data.homeLast5.stats.seasonConcededAVG_overall || 0) : h_concede;

        // Calculate blended metrics
        const h_attack_blend = (h_attack * CONFIG.weight_lambda_season) + (h_form_scored * CONFIG.weight_lambda_form);
        const a_defense_blend = (a_concede * CONFIG.weight_lambda_season) + (a_form_conceded * CONFIG.weight_lambda_form);

        const a_attack_blend = (a_attack * CONFIG.weight_lambda_season) + (a_form_scored * CONFIG.weight_lambda_form);
        const h_defense_blend = (h_concede * CONFIG.weight_lambda_season) + (h_form_conceded * CONFIG.weight_lambda_form);

        // Final Lambdas (Average of Attack vs Defense)
        // Ideally should be relative to league, but taking direct averages is robust for v1
        let lambda_home = (h_attack_blend + a_defense_blend) / 2;
        let lambda_away = (a_attack_blend + h_defense_blend) / 2;

        // Fallback / Guardrails
        if (!lambda_home || isNaN(lambda_home)) lambda_home = CONFIG.league_avg_goals_fallback;
        if (!lambda_away || isNaN(lambda_away)) lambda_away = CONFIG.league_avg_goals_fallback;

        // Clamp
        lambda_home = Math.max(CONFIG.lambda_min, Math.min(CONFIG.lambda_max, lambda_home));
        lambda_away = Math.max(CONFIG.lambda_min, Math.min(CONFIG.lambda_max, lambda_away));

        // --- 1st Half Lambdas (Tier 2) ---
        // Using HT averages if available
        let lambda_home_1h = 0;
        let lambda_away_1h = 0;

        if (homeStats.scoredAVGHT_home !== undefined && awayStats.concededAVGHT_away !== undefined) {
             const h_attack_1h = homeStats.scoredAVGHT_home;
             const a_concede_1h = awayStats.concededAVGHT_away;
             const a_attack_1h = awayStats.scoredAVGHT_away;
             const h_concede_1h = homeStats.concededAVGHT_home;

             // Simple average for v1 HT model
             lambda_home_1h = (h_attack_1h + a_concede_1h) / 2;
             lambda_away_1h = (a_attack_1h + h_concede_1h) / 2;

             // Clamp 1H lambdas
             lambda_home_1h = Math.max(0.05, Math.min(2.0, lambda_home_1h));
             lambda_away_1h = Math.max(0.05, Math.min(2.0, lambda_away_1h));
        } else {
             // Fallback: ~45% of full time goals?
             lambda_home_1h = lambda_home * 0.45;
             lambda_away_1h = lambda_away * 0.45;
        }

        this.debug.lambdas = { raw_home: lambda_home, raw_away: lambda_away, home_1h: lambda_home_1h, away_1h: lambda_away_1h };

        return {
            lambda_home,
            lambda_away,
            lambda_home_1h,
            lambda_away_1h,
            h_attack_blend,
            h_defense_blend,
            a_attack_blend,
            a_defense_blend
        };
    }

    _blendStats(rows, side) {
        // Blends Current (85%) and Previous (15%) season data
        if (!rows.current && !rows.prev) {
            // Major Fallback if no domestic league data found
            return {
                seasonScoredAVG_home: CONFIG.league_avg_goals_fallback,
                seasonConcededAVG_home: CONFIG.league_avg_goals_fallback,
                seasonScoredAVG_away: CONFIG.league_avg_goals_fallback,
                seasonConcededAVG_away: CONFIG.league_avg_goals_fallback,
                scoredAVGHT_home: CONFIG.league_avg_goals_fallback * 0.45,
                concededAVGHT_home: CONFIG.league_avg_goals_fallback * 0.45,
                scoredAVGHT_away: CONFIG.league_avg_goals_fallback * 0.45,
                concededAVGHT_away: CONFIG.league_avg_goals_fallback * 0.45
            };
        }

        if (!rows.prev) return rows.current.stats; // Only current
        if (!rows.current) return rows.prev.stats; // Only prev (rare)

        // Blend
        const c = rows.current.stats;
        const p = rows.prev.stats;
        const wc = CONFIG.weight_season_current;
        const wp = CONFIG.weight_season_prev;

        return {
            seasonScoredAVG_home: (c.seasonScoredAVG_home * wc) + (p.seasonScoredAVG_home * wp),
            seasonConcededAVG_home: (c.seasonConcededAVG_home * wc) + (p.seasonConcededAVG_home * wp),
            seasonScoredAVG_away: (c.seasonScoredAVG_away * wc) + (p.seasonScoredAVG_away * wp),
            seasonConcededAVG_away: (c.seasonConcededAVG_away * wc) + (p.seasonConcededAVG_away * wp),

            // HT Stats
            scoredAVGHT_home: (c.scoredAVGHT_home * wc) + (p.scoredAVGHT_home * wp),
            concededAVGHT_home: (c.concededAVGHT_home * wc) + (p.concededAVGHT_home * wp),
            scoredAVGHT_away: (c.scoredAVGHT_away * wc) + (p.scoredAVGHT_away * wp),
            concededAVGHT_away: (c.concededAVGHT_away * wc) + (p.concededAVGHT_away * wp),
        };
    }
}

// ============================================================================
// 3. PROBABILITY ENGINE (POISSON)
// ============================================================================
class PoissonEngine {
    constructor(lambdaHome, lambdaAway, lambdaHome1H = null, lambdaAway1H = null) {
        this.lh = lambdaHome;
        this.la = lambdaAway;
        this.lh1h = lambdaHome1H;
        this.la1h = lambdaAway1H;

        this.maxGoals = 6; // Matrix size 0-6
        this.matrix = [];
        this.matrix1h = [];
        this.probabilities = {};
    }

    compute() {
        // --- Full Time ---
        this._buildMatrix(this.lh, this.la, this.matrix);

        // 3. Derive FT Markets
        this._calc1X2(this.matrix, "1X2");
        this._calcOU(this.matrix, "OverUnder");
        this._calcBTTS(this.matrix, "BTTS");
        this._calcDoubleChance();
        this._calcDNB();

        // --- Half Time ---
        if (this.lh1h && this.la1h) {
            this._buildMatrix(this.lh1h, this.la1h, this.matrix1h);
            this._calc1X2(this.matrix1h, "1X2_1H");
            this._calcOU(this.matrix1h, "OverUnder_1H", [0.5, 1.5, 2.5]);
            this._calcBTTS(this.matrix1h, "BTTS_1H");
        }

        return this.probabilities;
    }

    _buildMatrix(lh, la, matrixRef) {
        let totalProb = 0;
        for (let h = 0; h <= this.maxGoals; h++) {
            matrixRef[h] = [];
            for (let a = 0; a <= this.maxGoals; a++) {
                const p = this._poisson(lh, h) * this._poisson(la, a);
                matrixRef[h][a] = p;
                totalProb += p;
            }
        }

        // Normalize
        const scale = 1 / totalProb;
        for (let h = 0; h <= this.maxGoals; h++) {
            for (let a = 0; a <= this.maxGoals; a++) {
                matrixRef[h][a] *= scale;
            }
        }
    }

    _poisson(lambda, k) {
        return (Math.pow(lambda, k) * Math.exp(-lambda)) / this._factorial(k);
    }

    _factorial(n) {
        if (n === 0) return 1;
        let res = 1;
        for (let i = 2; i <= n; i++) res *= i;
        return res;
    }

    _calc1X2(matrix, key) {
        let home = 0, draw = 0, away = 0;
        for (let h = 0; h <= this.maxGoals; h++) {
            for (let a = 0; a <= this.maxGoals; a++) {
                const p = matrix[h][a];
                if (h > a) home += p;
                else if (h === a) draw += p;
                else away += p;
            }
        }
        this.probabilities[key] = { "1": home, "X": draw, "2": away };
    }

    _calcOU(matrix, key, customLines = null) {
        const lines = customLines || [0.5, 1.5, 2.5, 3.5, 4.5];
        this.probabilities[key] = {};

        lines.forEach(line => {
            let over = 0;
            for (let h = 0; h <= this.maxGoals; h++) {
                for (let a = 0; a <= this.maxGoals; a++) {
                    if ((h + a) > line) over += matrix[h][a];
                }
            }
            this.probabilities[key][line] = { "Over": over, "Under": 1 - over };
        });
    }

    _calcBTTS(matrix, key) {
        let yes = 0;
        for (let h = 1; h <= this.maxGoals; h++) {
            for (let a = 1; a <= this.maxGoals; a++) {
                yes += matrix[h][a];
            }
        }
        this.probabilities[key] = { "Yes": yes, "No": 1 - yes };
    }

    _calcDoubleChance() {
        const p = this.probabilities["1X2"];
        this.probabilities["DoubleChance"] = {
            "1X": p["1"] + p["X"],
            "12": p["1"] + p["2"],
            "X2": p["X"] + p["2"]
        };
    }

    _calcDNB() {
        const p = this.probabilities["1X2"];
        // Draw No Bet: Exclude draw, re-normalize
        const denom = p["1"] + p["2"];
        this.probabilities["DNB"] = {
            "1": p["1"] / denom,
            "2": p["2"] / denom
        };
    }
}

// ============================================================================
// 4. ODDS PROCESSOR & PICK RANKER
// ============================================================================
class OddsProcessor {
    constructor(oddsData) {
        this.odds = oddsData || {}; // odds_comparison object
    }

    getBestOdds(market, selection) {
        // Map internal keys to FootyStats keys
        // Example: market="1X2", selection="1" -> "FT Result" -> "Home"

        const map = {
            "1X2": { key: "FT Result", sels: { "1": "Home", "X": "Draw", "2": "Away" } },
            "BTTS": { key: "Both Teams To Score", sels: { "Yes": "Yes", "No": "No" } },
            "OverUnder": { key: "Goals Over/Under", isLine: true },
            "DoubleChance": { key: "Double Chance", sels: { "1X": "Home/Draw", "12": "Home/Away", "X2": "Draw/Away" } },
            "DNB": { key: "Draw No Bet", sels: {"1": "1", "2": "2"} },

            // HT Markets
            "1X2_1H": { key: "Half Time Result", sels: { "1": "Home", "X": "Draw", "2": "Away" } },
            "BTTS_1H": { key: "Both Teams to Score in 1st Half", sels: { "Yes": "Yes", "No": "No" } },
            "OverUnder_1H": { key: "1st Half Goals", isLine: true } // Handled via specific check in PickRanker but good to list
        };

        // Handle standard markets
        if (map[market] && !map[market].isLine) {
            const cat = this.odds[map[market].key];
            if (!cat) return null;
            const selName = map[market].sels[selection];
            const bookies = cat[selName];
            return this._findMax(bookies);
        }

        // Handle OU Lines
        if (market === "OverUnder") {
            const cat = this.odds["Goals Over/Under"];
            if (!cat) return null;
            // selection is like "Over 2.5" or just "2.5" -> "Over"
            // The engine passes market="OverUnder", selection="Over", line=2.5
            // But this method signature is generic. Let's adjust usage in PickRanker.
        }

        return null;
    }

    getMaxOddsForLine(marketCategory, selectionKey) {
        const cat = this.odds[marketCategory];
        if(!cat) return null;
        const bookies = cat[selectionKey];
        return this._findMax(bookies);
    }

    _findMax(bookiesObj) {
        if (!bookiesObj) return null;
        let maxVal = 0;
        let bestBookie = "";

        for (const [bookie, val] of Object.entries(bookiesObj)) {
            const floatVal = parseFloat(val);
            if (floatVal > maxVal) {
                maxVal = floatVal;
                bestBookie = bookie;
            }
        }

        return maxVal > 0 ? { odd: maxVal, bookmaker: bestBookie } : null;
    }
}

class PickRanker {
    constructor(probs, oddsProc) {
        this.probs = probs;
        this.oddsProc = oddsProc;
        this.picks = [];
    }

    generate() {
        // 1X2
        this._eval("1X2", "1");
        this._eval("1X2", "X");
        this._eval("1X2", "2");

        // BTTS
        this._eval("BTTS", "Yes");
        this._eval("BTTS", "No");

        // Double Chance
        this._eval("DoubleChance", "1X");
        this._eval("DoubleChance", "X2");
        this._eval("DoubleChance", "12");

        // DNB
        // DNB keys in FootyStats often vary, skipping direct mapping if risky,
        // but let's try standardizing based on observation.

        // O/U
        const lines = ["0.5", "1.5", "2.5", "3.5", "4.5"];
        lines.forEach(line => {
            this._evalOU(line, "Over", "OverUnder");
            this._evalOU(line, "Under", "OverUnder");
        });

        // --- HT Markets ---
        if (this.probs["1X2_1H"]) {
            this._eval("1X2_1H", "1");
            this._eval("1X2_1H", "X");
            this._eval("1X2_1H", "2");
        }

        if (this.probs["BTTS_1H"]) {
            this._eval("BTTS_1H", "Yes");
            this._eval("BTTS_1H", "No");
        }

        if (this.probs["OverUnder_1H"]) {
            const lines1h = ["0.5", "1.5", "2.5"];
            lines1h.forEach(line => {
                this._evalOU(line, "Over", "OverUnder_1H");
                this._evalOU(line, "Under", "OverUnder_1H");
            });
        }

        // Sorting
        // Rank Score = Edge * 100 + Prob * 10
        this.picks.sort((a, b) => b.rank_score - a.rank_score);

        return this.picks;
    }

    _eval(market, selection) {
        const p = this.probs[market][selection];
        const best = this.oddsProc.getBestOdds(market, selection);
        this._addPick(market, selection, null, p, best);
    }

    _evalOU(line, side, marketKey) {
        const p = this.probs[marketKey][line][side];
        // Map to odds key: "Over 2.5" / "Under 2.5"
        const key = `${side} ${line}`;

        let oddsCategory = "Goals Over/Under";
        if (marketKey === "OverUnder_1H") oddsCategory = "1st Half Goals";

        const best = this.oddsProc.getMaxOddsForLine(oddsCategory, key);
        this._addPick(marketKey, side, line, p, best);
    }

    _addPick(market, selection, line, prob, bestOddsObj) {
        const fair = 1 / prob;
        let edge = 0;
        let rank = 0;
        let tags = [];

        if (bestOddsObj) {
            edge = (bestOddsObj.odd * prob) - 1;
            rank = (edge * 100) + (prob * 20); // Weight edge higher
            if (edge > CONFIG.min_edge) tags.push("VALUE");
        } else {
            rank = prob * 10; // Fallback ranking by confidence
            tags.push("NO_ODDS");
        }

        if (prob > 0.7) tags.push("HIGH_CONFIDENCE");

        this.picks.push({
            market,
            selection,
            line,
            probability: parseFloat(prob.toFixed(3)),
            fair_odds: parseFloat(fair.toFixed(2)),
            best_odds: bestOddsObj ? bestOddsObj.odd : null,
            bookmaker: bestOddsObj ? bestOddsObj.bookmaker : null,
            edge: parseFloat(edge.toFixed(3)),
            rank_score: parseFloat(rank.toFixed(2)),
            tags
        });
    }
}

// ============================================================================
// 5. MAIN EXECUTION
// ============================================================================
function analyzeMatch(inputJson) {
    try {
        // 1. Parse
        const parser = new DataParser(inputJson);
        parser.parse();

        // 2. Features
        const engineer = new FeatureEngineer(parser);
        const features = engineer.calculate();

        // 3. Probabilities
        const poisson = new PoissonEngine(
            features.lambda_home,
            features.lambda_away,
            features.lambda_home_1h,
            features.lambda_away_1h
        );
        const probs = poisson.compute();

        // 4. Odds & Picks
        const oddsProc = new OddsProcessor(parser.matchDetails.odds_comparison);
        const ranker = new PickRanker(probs, oddsProc);
        const picks = ranker.generate();

        // 5. Construct Output
        return {
            meta: {
                match_id: parser.matchDetails.id,
                date: parser.matchDetails.date_unix,
                home_team: parser.matchDetails.home_name,
                away_team: parser.matchDetails.away_name,
            },
            inputs_normalized: parser.getCleanInput(),
            features_derived: features,
            probabilities: probs,
            recommended_picks: picks,
            debug: {
                home_stats_source: parser.homeStatsRows,
                away_stats_source: parser.awayStatsRows,
                lambdas: engineer.debug.lambdas
            }
        };

    } catch (error) {
        return {
            error: error.message,
            stack: error.stack
        };
    }
}

// Ensure it works in Node environment for testing
if (typeof module !== 'undefined') {
    module.exports = { analyzeMatch, DataParser, FeatureEngineer, PoissonEngine };
}
