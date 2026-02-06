// -------------------------
// n8n Node: Probability Engine & EV Scanner (Tier 1)
// -------------------------

// --- 1. Math Helpers ---

// Factorial cache for performance
const FACTORIALS = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
function factorial(n) {
  if (n < 0) return 1;
  if (n < FACTORIALS.length) return FACTORIALS[n];
  let f = FACTORIALS[FACTORIALS.length - 1];
  for (let i = FACTORIALS.length; i <= n; i++) f *= i;
  return f;
}

// Poisson Probability Mass Function: P(k; lambda) = (lambda^k * e^-lambda) / k!
function poisson(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// --- 2. Modeling Core (Goals) ---

// Generate Scoreline Probability Matrix (e.g. 0-0 to 9-9)
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

  // Normalization (handle truncation tail)
  // Although Poisson tail is small, for betting precision we re-normalize to sum=1.0
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
function deriveMarketsFromMatrix(matrix) {
  const markets = {
    "1X2": { home: 0, draw: 0, away: 0 },
    "btts": { yes: 0, no: 0 },
    "over_under": {}, // Will populate dynamic lines
    "clean_sheet": { home: 0, away: 0 },
    "double_chance": { "1x": 0, "12": 0, "x2": 0 },
    "correct_score": {} // Top scores
  };

  const maxGoals = matrix.length - 1;
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5];

  // Initialize O/U accumulators
  lines.forEach(L => markets.over_under[L] = { over: 0, under: 0 });

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];

      // 1X2
      if (h > a) markets["1X2"].home += p;
      else if (a > h) markets["1X2"].away += p;
      else markets["1X2"].draw += p;

      // BTTS
      if (h > 0 && a > 0) markets.btts.yes += p;
      else markets.btts.no += p;

      // Clean Sheet (Home keeps clean sheet if Away=0)
      if (a === 0) markets.clean_sheet.home += p;
      // Away keeps clean sheet if Home=0
      if (h === 0) markets.clean_sheet.away += p;

      // Over/Under
      const total = h + a;
      lines.forEach(L => {
        if (total > L) markets.over_under[L].over += p;
        else markets.over_under[L].under += p;
      });
    }
  }

  // Double Chance Derived
  markets.double_chance["1x"] = markets["1X2"].home + markets["1X2"].draw;
  markets.double_chance["12"] = markets["1X2"].home + markets["1X2"].away;
  markets.double_chance["x2"] = markets["1X2"].draw + markets["1X2"].away;

  return markets;
}

// --- 3. Lambda Estimation (Tier 1: Simple Weighted Average) ---
// In V1, we trust the 'pre-match xG' or 'PPG' signals provided in the MatchRecord (from FootyStats)
// or we fall back to a simple calculation from TeamStats if available.
function estimateLambdas(matchRecord, homeStats, awayStats) {
  // Priority 1: Use pre-calculated xG from MatchRecord signals (FootyStats usually provides this)
  let lambdaHome = matchRecord.signals?.xg?.home;
  let lambdaAway = matchRecord.signals?.xg?.away;

  // Fallback / Validation
  if (!lambdaHome || lambdaHome < 0.1) lambdaHome = 1.35; // League avg fallback
  if (!lambdaAway || lambdaAway < 0.1) lambdaAway = 1.10; // League avg fallback

  // Clamp extreme values for safety
  lambdaHome = Math.max(0.1, Math.min(4.5, lambdaHome));
  lambdaAway = Math.max(0.1, Math.min(4.5, lambdaAway));

  return { lambdaHome, lambdaAway };
}

// --- 4. EV & Edge Calculation ---

function calculateEV(pModel, odds) {
  if (!odds || odds <= 1.0) return null;
  // EV = (Probability * DecimalOdds) - 1
  return (pModel * odds) - 1;
}

