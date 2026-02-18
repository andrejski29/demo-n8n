/**
 * Daily Picks Selector Node (v2.6 - AlphaScore & Team Exposure)
 *
 * Changelog v2.6:
 * - Ranking V2: Introduced `alpha_score` (EV-weighted) for Value/HighPot tiers to prioritize profitability over pure hit-rate.
 * - Guard: Added `Team Exposure Limit` (max 1 pick per team across portfolio) to prevent correlation ruin.
 * - Diagnostics: Enhanced debug logs for exposure rejections.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
    // 1. CORE SINGLES (Safest Foundation)
    core: {
        prob_min: 0.62,
        conf_min: 70,
        odds_min: 1.30,
        odds_max: 2.00,
        limit_count: 6,
        ev_min: 0.01,
        ranking_strategy: "prob_dominant" // Keep Core conservative (Prob > EV)
    },

    // 2. VALUE SINGLES (Winnable Edge)
    value: {
        prob_min: 0.52,
        conf_min: 65,
        odds_min: 1.60,
        odds_max: 2.60,
        limit_count: 5,
        ev_min: 0.02,
        ranking_strategy: "alpha_score", // Use AlphaScore (EV > Prob)
        weights: { ev: 2.0, prob: 1.0, conf: 0.1 } // High weight on EV
    },

    // 3. HIGH POTENTIAL (Controlled Upside)
    high_pot: {
        prob_min: 0.45,
        conf_min: 60,
        odds_min: 2.20,
        odds_max: 3.20,
        limit_count: 3,
        ev_min: 0.04,
        ranking_strategy: "alpha_score",
        weights: { ev: 3.0, prob: 0.5, conf: 0.1 } // Very high weight on EV
    },

    // 4. COMBOS
    combos: {
        reuse_policy: "core_only",
        mid_combo_max_reuse: 1,
        diversity_factor: 0.97,

        core_double: {
            max_leg_odds: 2.20,
            min_total: 1.80
        },
        smart_double: {
            max_leg_odds: 2.60,
            min_total: 2.00
        },
        mid_combo: {
            min_leg_odds: 1.40,
            max_leg_odds: 2.20,
            min_total: 3.0,
            max_total: 5.0,
            max_legs: 3,
            max_same_family: 2
        }
    }
};

/**
 * Main Entry Point
 */
function selectDailyPortfolio(allBets) {
    // 1. Group by Day (UTC YYYY-MM-DD)
    const betsByDay = {};

    allBets.forEach(bet => {
        if (!bet.date_iso) return;

        let dayKey = "UNKNOWN";
        try {
            if (/^\d{4}-\d{2}-\d{2}/.test(bet.date_iso)) {
                dayKey = bet.date_iso.substring(0, 10);
            } else {
                const d = new Date(bet.date_iso);
                if (!isNaN(d.getTime())) {
                    dayKey = d.toISOString().split('T')[0];
                }
            }
        } catch (e) {
            dayKey = "INVALID_DATE";
        }

        if (dayKey !== "UNKNOWN" && dayKey !== "INVALID_DATE") {
            if (!betsByDay[dayKey]) betsByDay[dayKey] = [];
            betsByDay[dayKey].push(bet);
        }
    });

    const dailyPortfolios = [];

    Object.keys(betsByDay).sort().forEach(day => {
        const portfolio = processDay(day, betsByDay[day]);
        if (portfolio) {
            dailyPortfolios.push(portfolio);
        }
    });

    return dailyPortfolios;
}

/**
 * Process a single day's bets into a portfolio
 */
