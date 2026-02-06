// -------------------------
// n8n Node: Probability Engine & EV Scanner (V7 - Robust Data Handling)
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

// --- 2. Modeling Core ---

function buildScoreMatrix(lambdaHome, lambdaAway, hardMax = null) {
  // Dynamic Sizing: Mean + 4 Sigma (approx 99.99% coverage)
  const mean = lambdaHome + lambdaAway;
  const stdDev = Math.sqrt(mean);
  const calcMax = Math.ceil(mean + 5 * stdDev);

  // Use provided hardMax (e.g. for HT/2H low counts) or calculated dynamic max
  const maxGoals = hardMax !== null ? hardMax : Math.max(9, calcMax); // Min 9 for FT

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

  // Renormalize
  if (totalProb > 0 && totalProb < 1) {
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        matrix[h][a] /= totalProb;
      }
    }
  }

  return matrix;
}

function deriveMarketsFromMatrix(matrix, prefix = "ft") {
  const markets = {
    [`${prefix}_1x2`]: { home: 0, draw: 0, away: 0 },
    [`${prefix}_btts`]: { yes: 0, no: 0 },
    [`${prefix}_goals`]: {},
    [`${prefix}_clean_sheet`]: { home: 0, away: 0 },
    [`${prefix}_win_to_nil`]: { home: 0, away: 0 },
    [`${prefix}_double_chance`]: { "1x": 0, "12": 0, "x2": 0 }
  };

  // Standard lines
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5];
  lines.forEach(L => markets[`${prefix}_goals`][L] = { over: 0, under: 0 });

  const maxGoals = matrix.length - 1;

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

  markets[`${prefix}_double_chance`]["1x"] = markets[`${prefix}_1x2`].home + markets[`${prefix}_1x2`].draw;
  markets[`${prefix}_double_chance`]["12"] = markets[`${prefix}_1x2`].home + markets[`${prefix}_1x2`].away;
  markets[`${prefix}_double_chance`]["x2"] = markets[`${prefix}_1x2`].draw + markets[`${prefix}_1x2`].away;

  return markets;
}

function deriveCornerMarkets(matrix) {
    const markets = {
        corners_1x2: { home: 0, draw: 0, away: 0 },
        corners_ou: {}
    };

    const lines = [7.5, 8.5, 9.5, 10.5, 11.5];
    lines.forEach(L => markets.corners_ou[L] = { over: 0, under: 0 });

    const maxCounts = matrix.length - 1;

    for (let h = 0; h <= maxCounts; h++) {
        for (let a = 0; a <= maxCounts; a++) {
            const p = matrix[h][a];

            // 1X2
            if (h > a) markets.corners_1x2.home += p;
            else if (a > h) markets.corners_1x2.away += p;
            else markets.corners_1x2.draw += p;

            // O/U
            const total = h + a;
            lines.forEach(L => {
                if (total > L) markets.corners_ou[L].over += p;
                else markets.corners_ou[L].under += p;
            });
        }
    }
    return markets;
}

// --- 3. Lambda Estimation (Improved V7) ---

function getStat(obj, path) {
    return path.split('.').reduce((o, i) => o ? o[i] : undefined, obj);
}

function estimateLambdas(matchRecord) {
  let lambdaHome = 0;
  let lambdaAway = 0;
  let source = "league_avg_fallback";

  // 1. Try xG Signals (Best)
  const sigXG = matchRecord.signals?.xg;
  if (sigXG && sigXG.home > 0.1 && sigXG.away > 0.1) {
      lambdaHome = sigXG.home;
      lambdaAway = sigXG.away;
      source = "xg_signal";
  }
  // 2. Try Context Pre-Match xG
  else if (matchRecord.context?.team_a_xg_prematch > 0.1) {
      lambdaHome = matchRecord.context.team_a_xg_prematch;
      lambdaAway = matchRecord.context.team_b_xg_prematch;
      source = "context_xg";
  }
  // 3. Try PPG Heuristic (Signals)
  else if (matchRecord.signals?.ppg?.home > 0) {
      lambdaHome = Math.max(0.5, matchRecord.signals.ppg.home * 0.8);
      lambdaAway = Math.max(0.5, matchRecord.signals.ppg.away * 0.8); // Simple proxy
      source = "ppg_signal_heuristic";
  }
  // 4. Try Context PPG
  else if (matchRecord.context?.home_ppg > 0) {
      lambdaHome = Math.max(0.5, matchRecord.context.home_ppg * 0.8);
      lambdaAway = Math.max(0.5, matchRecord.context.away_ppg * 0.8);
      source = "context_ppg_heuristic";
  }
  // 5. Fallback
  else {
      lambdaHome = 1.35;
      lambdaAway = 1.10;
  }

  // Corner Estimation
  const hFor = getStat(matchRecord, "team_stats.home.season_stats.features.corners_for_pm_overall") || 4.5;
  const hAg = getStat(matchRecord, "team_stats.home.season_stats.features.corners_against_pm_overall") || 4.5;
  const aFor = getStat(matchRecord, "team_stats.away.season_stats.features.corners_for_pm_overall") || 4.5;
  const aAg = getStat(matchRecord, "team_stats.away.season_stats.features.corners_against_pm_overall") || 4.5;

  let cornerLambdaHome = (hFor + aAg) / 2;
  let cornerLambdaAway = (aFor + hAg) / 2;

  // Clamp
  lambdaHome = Math.max(0.1, Math.min(4.5, lambdaHome));
  lambdaAway = Math.max(0.1, Math.min(4.5, lambdaAway));
  cornerLambdaHome = Math.max(1.0, Math.min(12.0, cornerLambdaHome));
  cornerLambdaAway = Math.max(1.0, Math.min(12.0, cornerLambdaAway));

  return { lambdaHome, lambdaAway, cornerLambdaHome, cornerLambdaAway, source };
}