function marginAdjustedProb(oddsVector) {
  // oddsVector: { "home": 2.2, "draw": 3.2, "away": 3.5 }
  // Calculate implied probs: 1/odds
  // Sum them to get book sum (e.g. 1.05)
  // True prob = implied / sum

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

// --- 5. Market Scanner Main Loop ---

function scanMarkets(matchRecord, modelMarkets) {
  const results = [];
  const odds = matchRecord.odds?.best || {};

  // Helper to process a specific market
  // mapping: function to map model keys to odds keys
  const process = (marketType, modelProbs, oddsKeysMap, confidence) => {
    // 1. Get Odds for this market group
    // We need to reconstruct the full odds vector to devig (remove margin) correctly.
    // This is tricky because `odds.best` is flattened.
    // We group by "market type" manually.

    const vector = {};
    let hasOdds = false;

    // Build vector for devig
    for (const [modelSel, oddKey] of Object.entries(oddsKeysMap)) {
      if (odds[oddKey]?.odds) {
        vector[modelSel] = odds[oddKey].odds;
        hasOdds = true;
      }
    }

    if (!hasOdds) return;

    // Calculate Fair Market Probabilities (Devig)
    const marketProbs = marginAdjustedProb(vector); // Returns { modelSel: p_fair } or null

    // Evaluate each selection
    for (const [modelSel, oddKey] of Object.entries(oddsKeysMap)) {
      const offeredOddsObj = odds[oddKey];
      if (!offeredOddsObj) continue;

      const offeredOdds = offeredOddsObj.odds;
      const pModel = modelProbs[modelSel];
      const pMarket = marketProbs ? marketProbs[modelSel] : (1 / offeredOdds); // Fallback if full vector missing

      // EV Calculation
      const ev = calculateEV(pModel, offeredOdds);
      const edge = pModel - pMarket;

      if (ev !== null && ev > 0) { // Only keep positive EV
        results.push({
          market: marketType,
          selection: modelSel,
          odds: offeredOdds,
          p_model: Number(pModel.toFixed(4)),
          p_market: Number(pMarket.toFixed(4)),
          edge: Number(edge.toFixed(4)),
          ev: Number(ev.toFixed(4)),
          confidence: confidence,
          source: offeredOddsObj.source
        });
      }
    }
  };

  // --- 1X2 ---
  process("1X2", modelMarkets["1X2"], {
    "home": "ft_1x2_home",
    "draw": "ft_1x2_draw",
    "away": "ft_1x2_away"
  }, "High");

  // --- Double Chance ---
  process("Double Chance", modelMarkets.double_chance, {
    "1x": "dc_1x",
    "12": "dc_12",
    "x2": "dc_x2"
  }, "Medium");

  // --- BTTS ---
  process("BTTS", modelMarkets.btts, {
    "yes": "btts_yes",
    "no": "btts_no"
  }, "High");

  // --- Over/Under ---
  // Iterate lines 0.5 to 4.5
  for (const line of ["0.5", "1.5", "2.5", "3.5", "4.5"]) {
    if (!modelMarkets.over_under[line]) continue;
    process(`Over/Under ${line}`, modelMarkets.over_under[line], {
      "over": `ft_goals_over_${line}`,
      "under": `ft_goals_under_${line}`
    }, "High");
  }

  return results;
}

// --- 6. Ranking Logic ---
function rankPicks(picks) {
  // Score = w1*EV + w2*Edge + ConfidenceBonus
  // Tiering:
  // A: EV > 0.05, High Confidence
  // B: EV > 0.02, High/Medium
  // C: EV > 0, Any

  return picks.map(p => {
    let score = (p.ev * 100) * 0.7 + (p.edge * 100) * 0.3;
    if (p.confidence === "High") score += 5;
    if (p.confidence === "Medium") score += 2;

    let tier = "C";
    if (p.ev > 0.10 && p.confidence === "High") tier = "S"; // Super
    else if (p.ev > 0.05 && (p.confidence === "High" || p.confidence === "Medium")) tier = "A";
    else if (p.ev > 0.02) tier = "B";

    return { ...p, score: Number(score.toFixed(2)), tier };
  }).sort((a, b) => b.score - a.score);
}

// --- 7. Main Execution ---

function runEngine(inputs) {
  // Unpack inputs (Assume array of objects { match, home, away } or just match record if standalone)
  // For n8n "Run Each", input is just the JSON.

  const match = inputs.match || inputs; // 'match' object from previous step

  // 1. Estimate Lambdas
  const { lambdaHome, lambdaAway } = estimateLambdas(match);

  // 2. Build Probability Matrix
  const matrix = buildScoreMatrix(lambdaHome, lambdaAway);

  // 3. Derive Market Probabilities
  const modelMarkets = deriveMarketsFromMatrix(matrix);

  // 4. Scan for Value
  const rawPicks = scanMarkets(match, modelMarkets);

  // 5. Rank
  const rankedPicks = rankPicks(rawPicks);

  // 6. Format Output
  return {
    match_id: match.match_id,
    overview: {
      teams: match.teams,
      lambdas: { home: lambdaHome, away: lambdaAway },
      probs: {
        home_win: Number(modelMarkets["1X2"].home.toFixed(4)),
        draw: Number(modelMarkets["1X2"].draw.toFixed(4)),
        away_win: Number(modelMarkets["1X2"].away.toFixed(4)),
        btts: Number(modelMarkets.btts.yes.toFixed(4)),
        over_2_5: Number(modelMarkets.over_under["2.5"]?.over.toFixed(4))
      }
    },
    scanner: rankedPicks, // Full list
    shortlist: rankedPicks.slice(0, 5) // Top 5
  };
}

// --- n8n Wrapper ---
// Handle n8n item iteration
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
  // Export for local testing
  module.exports = { runEngine };
}