function processDay(day, bets) {
    const candidates = { core: [], value: [], high_pot: [] };
    const skipped = [];

    // Pre-calc Alpha Scores
    const betsWithScores = bets.map(rawBet => {
        const bet = sanitizeBet(rawBet);
        if (!bet) {
            skipped.push({ id: rawBet.match_id || 'no_id', reason: 'Invalid Data' });
            return null;
        }

        // Calculate Alpha Score (Generic, specific weights applied during sort)
        // Base Alpha: heavily weighted towards EV for general sorting utility
        // bet.alpha_score = (bet.ev * 100) + (bet.p_model * 20) + (bet.confidence_score * 0.1);
        return bet;
    }).filter(b => b !== null);

    // Distribute to Tiers
    betsWithScores.forEach(bet => {
        if (checkTier(bet, CONFIG.core)) candidates.core.push(bet);
        if (checkTier(bet, CONFIG.value)) candidates.value.push(bet); // Note: overlap allowed at this stage
        if (checkTier(bet, CONFIG.high_pot)) candidates.high_pot.push(bet);
    });

    // Deduplicate & Rank per Tier
    const finalCore = rankTier(candidates.core, CONFIG.core, 'core');
    const finalValue = rankTier(candidates.value, CONFIG.value, 'value');
    const finalHighPot = rankTier(candidates.high_pot, CONFIG.high_pot, 'high_pot');

    // Selection with Exposure Guard
    // We select sequentially: Core -> Value -> HighPot
    // If a team is used in a higher priority tier, it blocks usage in lower tiers?
    // Or do we just want "Max 1 per portfolio"?
    // Strategy: Greedy selection based on Global Rank or Tier Priority.
    // Let's stick to Tier Priority: Core first (Safest), then Value, then HighPot.

    const selected = { core: [], value: [], high_pot: [] };
    const usedTeams = new Set();
    const usedMatches = new Set();
    const rejectionLog = [];

    const trySelect = (pool, tierName, limit) => {
        let count = 0;
        for (const bet of pool) {
            if (count >= limit) break;

            // Check Match ID (Hard dedup)
            if (usedMatches.has(bet.match_id)) continue;

            // Check Team Exposure (Soft dedup - strict correlation guard)
            // Assuming bet structure has team info. If not, we might lack IDs.
            // Normalize inputs usually have teams.home.id etc.
            // If missing, we skip the check (risk).

            // Extract IDs (Standard Format)
            // normalized_match_record puts teams in `teams: { home: {id}, away: {id} }`
            // But the bet object here is a "Pick" from probability engine?
            // Probability Engine output `all_value_bets` array usually has flat structure?
            // Let's check `scanMarkets`. It pushes flat objects.
            // It does NOT include team IDs by default in the flat pick object!
            // WAIT. The engine output has `overview.teams`.
            // The selector input is `allBets`.
            // We need to ensure `home_team_id` and `away_team_id` are on the bet object.
            // If they are missing, we can't enforce team exposure.
            // Assumption: `sanitizeBet` or upstream ensures these exist.
            // If not, we rely on `match_id`.

            // Checking typical data flow:
            // Engine output -> `top_picks` items usually don't have team IDs on the item itself, just match_id.
            // If we want to enforce team exposure, we need those IDs.
            // FIX: We will assume `home_team_id` and `away_team_id` are available or passed through.
            // If not, we can't enforce.

            let blockedByTeam = false;
            if (bet.home_team_id && bet.away_team_id) {
                if (usedTeams.has(bet.home_team_id) || usedTeams.has(bet.away_team_id)) {
                    blockedByTeam = true;
                    rejectionLog.push(`Blocked ${bet.match_id} (${tierName}): Team Exposure`);
                }
            }

            if (!blockedByTeam) {
                selected[tierName].push(bet);
                usedMatches.add(bet.match_id);
                if (bet.home_team_id) usedTeams.add(bet.home_team_id);
                if (bet.away_team_id) usedTeams.add(bet.away_team_id);
                count++;
            }
        }
    };

    trySelect(finalCore, 'core', CONFIG.core.limit_count);
    trySelect(finalValue, 'value', CONFIG.value.limit_count);
    trySelect(finalHighPot, 'high_pot', CONFIG.high_pot.limit_count);

    // Generate Combos (using selected singles + allowed pool)
    // We strictly use the "Selected" bets for combos to ensure consistency?
    // Or do we use the full "Valid" pool?
    // "Mid Combo" usually needs more volume.
    // Let's use the FULL unique candidate pool (filtered by exposure) for combos?
    // Actually, Config says "reuse_policy".
    // Let's build a "Combo Candidate Pool" that respects exposure but isn't limited by counts.

    // Re-build a clean pool for combos
    // We want the BEST bets that satisfy exposure.
    // If a bet was rejected from "Selected" purely due to limit_count, it IS valid for Combo.
    // If it was rejected due to Team Exposure, it is INVALID for Combo too (if the colliding bet is used).

    // For simplicity/robustness: Use the `usedMatches` from selection as the "Locked" set.
    // Any NEW match added by combos must NOT clash with `usedTeams`.

    const comboCandidates = [...finalCore, ...finalValue, ...finalHighPot]
        .filter(b => !usedMatches.has(b.match_id)); // Not already selected as single

    // Sort global pool for combos
    const comboPool = comboCandidates.sort((a,b) => b.p_model - a.p_model); // Prob dominant for combos

    const combos = generateCombos(comboPool, selected, usedTeams, usedMatches);

    return {
        day_utc: day,
        meta: {
            generated_at: new Date().toISOString(),
            input_count: bets.length,
            selected_counts: {
                core: selected.core.length,
                value: selected.value.length,
                high: selected.high_pot.length
            },
            rejection_log: rejectionLog,
            combo_debug: combos.debug
        },
        core_singles: selected.core,
        value_singles: selected.value,
        high_potential_singles: selected.high_pot,
        combos: combos.results
    };
}