// --- 4. EV & Edge ---

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

  // Heuristic: If sum is >> 1 (e.g. > 1.25), it's likely overlapping outcomes (Double Chance)
  // or extremely high margin. In these cases, proportional devig is invalid.
  // Double Chance (1X+X2+12) sums to ~2.0.
  if (sum > 1.5) return null;

  const fair = {};
  for (const sel of Object.keys(implied)) {
    fair[sel] = implied[sel] / sum;
  }
  return fair;
}

// --- 5. Market Scanner (Robust V7) ---

function resolveOdds(odds, ...keys) {
    if (!odds) return undefined;
    for (const k of keys) {
        if (odds[k]) return odds[k];
    }
    return undefined;
}

function scanMarkets(matchRecord, modelMarkets, cornerMarkets) {
  const results = [];
  const odds = matchRecord.odds?.best || {};

  // Note: V7 removes dependency on 'groups' for devig capability.
  // It devigs if the odds vector is complete.

  const process = (marketDisplay, modelProbs, mapping, confidence) => {
    // 1. Build Vector
    const vector = {};
    let missingLegs = 0;

    for (const [modelSel, oddKey] of Object.entries(mapping)) {
        // Try strict, then legacy
        const legacyKey = oddKey.replace("_ou_", "_");
        const found = resolveOdds(odds, oddKey, legacyKey);

        if (found) {
            vector[modelSel] = found.odds;
        } else {
            missingLegs++;
        }
    }

    const hasFullVector = (missingLegs === 0 && Object.keys(mapping).length > 0);

    // 2. Devig (Fair Probs)
    let marketProbs = null;
    if (hasFullVector) {
        marketProbs = marginAdjustedProb(vector);
    }

    // 3. Evaluate each selection
    for (const [modelSel, oddKey] of Object.entries(mapping)) {
        const legacyKey = oddKey.replace("_ou_", "_");
        const offered = resolveOdds(odds, oddKey, legacyKey);

        if (!offered) continue;

        const pModel = modelProbs[modelSel];
        // If devig possible, use fair prob. Else use raw implied prob (conservative edge calculation? No, Raw implied is higher, so Edge = Model - Raw will be lower/negative. This is safe.)
        // Actually: Edge = Model - Implied. If Implied is 55% (due to margin) and Model is 50%, Edge is -5%.
        // If Fair is 52% and Model is 50%, Edge is -2%.
        // Using Raw Implied is stricter/safer if we can't devig.
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

  // --- GOAL MARKETS ---
  process("1X2", modelMarkets.ft_1x2, {
    "home": "ft_1x2_home", "draw": "ft_1x2_draw", "away": "ft_1x2_away"
  }, "High");

  process("Double Chance", modelMarkets.ft_double_chance, {
    "1x": "dc_1x", "12": "dc_12", "x2": "dc_x2"
  }, "Medium");

  process("BTTS", modelMarkets.ft_btts, {
    "yes": "btts_yes", "no": "btts_no"
  }, "High");

  process("Clean Sheet Home", { "yes": modelMarkets.ft_clean_sheet.home, "no": 1 - modelMarkets.ft_clean_sheet.home }, {
    "yes": "cs_home_yes", "no": "cs_home_no"
  }, "High");

  process("Clean Sheet Away", { "yes": modelMarkets.ft_clean_sheet.away, "no": 1 - modelMarkets.ft_clean_sheet.away }, {
    "yes": "cs_away_yes", "no": "cs_away_no"
  }, "High");

  process("Win to Nil", { "home": modelMarkets.ft_win_to_nil.home, "away": modelMarkets.ft_win_to_nil.away }, {
    "home": "win_to_nil_home", "away": "win_to_nil_away"
  }, "Medium");

  ["0.5", "1.5", "2.5", "3.5", "4.5"].forEach(L => {
      if (modelMarkets.ft_goals[L]) {
          process(`Over/Under ${L}`, modelMarkets.ft_goals[L], {
              "over": `ft_goals_over_${L}`, "under": `ft_goals_under_${L}`
          }, "High");
      }
  });

  // --- HALF TIME ---
  process("HT 1X2", modelMarkets.ht_1x2, {
    "home": "ht_1x2_home", "draw": "ht_1x2_draw", "away": "ht_1x2_away"
  }, "Medium");

  process("HT BTTS", modelMarkets.ht_btts, {
    "yes": "ht_btts_yes", "no": "ht_btts_no"
  }, "Low");

  ["0.5", "1.5", "2.5", "3.5"].forEach(L => {
      if (modelMarkets.ht_goals[L]) {
          process(`HT Over/Under ${L}`, modelMarkets.ht_goals[L], {
              "over": `ht_goals_over_${L}`, "under": `ht_goals_under_${L}`
          }, "Medium");
      }
  });

  // --- SECOND HALF ---
  process("2H 1X2", modelMarkets["2h_1x2"], {
    "home": "2h_1x2_home", "draw": "2h_1x2_draw", "away": "2h_1x2_away"
  }, "Medium");

  process("2H BTTS", modelMarkets["2h_btts"], {
    "yes": "2h_btts_yes", "no": "2h_btts_no"
  }, "Low");

  ["0.5", "1.5", "2.5", "3.5"].forEach(L => {
      if (modelMarkets["2h_goals"][L]) {
          process(`2H Over/Under ${L}`, modelMarkets["2h_goals"][L], {
              "over": `2h_goals_over_${L}`, "under": `2h_goals_under_${L}`
          }, "Medium");
      }
  });

  // --- CORNERS ---
  process("Corner 1X2", cornerMarkets.corners_1x2, {
      "home": "corners_1x2_home", "draw": "corners_1x2_draw", "away": "corners_1x2_away"
  }, "Medium");

  ["7.5", "8.5", "9.5", "10.5", "11.5"].forEach(L => {
      if (cornerMarkets.corners_ou[L]) {
          process(`Corners O/U ${L}`, cornerMarkets.corners_ou[L], {
              "over": `corners_ou_over_${L}`, "under": `corners_ou_under_${L}`
          }, "Medium");
      }
  });

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

// --- 7. Main ---

function runEngine(inputs) {
  const match = inputs.match || inputs;

  // Sanity Check: Team IDs
  if (match.teams?.home?.id && match.team_stats?.home?.team_meta?.id) {
      if (match.teams.home.id !== match.team_stats.home.team_meta.id) {
          // Warning: Data mismatch
          // console.warn("Team ID Mismatch detected in normalization");
      }
  }

  const { lambdaHome, lambdaAway, cornerLambdaHome, cornerLambdaAway, source } = estimateLambdas(match);

  // Time splits
  const split1H = 0.45;
  const split2H = 0.55;

  // Matrices
  const matrixFT = buildScoreMatrix(lambdaHome, lambdaAway);
  const matrixHT = buildScoreMatrix(lambdaHome * split1H, lambdaAway * split1H, 5); // Low scores
  const matrix2H = buildScoreMatrix(lambdaHome * split2H, lambdaAway * split2H, 5);
  const matrixCorners = buildScoreMatrix(cornerLambdaHome, cornerLambdaAway); // Dynamic max

  // Derivations
  const marketsFT = deriveMarketsFromMatrix(matrixFT, "ft");
  const marketsHT = deriveMarketsFromMatrix(matrixHT, "ht");
  const markets2H = deriveMarketsFromMatrix(matrix2H, "2h");
  const marketsCorners = deriveCornerMarkets(matrixCorners);

  const allModelMarkets = { ...marketsFT, ...marketsHT, ...markets2H };

  // Scan
  const rawPicks = scanMarkets(match, allModelMarkets, marketsCorners);
  const rankedPicks = rankPicks(rawPicks);

  return {
    match_id: match.match_id,
    overview: {
      teams: match.teams,
      lambdas: {
          goals: { home: Number(lambdaHome.toFixed(2)), away: Number(lambdaAway.toFixed(2)) },
          corners: { home: Number(cornerLambdaHome.toFixed(2)), away: Number(cornerLambdaAway.toFixed(2)) },
          source
      },
      probs: {
        home_win: Number(marketsFT.ft_1x2.home.toFixed(4)),
        draw: Number(marketsFT.ft_1x2.draw.toFixed(4)),
        away_win: Number(marketsFT.ft_1x2.away.toFixed(4)),
        btts: Number(marketsFT.ft_btts.yes.toFixed(4)),
        over_2_5: Number(marketsFT.ft_goals["2.5"]?.over.toFixed(4)),
        corners_over_9_5: Number(marketsCorners.corners_ou["9.5"]?.over.toFixed(4))
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
