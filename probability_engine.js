// -------------------------
// n8n Node: Probability Engine & EV Scanner (V13.4 - Smart Mismatch & Portfolio)
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
  const maxH = Math.ceil(lambdaHome + 5 * Math.sqrt(lambdaHome));
  const maxA = Math.ceil(lambdaAway + 5 * Math.sqrt(lambdaAway));
  const maxGoals = hardMax !== null ? hardMax : Math.max(9, maxH, maxA);

  const matrix = [];
  let totalProb = 0;

  // Precompute PMFs
  const distHome = [];
  const distAway = [];
  for (let k = 0; k <= maxGoals; k++) {
      distHome[k] = poisson(k, lambdaHome);
      distAway[k] = poisson(k, lambdaAway);
  }

  for (let h = 0; h <= maxGoals; h++) {
    const row = [];
    const pH = distHome[h];
    for (let a = 0; a <= maxGoals; a++) {
      const pScore = pH * distAway[a];
      row.push(pScore);
      totalProb += pScore;
    }
    matrix.push(row);
  }

  // Renormalize
  if (Math.abs(totalProb - 1.0) > 1e-9) {
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

  const lines = [0.5, 1.5, 2.5, 3.5, 4.5];
  lines.forEach(L => markets[`${prefix}_goals`][L] = { over: 0, under: 0 });

  const maxGoals = matrix.length - 1;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];

      if (h > a) {
        markets[`${prefix}_1x2`].home += p;
        if (a === 0) markets[`${prefix}_win_to_nil`].home += p;
      } else if (a > h) {
        markets[`${prefix}_1x2`].away += p;
        if (h === 0) markets[`${prefix}_win_to_nil`].away += p;
      } else {
        markets[`${prefix}_1x2`].draw += p;
      }

      if (h > 0 && a > 0) markets[`${prefix}_btts`].yes += p;
      else markets[`${prefix}_btts`].no += p;

      if (a === 0) markets[`${prefix}_clean_sheet`].home += p;
      if (h === 0) markets[`${prefix}_clean_sheet`].away += p;

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

            if (h > a) markets.corners_1x2.home += p;
            else if (a > h) markets.corners_1x2.away += p;
            else markets.corners_1x2.draw += p;

            const total = h + a;
            lines.forEach(L => {
                if (total > L) markets.corners_ou[L].over += p;
                else markets.corners_ou[L].under += p;
            });
        }
    }
    return markets;
}

// --- 3. Lambda Estimation ---

function getStat(obj, path) {
    return path.split('.').reduce((o, i) => o ? o[i] : undefined, obj);
}

function estimateLambdas(matchRecord) {
  let lambdaHome = 0;
  let lambdaAway = 0;
  let source = "league_avg_fallback";
  const warnings = [];

  let isContextSwapped = false;
  if (matchRecord.h2h && matchRecord.teams?.home?.id) {
       const teamAId = matchRecord.h2h.team_a_id;
       const homeId = matchRecord.teams.home.id;
       if (teamAId && teamAId !== homeId) {
           isContextSwapped = true;
           warnings.push("context_team_mapping_swapped");
       }
  }

  let ctxXG_A = matchRecord.context?.team_a_xg_prematch;
  let ctxXG_B = matchRecord.context?.team_b_xg_prematch;
  let ctxPPG_H = matchRecord.context?.home_ppg;
  let ctxPPG_A = matchRecord.context?.away_ppg;

  if (isContextSwapped) {
      [ctxXG_A, ctxXG_B] = [ctxXG_B, ctxXG_A];
  }

  const sigXG = matchRecord.signals?.xg;

  if (sigXG && sigXG.home > 0.1 && sigXG.away > 0.1) {
      lambdaHome = sigXG.home;
      lambdaAway = sigXG.away;
      source = "signal_xg";
  } else if (ctxXG_A > 0.1) {
      lambdaHome = ctxXG_A;
      lambdaAway = ctxXG_B;
      source = "context_xg";
  } else if (matchRecord.signals?.ppg?.home > 0) {
      lambdaHome = Math.max(0.5, matchRecord.signals.ppg.home * 0.8);
      lambdaAway = Math.max(0.5, matchRecord.signals.ppg.away * 0.8);
      source = "signal_ppg_heuristic";
  } else if (ctxPPG_H > 0) {
      lambdaHome = Math.max(0.5, ctxPPG_H * 0.8);
      lambdaAway = Math.max(0.5, ctxPPG_A * 0.8);
      source = "context_ppg_heuristic";
  } else {
      lambdaHome = 1.35;
      lambdaAway = 1.10;
      source = "hard_fallback_1.35_1.10";
  }

  const hFor = getStat(matchRecord, "team_stats.home.season_stats.features.corners_for_pm_overall") || 4.5;
  const hAg = getStat(matchRecord, "team_stats.home.season_stats.features.corners_against_pm_overall") || 4.5;
  const aFor = getStat(matchRecord, "team_stats.away.season_stats.features.corners_for_pm_overall") || 4.5;
  const aAg = getStat(matchRecord, "team_stats.away.season_stats.features.corners_against_pm_overall") || 4.5;

  let cornerLambdaHome = (hFor + aAg) / 2;
  let cornerLambdaAway = (aFor + hAg) / 2;

  lambdaHome = Math.max(0.1, Math.min(4.5, lambdaHome));
  lambdaAway = Math.max(0.1, Math.min(4.5, lambdaAway));
  cornerLambdaHome = Math.max(1.0, Math.min(12.0, cornerLambdaHome));
  cornerLambdaAway = Math.max(1.0, Math.min(12.0, cornerLambdaAway));

  return { lambdaHome, lambdaAway, cornerLambdaHome, cornerLambdaAway, source, warnings };
}

