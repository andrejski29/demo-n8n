// -------------------------
// n8n Node: Probability Engine & EV Scanner (Refined)
// -------------------------

// --- 1. Math Helpers ---

const FACTORIALS = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
function factorial(n) {
  if (n < 0) return 1;
  if (n < FACTORIALS.length) return FACTORIALS[n];
  let f = FACTORIALS[FACTORIALS.length - 1];
  for (let i = FACTORIALS.length; i <= n; i++) f *= i;
  return f;
}

function poisson(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// --- 2. Modeling Core (Goals) ---

function buildScoreMatrix(lambdaHome, lambdaAway, maxGoals = 9) {
  const matrix = [];
  let totalProb = 0;

  for (let h = 0; h <= maxGoals; h++) {
    const row = [];
    const pH = poisson(h, lambdaHome);
    for (let a = 0; a <= maxGoals; a++) {
      const pA = poisson(a, lambdaAway);
      const pScore = pH * pA;
      row.push(pScore);
      totalProb += pScore;
    }
    matrix.push(row);
  }

  // Normalize
  if (totalProb > 0 && totalProb < 1) {
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        matrix[h][a] /= totalProb;
      }
    }
  }

  return matrix;
}

// Derive Markets from Score Matrix
function deriveMarketsFromMatrix(matrix, prefix = "ft") {
  const markets = {
    [`${prefix}_1x2`]: { home: 0, draw: 0, away: 0 },
    [`${prefix}_btts`]: { yes: 0, no: 0 },
    [`${prefix}_goals`]: {},
    [`${prefix}_clean_sheet`]: { home: 0, away: 0 },
    [`${prefix}_win_to_nil`]: { home: 0, away: 0 },
    [`${prefix}_double_chance`]: { "1x": 0, "12": 0, "x2": 0 }
  };

  const maxGoals = matrix.length - 1;
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5];

  lines.forEach(L => markets[`${prefix}_goals`][L] = { over: 0, under: 0 });

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];

      // 1X2
      if (h > a) {
        markets[`${prefix}_1x2`].home += p;
        if (a === 0) markets[`${prefix}_win_to_nil`].home += p;
      } else if (a > h) {
        markets[`${prefix}_1x2`].away += p;
        if (h === 0) markets[`${prefix}_win_to_nil`].away += p;
      } else {
        markets[`${prefix}_1x2`].draw += p;
      }

      // BTTS
      if (h > 0 && a > 0) markets[`${prefix}_btts`].yes += p;
      else markets[`${prefix}_btts`].no += p;

      // Clean Sheet
      if (a === 0) markets[`${prefix}_clean_sheet`].home += p;
      if (h === 0) markets[`${prefix}_clean_sheet`].away += p;

      // Over/Under
      const total = h + a;
      lines.forEach(L => {
        if (total > L) markets[`${prefix}_goals`][L].over += p;
        else markets[`${prefix}_goals`][L].under += p;
      });
    }
  }

  // Double Chance
  markets[`${prefix}_double_chance`]["1x"] = markets[`${prefix}_1x2`].home + markets[`${prefix}_1x2`].draw;
  markets[`${prefix}_double_chance`]["12"] = markets[`${prefix}_1x2`].home + markets[`${prefix}_1x2`].away;
  markets[`${prefix}_double_chance`]["x2"] = markets[`${prefix}_1x2`].draw + markets[`${prefix}_1x2`].away;

  return markets;
}

// --- 3. Lambda Estimation (Refined) ---
function estimateLambdas(matchRecord) {
  let lambdaHome = matchRecord.signals?.xg?.home;
  let lambdaAway = matchRecord.signals?.xg?.away;
  let source = "xg_signal";

  // Fallback Logic
  if (!lambdaHome || lambdaHome < 0.1) {
    if (matchRecord.signals?.ppg?.home > 0) {
        // Very rough heuristic if xG missing: PPG/1.5 approx goals
        lambdaHome = Math.max(0.5, matchRecord.signals.ppg.home * 0.8);
        source = "ppg_heuristic";
    } else {
        lambdaHome = 1.35; // League Avg
        source = "league_avg_fallback";
    }
  }

  if (!lambdaAway || lambdaAway < 0.1) {
    if (matchRecord.signals?.ppg?.away > 0) {
        lambdaAway = Math.max(0.5, matchRecord.signals.ppg.away * 0.8);
        source = "ppg_heuristic";
    } else {
        lambdaAway = 1.10;
        source = "league_avg_fallback";
    }
  }

  // Clamp
  lambdaHome = Math.max(0.1, Math.min(4.5, lambdaHome));
  lambdaAway = Math.max(0.1, Math.min(4.5, lambdaAway));

  return { lambdaHome, lambdaAway, source };
}

