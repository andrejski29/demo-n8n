// -------------------------
// n8n Node: Match Record Normalizer (Production-Safe V5.3)
// -------------------------

// --- 1. Input Extraction Helper ---
function getInput() {
  if (typeof item !== 'undefined' && item.json) return item.json;
  if (typeof items !== 'undefined' && items.length > 0 && items[0].json) return items[0].json;
  if (typeof $input !== 'undefined' && $input.item) return $input.item.json;
  if (typeof data !== 'undefined') return data;
  return {};
}

const raw = getInput();

// CRITICAL FIX: Defensive Input Check
if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [{ json: { error: "Invalid input format: Expected object", raw_type: typeof raw } }];
}

// --- 2. QA Structure & Versioning ---
const QA_VERSION = "5.3";
const now = new Date().toISOString();

function initQA(inputType) {
    return {
        status: "ok",
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
        markets_skipped_invalid: 0,
        provenance: { imputed_fields: [] }
    };
}

// CRITICAL FIX: ID Priority (match_id > id)
const matchId = (raw.match_id !== undefined && raw.match_id !== null) ? raw.match_id : raw.id;

// Check Input Type (V5 Signature OR Structural Detection for Partial Records)
const isAlreadyNormalized = (raw.qa && raw.qa.meta && raw.qa.meta.normalizer_version) || (raw.match_id && raw.odds && raw.odds.best);
const qa = initQA(isAlreadyNormalized ? "normalized" : "raw");

// --- Helper: Market Key Normalization ---
function normalizeKey(key) {
    let k = key.toLowerCase();

    // Map sh_ / 2nd_half -> 2h_
    if (k.startsWith("sh_")) k = k.replace("sh_", "2h_");
    if (k.includes("2nd_half")) k = k.replace("2nd_half", "2h");

    // Map DC keys to canonical
    if (k === "dc_home_draw") return "dc_1x";
    if (k === "dc_home_away") return "dc_12";
    if (k === "dc_draw_away") return "dc_x2";
    if (k === "dc_away_home") return "dc_12";

    // Map HT BTTS
    if (k === "btts_1st_half_yes" || k === "btts_1h_yes") return "ht_btts_yes";
    if (k === "btts_1st_half_no" || k === "btts_1h_no") return "ht_btts_no";

    // Map 2H BTTS
    if (k === "btts_2nd_half_yes" || k === "btts_2h_yes") return "2h_btts_yes";
    if (k === "btts_2nd_half_no" || k === "btts_2h_no") return "2h_btts_no";

    return k;
}