// --- 4. EV, Kelly, Confidence ---

function calculateEV(pModel, odds) {
  if (!odds || odds <= 1.0) return null;
  return (pModel * odds) - 1;
}

function calculateKelly(p, odds, fraction = 0.25) {
    if (!odds || odds <= 1) return 0;
    const b = odds - 1;
    const q = 1 - p;
    const f = (b * p - q) / b;
    return Math.max(0, f * fraction);
}

function calculateConfidenceScore(pick, meta) {
    let score = 50;

    if (meta.source === 'signal_xg') score += 20;
    else if (meta.source === 'context_xg') score += 15;
    else if (meta.source.includes('ppg')) score += 5;
    else if (meta.source.includes('fallback')) score -= 15;

    if (pick.devig_applied) score += 5;

    if (pick.timeframe === 'ft') score += 0;
    else score -= 5;

    if (pick.edge > 0.05) score += 5;
    if (pick.ev > 0.10) score += 5;

    if (pick.p_model < 0.35) score -= 10;
    if (pick.odds > 4.5) score -= 5;

    if (meta.warnings && meta.warnings.length > 0) score -= 15;

    return Math.max(0, Math.min(100, score));
}

function getConfidenceTier(score) {
    if (score >= 80) return "Elite";
    if (score >= 65) return "Strong";
    if (score >= 50) return "Speculative";
    return "Weak";
}

function isMarketExclusive(marketName) {
    const exclusive = [
        "1X2", "Over/Under", "BTTS", "Corner 1X2", "Clean Sheet", "Win to Nil",
        "Corners O/U", "HT 1X2", "HT Over/Under", "HT BTTS", "2H 1X2", "2H Over/Under", "2H BTTS"
    ];
    return exclusive.some(ex => marketName.includes(ex));
}

function marginAdjustedProb(oddsVector, marketName) {
  const implied = {};
  let sum = 0;
  let valid = true;

  for (const [sel, odd] of Object.entries(oddsVector)) {
    if (!odd || odd <= 1) { valid = false; break; }
    const p = 1 / odd;
    implied[sel] = p;
    sum += p;
  }

  if (!valid || sum === 0) return { prob: null, margin: 0, reason: "invalid_odds" };

  // V12: Reason tracking
  if (!isMarketExclusive(marketName)) return { prob: null, margin: sum, reason: "not_exclusive" };
  if (sum > 1.20) return { prob: null, margin: sum, reason: "margin_too_high" };

  const fair = {};
  for (const sel of Object.keys(implied)) {
    fair[sel] = implied[sel] / sum;
  }
  return { prob: fair, margin: sum, reason: null };
}

// --- 5. Market Scanner ---

function resolveOdds(odds, ...keys) {
    if (!odds) return undefined;
    for (const k of keys) {
        if (odds[k]) return odds[k];
    }
    return undefined;
}