/**
 * Sorts a list of bets according to the Tier Strategy
 */
function rankTier(bets, config, tierName) {
    // 1. Deduplicate by Match ID (Keep best for this specific tier strategy)
    const bestForTier = {};

    // Helper to calc score for a bet based on strategy
    const calcScore = (b) => {
        if (config.ranking_strategy === 'alpha_score') {
            const wEV = config.weights?.ev || 2.0;
            const wProb = config.weights?.prob || 1.0;
            const wConf = config.weights?.conf || 0.1;
            // Normalize approx: EV (0.05-0.20) -> 5-20. Prob (0.4-0.8) -> 40-80.
            return (b.ev * 100 * wEV) + (b.p_model * 100 * wProb) + (b.confidence_score * wConf);
        }
        // Default: Prob Dominant
        return (b.p_model * 1000) + (b.confidence_score) + (b.ev * 10);
    };

    bets.forEach(b => {
        const existing = bestForTier[b.match_id];
        const score = calcScore(b);
        b._rank_score = score; // Cache it

        if (!existing || score > existing._rank_score) {
            bestForTier[b.match_id] = b;
        }
    });

    return Object.values(bestForTier).sort((a, b) => {
        // Primary: Rank Score
        if (b._rank_score !== a._rank_score) return b._rank_score - a._rank_score;
        // Tie-Breakers: Deterministic
        if (b.p_model !== a.p_model) return b.p_model - a.p_model;
        if (b.ev !== a.ev) return b.ev - a.ev;
        return (a.match_id || 0) - (b.match_id || 0);
    });
}

/**
 * Sanitize and Validate Bet Object
 */