// --- 3. Logic Branching: Passthrough & MIGRATION ---
if (isAlreadyNormalized) {
    qa.status = "warning";
    qa.warnings.push("input_already_normalized");

    // Preserve existing QA info
    if (raw.qa) {
        if (raw.qa.warnings) qa.warnings.push(...raw.qa.warnings);
        if (raw.qa.provenance && Array.isArray(raw.qa.provenance.imputed_fields)) {
            qa.provenance.imputed_fields.push(...raw.qa.provenance.imputed_fields);
        }
    }

    let migrated = false;

    // A. Schema Migration: Ensure Signals in Context
    if (!raw.context) raw.context = {};

    // CRITICAL FIX: Ensure signals structure exists inside context
    if (!raw.context.signals) {
        if (raw.signals) {
            raw.context.signals = raw.signals;
        } else {
            // Reconstruct signals from context if possible, or init empty
            raw.context.signals = {
                ppg: {
                    home: raw.context.home_ppg || 0,
                    away: raw.context.away_ppg || 0
                },
                xg: {
                    home: raw.context.team_a_xg_prematch || 0,
                    away: raw.context.team_b_xg_prematch || 0,
                    total: raw.context.total_xg_prematch || 0
                }
            };
        }
    }

    // Check for specific imputed fields in context root (legacy support)
    // If raw.signals exists, ensure it syncs to context root
    if (raw.signals) {
        if (raw.signals.ppg && raw.context.home_ppg === undefined) {
            raw.context.home_ppg = raw.signals.ppg.home;
            raw.context.away_ppg = raw.signals.ppg.away;
            qa.provenance.imputed_fields.push('home_ppg', 'away_ppg');
            migrated = true;
        }
        if (raw.signals.xg && raw.context.team_a_xg_prematch === undefined) {
            raw.context.team_a_xg_prematch = raw.signals.xg.home;
            raw.context.team_b_xg_prematch = raw.signals.xg.away;
            raw.context.total_xg_prematch = raw.signals.xg.total;
            qa.provenance.imputed_fields.push('team_a_xg_prematch', 'team_b_xg_prematch');
            migrated = true;
        }
    }

    // B. Key Normalization & Corner Expansion
    if (raw.odds && raw.odds.best) {
        const newBest = {};
        Object.keys(raw.odds.best).forEach(key => {
            const canonical = normalizeKey(key);
            newBest[canonical] = raw.odds.best[key];

            // CRITICAL FIX: Backfill New Corner Keys if Legacy exists
            // Legacy: corners_over_X.5 -> New: corners_ou_over_X.5
            const cornerMatch = canonical.match(/^corners_(over|under)_([\d.]+)$/);
            if (cornerMatch) {
                const [_, side, line] = cornerMatch;
                const newKey = `corners_ou_${side}_${line}`;
                if (!newBest[newKey]) newBest[newKey] = raw.odds.best[key];
            }

            // Backfill Legacy if New exists
            const cornerOuMatch = canonical.match(/^corners_ou_(over|under)_([\d.]+)$/);
            if (cornerOuMatch) {
                const [_, side, line] = cornerOuMatch;
                const legacyKey = `corners_${side}_${line}`;
                if (!newBest[legacyKey]) newBest[legacyKey] = raw.odds.best[key];
            }
        });

        // Check for missing canonical keys from specific legacy aliases
        // e.g. dc_home_draw might have been missed if loop used keys directly
        // The loop above uses normalizeKey, so it handles it.

        raw.odds.best = newBest;
        migrated = true;
    }

    if (migrated) qa.warnings.push("schema_migrated_v5.3");

    // Dedupe provenance
    qa.provenance.imputed_fields = [...new Set(qa.provenance.imputed_fields)];
    raw.qa = qa;

    return [{ json: raw }];
}

// --- 4. FULL NORMALIZATION (Raw Input) ---

function isValidOdds(val) {
  if (val === undefined || val === null || val === "") return false;
  const n = Number(val);
  return Number.isFinite(n) && n > 1.0;
}