function scanMarkets(matchRecord, modelMarkets, cornerMarkets, config) {
  const results = [];
  const odds = matchRecord.odds?.best || {};
  const minEV = config.min_ev || 0.0;
  const minEdge = config.min_edge || 0.0;
  const minProb = config.min_p_model || 0.0;
  const minOdds = config.min_odds || 1.01;
  const maxOdds = config.max_odds || 100.0;
  const exclude = config.exclude_markets || [];

  // V13.4: Pre-calculate 1X2 Devig for DC Mismatch Safety
  let ft1x2Fair = null;
  const ft1x2Keys = { "home": "ft_1x2_home", "draw": "ft_1x2_draw", "away": "ft_1x2_away" };
  const ft1x2Vector = {};
  let has1x2 = true;
  for (const [sel, k] of Object.entries(ft1x2Keys)) {
      const o = resolveOdds(odds, k);
      if (o) ft1x2Vector[sel] = o.odds;
      else has1x2 = false;
  }
  if (has1x2) {
      const devig = marginAdjustedProb(ft1x2Vector, "1X2");
      if (devig.prob) ft1x2Fair = devig.prob;
  }

  const process = (marketDisplay, modelProbs, mapping, meta) => {
    if (exclude.some(ex => marketDisplay.includes(ex))) return;

    const vector = {};
    let missingLegs = 0;

    for (const [modelSel, oddKey] of Object.entries(mapping)) {
        const legacyKey = oddKey.replace("_ou_", "_");
        const found = resolveOdds(odds, oddKey, legacyKey);
        if (found) vector[modelSel] = found.odds;
        else missingLegs++;
    }

    const hasFullVector = (missingLegs === 0 && Object.keys(mapping).length > 0);
    let marketProbs = null;
    let devigApplied = false;
    let devigSkipReason = hasFullVector ? null : "incomplete_vector";
    let marginSum = null;

    if (hasFullVector) {
        const devigResult = marginAdjustedProb(vector, marketDisplay);
        if (devigResult.prob) {
            marketProbs = devigResult.prob;
            devigApplied = true;
            marginSum = devigResult.margin;
        } else {
            devigSkipReason = devigResult.reason;
            marginSum = devigResult.margin;
        }
    }

    for (const [modelSel, oddKey] of Object.entries(mapping)) {
        const legacyKey = oddKey.replace("_ou_", "_");
        const offered = resolveOdds(odds, oddKey, legacyKey);

        if (!offered) continue;

        if (offered.odds < minOdds || offered.odds > maxOdds) continue;

        const pModel = modelProbs[modelSel];
        if (pModel < minProb) continue;

        // V13.4: Determine P_Market for Safety Check
        let pMarketSafety = marketProbs ? marketProbs[modelSel] : (1 / offered.odds);

        // Special Case: DC Mismatch derived from 1X2 Fair
        if (meta.family === 'result_dc' && ft1x2Fair) {
            if (modelSel === '1x') pMarketSafety = ft1x2Fair.home + ft1x2Fair.draw;
            else if (modelSel === '12') pMarketSafety = ft1x2Fair.home + ft1x2Fair.away;
            else if (modelSel === 'x2') pMarketSafety = ft1x2Fair.draw + ft1x2Fair.away;
        }

        const pMarketImplied = (1 / offered.odds); // For EV calc, use actual price
        // Use Devig if available for EV? Standard is yes.
        // User instruction: "keep current p_market for EV if you want".
        // Current code uses `marketProbs ? marketProbs : implied`.
        const pMarketForEV = marketProbs ? marketProbs[modelSel] : pMarketImplied;

        const ev = calculateEV(pModel, offered.odds);
        const edge = pModel - pMarketForEV;
        const kelly = calculateKelly(pModel, offered.odds, 0.25);

        // Safety Flags
        const qualityFlags = [];

        // 1. Absolute Mismatch
        if (Math.abs(pModel - pMarketSafety) > 0.20) {
            qualityFlags.push("model_mismatch_major");
        }

        // 2. Ratio Mismatch
        if (pMarketSafety > 0.03 && (pModel / pMarketSafety > 2.5)) {
            qualityFlags.push("model_mismatch_ratio");
        }

        if (ev !== null && ev > minEV && edge > minEdge) {
            results.push({
                match_id: matchRecord.match_id,
                market: marketDisplay,
                selection: modelSel,
                category: meta.category,
                market_family: meta.family,
                timeframe: meta.timeframe,
                line: meta.line,
                odds: offered.odds,
                p_model: Number(pModel.toFixed(4)),
                p_market: Number(pMarketForEV.toFixed(4)),
                p_market_safety: Number(pMarketSafety.toFixed(4)), // Debug
                edge: Number(edge.toFixed(4)),
                ev: Number(ev.toFixed(4)),
                kelly: Number(kelly.toFixed(4)),
                book: offered.book,
                devig_applied: devigApplied,
                p_market_source: devigApplied ? "fair_devig" : "implied_raw",
                devig_skip_reason: devigSkipReason,
                vector_complete: hasFullVector,
                missing_legs: missingLegs,
                margin_sum: marginSum ? Number(marginSum.toFixed(4)) : null,
                lambda_source: meta.source,
                is_mismatch: (qualityFlags.length > 0),
                quality_flags: qualityFlags, // Pass to Ranker
                alpha_score: 0
            });
        }
    }
  };

  // --- GOAL MARKETS ---
  process("1X2", modelMarkets.ft_1x2, {
    "home": "ft_1x2_home", "draw": "ft_1x2_draw", "away": "ft_1x2_away"
  }, { category: "result", family: "result_1x2", timeframe: "ft" });

  process("Double Chance", modelMarkets.ft_double_chance, {
    "1x": "dc_1x", "12": "dc_12", "x2": "dc_x2"
  }, { category: "result", family: "result_dc", timeframe: "ft" });

  process("BTTS", modelMarkets.ft_btts, {
    "yes": "btts_yes", "no": "btts_no"
  }, { category: "goals", family: "goals_btts", timeframe: "ft" });

  process("Clean Sheet Home", { "yes": modelMarkets.ft_clean_sheet.home, "no": 1 - modelMarkets.ft_clean_sheet.home }, {
    "yes": "cs_home_yes", "no": "cs_home_no"
  }, { category: "defense", family: "defense_cs", timeframe: "ft" });

  process("Clean Sheet Away", { "yes": modelMarkets.ft_clean_sheet.away, "no": 1 - modelMarkets.ft_clean_sheet.away }, {
    "yes": "cs_away_yes", "no": "cs_away_no"
  }, { category: "defense", family: "defense_cs", timeframe: "ft" });

  process("Win to Nil", { "home": modelMarkets.ft_win_to_nil.home, "away": modelMarkets.ft_win_to_nil.away }, {
    "home": "win_to_nil_home", "away": "win_to_nil_away"
  }, { category: "combo", family: "combo_wtn", timeframe: "ft" });

  ["0.5", "1.5", "2.5", "3.5", "4.5"].forEach(L => {
      if (modelMarkets.ft_goals[L]) {
          process(`Over/Under ${L}`, modelMarkets.ft_goals[L], {
              "over": `ft_goals_over_${L}`, "under": `ft_goals_under_${L}`
          }, { category: "goals", family: "goals_ou", timeframe: "ft", line: Number(L) });
      }
  });

  // --- HALF TIME ---
  process("HT 1X2", modelMarkets.ht_1x2, {
    "home": "ht_1x2_home", "draw": "ht_1x2_draw", "away": "ht_1x2_away"
  }, { category: "half_result", family: "result_1x2", timeframe: "ht" });

  process("HT BTTS", modelMarkets.ht_btts, {
    "yes": "ht_btts_yes", "no": "ht_btts_no"
  }, { category: "half_goals", family: "goals_btts", timeframe: "ht" });

  ["0.5", "1.5", "2.5", "3.5"].forEach(L => {
      if (modelMarkets.ht_goals[L]) {
          process(`HT Over/Under ${L}`, modelMarkets.ht_goals[L], {
              "over": `ht_goals_over_${L}`, "under": `ht_goals_under_${L}`
          }, { category: "half_goals", family: "goals_ou", timeframe: "ht", line: Number(L) });
      }
  });

  // --- SECOND HALF ---
  process("2H 1X2", modelMarkets["2h_1x2"], {
    "home": "2h_1x2_home", "draw": "2h_1x2_draw", "away": "2h_1x2_away"
  }, { category: "half_result", family: "result_1x2", timeframe: "2h" });

  process("2H BTTS", modelMarkets["2h_btts"], {
    "yes": "2h_btts_yes", "no": "2h_btts_no"
  }, { category: "half_goals", family: "goals_btts", timeframe: "2h" });

  ["0.5", "1.5", "2.5", "3.5"].forEach(L => {
      if (modelMarkets["2h_goals"][L]) {
          process(`2H Over/Under ${L}`, modelMarkets["2h_goals"][L], {
              "over": `2h_goals_over_${L}`, "under": `2h_goals_under_${L}`
          }, { category: "half_goals", family: "goals_ou", timeframe: "2h", line: Number(L) });
      }
  });

  // --- CORNERS ---
  process("Corner 1X2", cornerMarkets.corners_1x2, {
      "home": "corners_1x2_home", "draw": "corners_1x2_draw", "away": "corners_1x2_away"
  }, { category: "corners", family: "corners_1x2", timeframe: "ft" });

  ["7.5", "8.5", "9.5", "10.5", "11.5"].forEach(L => {
      if (cornerMarkets.corners_ou[L]) {
          process(`Corners O/U ${L}`, cornerMarkets.corners_ou[L], {
              "over": `corners_ou_over_${L}`, "under": `corners_ou_under_${L}`
          }, { category: "corners", family: "corners_ou", timeframe: "ft", line: Number(L) });
      }
  });

  return results;
}