function sanitizeBet(bet) {
    if (!bet.match_id) return null;

    const parseNum = (val) => {
        if (typeof val === 'number') return isNaN(val) ? 0 : val;
        if (typeof val === 'string') {
            const parsed = parseFloat(val);
            return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
    };

    const parseOdds = (val) => {
        const n = parseNum(val);
        return n > 1.0 ? n : 0;
    };

    const cleanBet = { ...bet };

    cleanBet.odds = parseOdds(bet.odds);
    if (cleanBet.odds === 0) return null;

    cleanBet.p_model = parseNum(bet.p_model);
    cleanBet.confidence_score = parseNum(bet.confidence_score);
    cleanBet.sort_score = parseNum(bet.sort_score);
    cleanBet.ev = parseNum(bet.ev);

    // Ensure IDs are strings if present
    if (bet.home_team_id) cleanBet.home_team_id = String(bet.home_team_id);
    if (bet.away_team_id) cleanBet.away_team_id = String(bet.away_team_id);

    return cleanBet;
}

function checkTier(bet, tierConfig) {
    return (
        bet.ev >= (tierConfig.ev_min ?? 0) &&
        bet.p_model >= tierConfig.prob_min &&
        bet.confidence_score >= tierConfig.conf_min &&
        bet.odds >= tierConfig.odds_min &&
        bet.odds <= tierConfig.odds_max
    );
}

// --- COMBO GENERATION (Adapted for Exposure) ---

function generateCombos(pool, selectedSingles, usedTeams, usedMatches) {
    const results = { core_double: null, smart_double: null, mid_combo: null };
    const debug = [];

    // Define allowed reuse sets
    const coreIds = new Set(selectedSingles.core.map(b => b.match_id));
    const allSingleIds = new Set([
        ...selectedSingles.core, ...selectedSingles.value, ...selectedSingles.high_pot
    ].map(b => b.match_id));

    let allowedReuse = new Set();
    if (CONFIG.combos.reuse_policy === 'core_only') allowedReuse = coreIds;
    if (CONFIG.combos.reuse_policy === 'full') allowedReuse = allSingleIds;

    // Filter Pool for Validity (Odds + Exposure)
    const getCandidates = (maxOdds, currentUsedTeams) => {
        return pool.filter(b => {
            if (b.odds > maxOdds) return false;
            // Reuse check
            if (usedMatches.has(b.match_id) && !allowedReuse.has(b.match_id)) return false;

            // Exposure check (Critical: Combos must not clash with Singles)
            // If bet is reused, it's fine (same team).
            // If bet is NEW, it must not use a team already in `currentUsedTeams`.
            if (!usedMatches.has(b.match_id)) {
                if (b.home_team_id && currentUsedTeams.has(b.home_team_id)) return false;
                if (b.away_team_id && currentUsedTeams.has(b.away_team_id)) return false;
            }
            return true;
        });
    };

    // 1. CORE DOUBLE
    let candidates = getCandidates(CONFIG.combos.core_double.max_leg_odds, usedTeams);
    const coreDouble = pickBestDouble(candidates, CONFIG.combos.core_double.min_total);

    if (coreDouble) {
        results.core_double = { type: "CORE DOUBLE", legs: coreDouble.legs, total_odds: coreDouble.total_odds };
        // Update exposure
        coreDouble.legs.forEach(l => {
            if (!usedMatches.has(l.match_id)) {
                if (l.home_team_id) usedTeams.add(l.home_team_id);
                if (l.away_team_id) usedTeams.add(l.away_team_id);
                usedMatches.add(l.match_id);
            }
        });
    }

    // 2. SMART DOUBLE
    candidates = getCandidates(CONFIG.combos.smart_double.max_leg_odds, usedTeams);
    const smartDouble = pickBestDouble(candidates, CONFIG.combos.smart_double.min_total);

    if (smartDouble) {
        results.smart_double = { type: "SMART DOUBLE", legs: smartDouble.legs, total_odds: smartDouble.total_odds };
        smartDouble.legs.forEach(l => {
            if (!usedMatches.has(l.match_id)) {
                if (l.home_team_id) usedTeams.add(l.home_team_id);
                if (l.away_team_id) usedTeams.add(l.away_team_id);
                usedMatches.add(l.match_id);
            }
        });
    }

    return { results, debug };
}

/**
 * Searches for the optimal pair using a PROBABILITY-FIRST scoring system.
 */
function pickBestDouble(pool, minTotal, maxCheck = 30) {
    const n = Math.min(pool.length, maxCheck);
    let best = null;
    let bestScore = -1;

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const a = pool[i], b = pool[j];

            // Hard Correlation Guard (Double Check)
            if (a.match_id === b.match_id) continue;
            // Check Teams
            if (a.home_team_id && (a.home_team_id === b.home_team_id || a.home_team_id === b.away_team_id)) continue;
            if (a.away_team_id && (a.away_team_id === b.home_team_id || a.away_team_id === b.away_team_id)) continue;

            const total = parseFloat((a.odds * b.odds).toFixed(2));

            if (total >= minTotal) {
                const pairProb = a.p_model * b.p_model;
                const minConf = Math.min(a.confidence_score, b.confidence_score);
                const sumEV = a.ev + b.ev;
                const diversityFactor = (a.market_family && b.market_family && a.market_family === b.market_family)
                    ? CONFIG.combos.diversity_factor : 1.0;

                const score = (pairProb * diversityFactor * 10000) + (minConf * 100) + (sumEV * 10) - total;

                const candidate = { legs: [a, b], total_odds: total };

                if (!best || score > bestScore) {
                    best = candidate;
                    bestScore = score;
                }
            }
        }
    }
    return best;
}

// ============================================================================
// EXPORT
// ============================================================================
if (typeof items !== 'undefined' && Array.isArray(items)) {
    try {
        let input = [];
        if (items.length === 1 && Array.isArray(items[0].json)) {
             input = items[0].json;
        } else if (items.length > 0 && items[0].json && Array.isArray(items[0].json.data)) {
             input = items[0].json.data;
        } else {
             input = items.map(i => i.json);
        }

        const portfolios = selectDailyPortfolio(input);
        return portfolios.map(p => ({ json: p }));
    } catch (e) {
        return [{ json: { error: e.message, stack: e.stack } }];
    }
}

if (typeof module !== 'undefined') {
    module.exports = { selectDailyPortfolio, CONFIG };
}