// Helper: Comparison Odds Mapper
function toMarketKeys(category, selection) {
  const cat = (category || "").toLowerCase();
  const sel = (selection || "").toLowerCase();
  const keys = [];
  const add = (k) => keys.push(k);

  // 1X2
  if (cat === "ft result" || cat === "match winner" || cat === "1x2") {
    if (sel === "1" || sel === "home") add("ft_1x2_home");
    else if (sel === "x" || sel === "draw") add("ft_1x2_draw");
    else if (sel === "2" || sel === "away") add("ft_1x2_away");
  }
  // BTTS
  else if (cat === "both teams to score" || cat === "btts") {
    if (sel === "yes") add("btts_yes");
    else if (sel === "no") add("btts_no");
  }
  // Double Chance
  else if (cat === "double chance") {
    if (sel === "1x" || sel === "home/draw") add("dc_1x");
    else if (sel === "12" || sel === "home/away") add("dc_12");
    else if (sel === "x2" || sel === "draw/away") add("dc_x2");
  }
  // HT 1X2
  else if (cat.includes("half time result") || cat.includes("1st half result")) {
      if (sel === "1" || sel === "home") add("ht_1x2_home");
      else if (sel === "x" || sel === "draw") add("ht_1x2_draw");
      else if (sel === "2" || sel === "away") add("ht_1x2_away");
  }
  // 2H 1X2
  else if (cat.includes("second half result") || cat.includes("2nd half result")) {
      if (sel === "1" || sel === "home") add("2h_1x2_home");
      else if (sel === "x" || sel === "draw") add("2h_1x2_draw");
      else if (sel === "2" || sel === "away") add("2h_1x2_away");
  }
  // Goals O/U
  else if (cat.includes("over/under") || cat.includes("goals")) {
     const match = selection.match(/(Over|Under)\s+([\d.]+)/i);
     if (match) {
         const type = match[1].toLowerCase();
         const line = match[2];
         if (cat.includes("1st") || cat.includes("half time")) add(`ht_goals_${type}_${line}`);
         else if (cat.includes("2nd") || cat.includes("second")) add(`2h_goals_${type}_${line}`);
         else add(`ft_goals_${type}_${line}`);
     }
  }
  // Corners (Legacy + New Support)
  else if (cat.includes("corner")) {
      const match = selection.match(/(Over|Under)\s+([\d.]+)/i);
      if (match) {
          const type = match[1].toLowerCase();
          const line = match[2];
          add(`corners_${type}_${line}`);       // Legacy
          add(`corners_ou_${type}_${line}`);    // New
      }
      else if (cat.includes("1x2") || sel.includes("home") || sel.includes("draw")) {
           if (sel.includes("home") || sel === "1") add("corners_1x2_home");
           if (sel.includes("draw") || sel === "x") add("corners_1x2_draw");
           if (sel.includes("away") || sel === "2") add("corners_1x2_away");
      }
  }
  // Cards
  else if (cat.includes("card")) {
      const match = selection.match(/(Over|Under)\s+([\d.]+)/i);
      if (match) {
          const type = match[1].toLowerCase();
          const line = match[2];
          add(`cards_ou_${type}_${line}`);
      }
  }
  // HT/2H BTTS
  else if (cat.includes("both teams to score")) {
      const side = sel === "yes" ? "yes" : "no";
      if (cat.includes("1st") || cat.includes("half time")) add(`ht_btts_${side}`);
      if (cat.includes("2nd") || cat.includes("second")) add(`2h_btts_${side}`);
  }

  return keys;
}

// Regex Mappings for Flat Odds
const FLAT_REGEX_MAP = [
  // Corners (Dual Key Generation)
  { pattern: /^odds_corners_over_(\d+)$/, map: (m) => [`corners_ou_over_${m[1]/10}`, `corners_over_${m[1]/10}`] },
  { pattern: /^odds_corners_under_(\d+)$/, map: (m) => [`corners_ou_under_${m[1]/10}`, `corners_under_${m[1]/10}`] },
  // Goals
  { pattern: /^odds_ft_over(\d+)$/, map: (m) => [`ft_goals_over_${m[1]/10}`] },
  { pattern: /^odds_ft_under(\d+)$/, map: (m) => [`ft_goals_under_${m[1]/10}`] },
  { pattern: /^odds_1st_half_over(\d+)$/, map: (m) => [`ht_goals_over_${m[1]/10}`] },
  { pattern: /^odds_1st_half_under(\d+)$/, map: (m) => [`ht_goals_under_${m[1]/10}`] },
  { pattern: /^odds_2nd_half_over(\d+)$/, map: (m) => [`2h_goals_over_${m[1]/10}`] },
  { pattern: /^odds_2nd_half_under(\d+)$/, map: (m) => [`2h_goals_under_${m[1]/10}`] },
];

const FLAT_ODDS_MAP_SIMPLE = {
    "odds_ft_1": "ft_1x2_home", "odds_ft_x": "ft_1x2_draw", "odds_ft_2": "ft_1x2_away",
    "odds_btts_yes": "btts_yes", "odds_btts_no": "btts_no",
    "odds_double_chance_1x": "dc_1x", "odds_double_chance_12": "dc_12", "odds_double_chance_2x": "dc_x2"
};

function flatKeyToMarketKeys(flatKey) {
  const results = [];
  if (FLAT_ODDS_MAP_SIMPLE[flatKey]) {
      results.push(normalizeKey(FLAT_ODDS_MAP_SIMPLE[flatKey]));
  } else {
      for (const r of FLAT_REGEX_MAP) {
        const match = flatKey.match(r.pattern);
        if (match) {
            const mapped = r.map(match);
            mapped.forEach(k => results.push(normalizeKey(k)));
            break;
        }
      }
  }
  return results;
}

// --- 5. Logic Execution ---

const bestOdds = {};
const flatSources = [];
const comparisonSources = [];