// --- 4. EV & Edge Calculation (Correct Devig) ---

function calculateEV(pModel, odds) {
  if (!odds || odds <= 1.0) return null;
  return (pModel * odds) - 1;
}

function marginAdjustedProb(oddsVector) {
  const implied = {};
  let sum = 0;
  let valid = true;

  for (const [sel, odd] of Object.entries(oddsVector)) {
    if (!odd || odd <= 1) { valid = false; break; }
    const p = 1 / odd;
    implied[sel] = p;
    sum += p;
  }

  if (!valid || sum === 0) return null;

  const fair = {};
  for (const sel of Object.keys(implied)) {
    fair[sel] = implied[sel] / sum;
  }
  return fair;
}

// --- 5. Market Scanner ---

function scanMarkets(matchRecord, modelMarkets) {
  const results = [];
  const odds = matchRecord.odds?.best || {};
  const groups = matchRecord.odds?.groups || {};

  // Generic Processor
  // mapping: { modelKey: oddsKey }
  // groupName: key in odds.groups (e.g. 'ft_1x2') to find the vector
  const process = (marketDisplay, modelProbs, mapping, groupName, confidence) => {
    // 1. Build Vector from Group
    const groupKeys = groups[groupName] || [];
    const vector = {};

    // Check if we have odds for this group
    let hasFullVector = false;
    if (groupKeys.length > 0) {
        // We need to map back from oddsKey to modelKey to build vector { home: 2.2, draw: 3.3 ... }
        // Invert mapping for lookup: oddsKey -> modelKey
        const invMap = {};
        for(const [m, o] of Object.entries(mapping)) invMap[o] = m;

        let foundCount = 0;
        for (const k of groupKeys) {
            if (odds[k] && invMap[k]) {
                vector[invMap[k]] = odds[k].odds;
                foundCount++;
            }
        }
        // We ideally need the full vector to devig accurately.
        // For 2-way, need 2. For 3-way, need 3.
        const required = Object.keys(mapping).length;
        if (foundCount === required) hasFullVector = true;
    }

    // 2. Devig
    let marketProbs = null;
    if (hasFullVector) {
        marketProbs = marginAdjustedProb(vector);
    }

    // 3. Evaluate
    for (const [modelSel, oddKey] of Object.entries(mapping)) {
        const offered = odds[oddKey];
        if (!offered) continue;

        const pModel = modelProbs[modelSel];
        // If we couldn't devig (partial odds), use raw implied (conservative)
        const pMarket = marketProbs ? marketProbs[modelSel] : (1 / offered.odds);

        const ev = calculateEV(pModel, offered.odds);
        const edge = pModel - pMarket;

        if (ev !== null && ev > 0) {
            results.push({
                market: marketDisplay,
                selection: modelSel,
                odds: offered.odds,
                p_model: Number(pModel.toFixed(4)),
                p_market: Number(pMarket.toFixed(4)),
                edge: Number(edge.toFixed(4)),
                ev: Number(ev.toFixed(4)),
                confidence: confidence,
                book: offered.book,
                why: [
                    `Model ${Math.round(pModel*100)}% > Market ${Math.round(pMarket*100)}%`,
                    `EV +${(ev*100).toFixed(1)}%`
                ]
            });
        }
    }
  };

  // --- FT Markets ---
  process("1X2", modelMarkets.ft_1x2, {
    "home": "ft_1x2_home", "draw": "ft_1x2_draw", "away": "ft_1x2_away"
  }, "ft_1x2", "High");

  process("Double Chance", modelMarkets.ft_double_chance, {
    "1x": "dc_1x", "12": "dc_12", "x2": "dc_x2"
  }, "dc", "Medium");

  process("BTTS", modelMarkets.ft_btts, {
    "yes": "btts_yes", "no": "btts_no"
  }, "btts", "High");

  process("Clean Sheet Home", { "yes": modelMarkets.ft_clean_sheet.home, "no": 1 - modelMarkets.ft_clean_sheet.home }, {
    "yes": "cs_home_yes", "no": "cs_home_no"
  }, "cs_home", "High");

  process("Clean Sheet Away", { "yes": modelMarkets.ft_clean_sheet.away, "no": 1 - modelMarkets.ft_clean_sheet.away }, {
    "yes": "cs_away_yes", "no": "cs_away_no"
  }, "cs_away", "High");

  process("Win to Nil", { "home": modelMarkets.ft_win_to_nil.home, "away": modelMarkets.ft_win_to_nil.away }, {
    "home": "win_to_nil_home", "away": "win_to_nil_away"
  }, "n/a", "Medium"); // No strict group for WinToNil usually

  ["0.5", "1.5", "2.5", "3.5", "4.5"].forEach(L => {
      if (modelMarkets.ft_goals[L]) {
          process(`Over/Under ${L}`, modelMarkets.ft_goals[L], {
              "over": `ft_goals_over_${L}`, "under": `ft_goals_under_${L}`
          }, `ft_goals_${L}`, "High");
      }
  });

  // --- HT Markets ---
  process("HT 1X2", modelMarkets.ht_1x2, {
    "home": "ht_1x2_home", "draw": "ht_1x2_draw", "away": "ht_1x2_away"
  }, "ht_1x2", "Medium");

  process("HT BTTS", modelMarkets.ht_btts, {
    "yes": "ht_btts_yes", "no": "ht_btts_no"
  }, "ht_btts", "Low"); // Low confidence on splits

  ["0.5", "1.5"].forEach(L => {
      if (modelMarkets.ht_goals[L]) {
          process(`HT Over/Under ${L}`, modelMarkets.ht_goals[L], {
              "over": `ht_goals_over_${L}`, "under": `ht_goals_under_${L}`
          }, `ht_goals_${L}`, "Medium");
      }
  });

  // --- 2H Markets ---
  process("2H 1X2", modelMarkets.2h_1x2, {
    "home": "2h_1x2_home", "draw": "2h_1x2_draw", "away": "2h_1x2_away"
  }, "2h_1x2", "Medium");

  return results;
}