// --- 6. Ranking & Portfolio (V13.4 Pro Selection) ---

function calculateFinalScore(pick, meta, config) {
    const wEV = config.rank_w_ev || 0.6;
    const wProb = config.rank_w_prob || 1.0;
    const wConf = config.rank_w_conf || 0.4;
    const evCap = config.rank_ev_cap || 0.75;

    const evEff = Math.min(Math.max(pick.ev, 0), evCap);

    const alphaScore = (evEff * 100 * wEV) + (pick.p_model * 100 * wProb) + (pick.confidence_score * wConf);
    const alphaRaw = (Math.max(pick.ev, 0) * 100 * wEV) + (pick.p_model * 100 * wProb) + (pick.confidence_score * wConf);

    let finalScore = alphaScore;

    // Merge Scanner flags + Scoring flags
    const qualityFlags = [...(pick.quality_flags || [])];

    // Penalties
    if (!pick.vector_complete || pick.missing_legs > 0) {
        finalScore -= 40;
        qualityFlags.push("incomplete_vector");
    }

    if (!pick.devig_applied) {
        if (pick.devig_skip_reason === 'not_exclusive') {
            finalScore -= 5;
            qualityFlags.push("non_exclusive_market");
        } else {
            finalScore -= 15;
            qualityFlags.push("no_devig");
        }
    }

    if (pick.devig_skip_reason !== 'not_exclusive' && pick.margin_sum && pick.margin_sum > 1.10) {
        const pen = (pick.margin_sum - 1.10) * 100;
        finalScore -= Math.min(pen, 30);
        qualityFlags.push("high_margin");
    }

    if (pick.odds > 6.0) {
        const pen = (pick.odds - 6.0) * 3;
        finalScore -= Math.min(pen, 30);
        qualityFlags.push("odds_tail");
    }

    // Mismatch Penalty (Flagged in Scan)
    if (pick.is_mismatch) {
        finalScore -= 25;
        // Flag already in quality_flags from scan
    }

    return {
        score: Number(finalScore.toFixed(2)),
        alpha_score: Number(alphaScore.toFixed(2)),
        alpha_raw: Number(alphaRaw.toFixed(2)),
        flags: [...new Set(qualityFlags)] // Dedupe
    };
}