// A. Process Flat Odds (Defensive Loop)
if (raw && typeof raw === 'object') {
    for (const key of Object.keys(raw)) {
        if (key.startsWith("odds_")) {
            const marketKeys = flatKeyToMarketKeys(key);
            const val = raw[key];

            if (!isValidOdds(val)) {
                if (val !== 0 && val !== -1) qa.markets_skipped_invalid++;
                continue;
            }

            const oddVal = parseFloat(val);
            marketKeys.forEach(mKey => {
                if (!bestOdds[mKey]) {
                    bestOdds[mKey] = {
                        odds: oddVal,
                        book: "internal",
                        source: "flat",
                        picked_from: { flatKey: key }
                    };
                    qa.markets_total++;
                    flatSources.push(mKey);
                }
            });
        }
    }
}

// B. Process Comparison Odds (If available)
const odds_comparison = raw.odds_comparison;
if (odds_comparison && typeof odds_comparison === 'object') {
    for (const [category, selections] of Object.entries(odds_comparison)) {
        if (!selections || typeof selections !== 'object') continue;

        for (const [selection, books] of Object.entries(selections)) {
            const marketKeys = toMarketKeys(category, selection);
            if (marketKeys.length === 0) continue;

            // Find best bookmaker
            let maxOdd = 0;
            let bestBook = "";

            if (books && typeof books === 'object') {
                for (const [book, val] of Object.entries(books)) {
                    const fVal = parseFloat(val);
                    if (isValidOdds(fVal) && fVal > maxOdd) {
                        maxOdd = fVal;
                        bestBook = book;
                    }
                }
            }

            if (maxOdd > 0) {
                marketKeys.forEach(mKey => {
                    // Update Best Odds (Comparison usually overrides Flat)
                    if (!bestOdds[mKey] || maxOdd > bestOdds[mKey].odds) {
                         bestOdds[mKey] = {
                            odds: maxOdd,
                            book: bestBook,
                            source: "comparison",
                            picked_from: { category, selection }
                        };
                        qa.markets_total++;
                        comparisonSources.push(mKey);
                    }
                });
            }
        }
    }
}

// C. Construct Output
// Grouping logic
const oddsGroups = {};
Object.keys(bestOdds).forEach(key => {
    // Basic grouping heuristic
    const parts = key.split('_');
    const groupKey = parts.slice(0, 2).join('_'); // e.g. ft_1x2, corners_ou
    if (!oddsGroups[groupKey]) oddsGroups[groupKey] = [];
    oddsGroups[groupKey].push(key);
});

// Signals Extraction (Safe)
const signals = {
    ppg: {
        home: Number(raw.home_ppg || raw.stats?.seasonPPG_home || 0),
        away: Number(raw.away_ppg || raw.stats?.seasonPPG_away || 0)
    },
    xg: {
        home: Number(raw.team_a_xg_prematch || 0),
        away: Number(raw.team_b_xg_prematch || 0),
        total: Number(raw.total_xg_prematch || 0)
    },
    potentials: raw.potentials || {}
};

// Final Item Construction
const outputItem = {
    match_id: matchId,
    meta: raw.meta || {},
    teams: raw.teams || { home: {}, away: {} },
    context: {
        home_ppg: signals.ppg.home,
        away_ppg: signals.ppg.away,
        team_a_xg_prematch: signals.xg.home,
        team_b_xg_prematch: signals.xg.away,
        total_xg_prematch: signals.xg.total,
        ...signals.potentials,
        // CRITICAL FIX: Ensure signals object is present in context
        signals: signals,
        _meta: {
            lambda_source_ppg: signals.ppg.home ? 'present' : 'missing',
            lambda_source_xg: signals.xg.home ? 'present' : 'missing'
        }
    },
    // Keep top-level signals for legacy compatibility
    signals: signals,
    odds: {
        best: bestOdds,
        groups: oddsGroups,
        sources: {
            flat: flatSources,
            comparison: comparisonSources
        }
    },
    // Pass through heavy stats objects if present
    team_stats: raw.team_stats,
    h2h: raw.h2h,
    qa: qa
};

return [{ json: outputItem }];