// --- 6. Ranking ---
function rankPicks(picks) {
  return picks.map(p => {
    let score = (p.ev * 100) * 0.7 + (p.edge * 100) * 0.3;
    if (p.confidence === "High") score += 5;
    if (p.confidence === "Medium") score += 2;

    let tier = "C";
    if (p.ev > 0.10 && p.confidence === "High") tier = "S";
    else if (p.ev > 0.05 && (p.confidence === "High" || p.confidence === "Medium")) tier = "A";
    else if (p.ev > 0.02) tier = "B";

    return { ...p, score: Number(score.toFixed(2)), tier };
  }).sort((a, b) => b.score - a.score);
}

// --- 7. Main Execution ---

function runEngine(inputs) {
  const match = inputs.match || inputs;

  // 1. Estimate Lambdas (FT)
  const { lambdaHome, lambdaAway, source } = estimateLambdas(match);

  // 2. Build Matrices (FT, HT, 2H)
  // Simplified Splits for V1: 45% HT / 55% 2H
  const split1H = 0.45;
  const split2H = 0.55;

  const matrixFT = buildScoreMatrix(lambdaHome, lambdaAway);
  const matrixHT = buildScoreMatrix(lambdaHome * split1H, lambdaAway * split1H, 5);
  const matrix2H = buildScoreMatrix(lambdaHome * split2H, lambdaAway * split2H, 5);

  // 3. Derive Markets
  const marketsFT = deriveMarketsFromMatrix(matrixFT, "ft");
  const marketsHT = deriveMarketsFromMatrix(matrixHT, "ht");
  const markets2H = deriveMarketsFromMatrix(matrix2H, "2h");

  const allModelMarkets = { ...marketsFT, ...marketsHT, ...markets2H };

  // 4. Scan
  const rawPicks = scanMarkets(match, allModelMarkets);

  // 5. Rank
  const rankedPicks = rankPicks(rawPicks);

  // 6. Format
  return {
    match_id: match.match_id,
    overview: {
      teams: match.teams,
      lambdas: { home: Number(lambdaHome.toFixed(2)), away: Number(lambdaAway.toFixed(2)), source },
      probs: {
        home_win: Number(marketsFT.ft_1x2.home.toFixed(4)),
        draw: Number(marketsFT.ft_1x2.draw.toFixed(4)),
        away_win: Number(marketsFT.ft_1x2.away.toFixed(4)),
        btts: Number(marketsFT.ft_btts.yes.toFixed(4)),
        over_2_5: Number(marketsFT.ft_goals["2.5"]?.over.toFixed(4))
      }
    },
    scanner: rankedPicks,
    shortlist: rankedPicks.slice(0, 5)
  };
}

// --- n8n Wrapper ---
if (typeof items !== 'undefined') {
  const results = [];
  for (const item of items) {
    const input = item.json;
    try {
      const output = runEngine(input);
      results.push({ json: output });
    } catch (e) {
      results.push({ json: { error: e.message, match_id: input.match_id } });
    }
  }
  return results;
} else {
  module.exports = { runEngine };
}