function selectPortfolio(candidates, config) {
    const portfolio = [];
    const seenFamilies = new Set();
    const timeframeCounts = { ft: 0, ht: 0, "2h": 0 };

    const passes = [
        { maxFam: 1, maxTF: 2, strictCluster: true },
        { maxFam: 2, maxTF: 2, strictCluster: false },
        { maxFam: 3, maxTF: 3, strictCluster: false }
    ];

    let currentPass = 0;

    while (portfolio.length < 5 && currentPass < passes.length) {
        const rules = passes[currentPass];

        for (const pick of candidates) {
            if (portfolio.includes(pick)) continue;
            if (portfolio.length >= 5) break;

            const fam = pick.market_family;
            const tf = pick.timeframe;
            let excludedReason = null;

            const famCount = portfolio.filter(p => p.market_family === fam).length;
            if (famCount >= rules.maxFam) excludedReason = "max_family_limit";

            const tfCount = timeframeCounts[tf] || 0;
            if (!excludedReason && tfCount >= rules.maxTF) excludedReason = "max_timeframe_limit";

            if (!excludedReason) {
                if (fam === 'goals_ou' || fam === 'goals_btts') {
                    const collision = portfolio.some(p => (p.market_family === 'goals_ou' || p.market_family === 'goals_btts') && p.timeframe === tf);
                    if (collision) excludedReason = "cluster_goals_collision";
                }

                if (fam === 'combo_wtn') {
                    const resultCollision = portfolio.some(p => (p.market_family === 'result_1x2' || p.market_family === 'result_dc') && p.timeframe === tf);
                    if (resultCollision) excludedReason = "cluster_result_collision";
                }
            }

            if (!excludedReason) {
                portfolio.push(pick);
                seenFamilies.add(fam);
                if (timeframeCounts[tf] !== undefined) timeframeCounts[tf]++;
                pick.selection_pass = currentPass + 1;
            } else {
                if (!pick.excluded_reason && currentPass === 0) pick.excluded_reason = excludedReason;
            }
        }
        currentPass++;
    }

    return portfolio;
}

function rankAndFilterPicks(picks, meta, config) {
  const scored = picks.map(p => {
      const confScore = calculateConfidenceScore(p, meta);
      const tier = getConfidenceTier(confScore);
      const pWithConf = { ...p, confidence_score: confScore, confidence_tier: tier };

      const { score, alpha_score, alpha_raw, flags } = calculateFinalScore(pWithConf, meta, config);

      const lineStr = p.line !== undefined ? `_${p.line}` : '';
      const stableId = `${p.match_id}|${p.market_family}|${p.timeframe}|${p.market}|${p.selection}${lineStr}`;

      return {
          ...pWithConf,
          id: stableId,
          final_score: score,
          alpha_score: alpha_score,
          alpha_raw: alpha_raw,
          quality_flags: flags,
          sort_score: score,
          ev_raw: p.ev
      };
  });

  scored.sort((a, b) => b.final_score - a.final_score);

  // V13.4: Hard Filter for Mismatch (Optional)
  const excludeMismatch = config.exclude_mismatch || false; // Default off, or true? User said "optionally".

  const playableCandidates = scored.filter(p => {
      if (p.odds <= 1.01) return false;
      if (p.quality_flags.includes("incomplete_vector")) return false;

      if (excludeMismatch && p.is_mismatch) return false;

      return true;
  });

  const topPicks = selectPortfolio(playableCandidates, config);

  const topIds = new Set(topPicks.map(p => p.id));

  const watchlist = scored
      .filter(p => !topIds.has(p.id) && p.alpha_score > 80)
      .slice(0, 5);

  return {
      top: topPicks,
      all: scored,
      watchlist
  };
}

// --- 7. Sanity Check (V12) ---
function runSanityChecks(markets, probs, warnings) {
    const sum1X2 = markets.ft_1x2.home + markets.ft_1x2.draw + markets.ft_1x2.away;
    if (Math.abs(sum1X2 - 1) > 0.001) warnings.push(`sanity_1x2_sum_drift_${sum1X2.toFixed(4)}`);

    const sumBTTS = markets.ft_btts.yes + markets.ft_btts.no;
    if (Math.abs(sumBTTS - 1) > 0.001) warnings.push(`sanity_btts_sum_drift_${sumBTTS.toFixed(4)}`);
}


// --- 8. Main ---

function runEngine(inputs, config = {}) {
  const match = inputs.match || inputs;

  const { lambdaHome, lambdaAway, cornerLambdaHome, cornerLambdaAway, source, warnings } = estimateLambdas(match);

  const split1H = config.split_1h || 0.45;
  const split2H = config.split_2h || 0.55;

  const matrixFT = buildScoreMatrix(lambdaHome, lambdaAway);
  const matrixHT = buildScoreMatrix(lambdaHome * split1H, lambdaAway * split1H, 5);
  const matrix2H = buildScoreMatrix(lambdaHome * split2H, lambdaAway * split2H, 5);
  const matrixCorners = buildScoreMatrix(cornerLambdaHome, cornerLambdaAway);

  const marketsFT = deriveMarketsFromMatrix(matrixFT, "ft");
  const marketsHT = deriveMarketsFromMatrix(matrixHT, "ht");
  const markets2H = deriveMarketsFromMatrix(matrix2H, "2h");
  const marketsCorners = deriveCornerMarkets(matrixCorners);

  runSanityChecks(marketsFT, null, warnings);

  const allModelMarkets = { ...marketsFT, ...marketsHT, ...markets2H };

  const rawPicks = scanMarkets(match, allModelMarkets, marketsCorners, config);
  rawPicks.forEach(p => p.lambda_source = source);

  const ranked = rankAndFilterPicks(rawPicks, { source, warnings }, config);

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
        btts: Number(marketsFT.ft_btts.yes.toFixed(4)),
        over_2_5: Number(marketsFT.ft_goals["2.5"]?.over.toFixed(4)),
        corners_over_9_5: Number(marketsCorners.corners_ou["9.5"]?.over.toFixed(4))
      },
      engine_warnings: warnings
    },
    top_picks: ranked.top,
    watchlist: ranked.watchlist,
    all_value_bets: ranked.all
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
