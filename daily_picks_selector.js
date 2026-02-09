/**
 * Daily Picks Selector Node (v2.3 - Final Refinement)
 *
 * Changelog v2.3:
 * - Date Parsing: Prefer string slice for 'YYYY-MM-DD' input.
 * - Reuse Policy: Strict implementation of 'none', 'core_only', 'full'.
 * - Mid Combo: Full pool search with strict 'Max 1 Single' limit.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
    // 1. CORE SINGLES (Safest Foundation)
    core: {
        prob_min: 0.62,
        conf_min: 70,
        odds_min: 1.25,
        odds_max: 2.00,
        limit_count: 6,
        ev_min: 0
    },

    // 2. VALUE SINGLES (Winnable Edge)
    value: {
        prob_min: 0.52,
        conf_min: 65,
        odds_min: 1.60,
        odds_max: 2.60,
        limit_count: 5,
        ev_min: 0
    },

    // 3. HIGH POTENTIAL (Controlled Upside, No Longshots)
    high_pot: {
        prob_min: 0.45,
        conf_min: 60,
        odds_min: 2.20,
        odds_max: 3.20,
        limit_count: 3,
        ev_min: 0
    },

    // 4. COMBOS
    combos: {
        reuse_policy: "core_only", // "none" | "core_only" | "full"
        mid_combo_max_reuse: 1,    // Max 1 reused single allowed in Mid Combo

        core_double: {
            max_leg_odds: 2.20
        },
        smart_double: {
            max_leg_odds: 2.60
        },
        mid_combo: {
            min_leg_odds: 1.40,
            max_leg_odds: 2.20,
            min_total: 3.0,
            max_total: 5.0,
            max_legs: 3
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
            // Safer Parsing: Check for YYYY-MM-DD at start
            if (/^\d{4}-\d{2}-\d{2}/.test(bet.date_iso)) {
                dayKey = bet.date_iso.substring(0, 10);
            } else {
                // Fallback to Date object parsing
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

    // 2. Process Each Day Independently
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
    // A. Filter & Classify
    const candidates = { core: [], value: [], high_pot: [] };

    bets.forEach(bet => {
        if (bet.ev <= 0) return;
        if (checkTier(bet, CONFIG.core)) candidates.core.push(bet);
        else if (checkTier(bet, CONFIG.value)) candidates.value.push(bet);
        else if (checkTier(bet, CONFIG.high_pot)) candidates.high_pot.push(bet);
    });

    // B. Deduplicate (Best per Match)
    const allCandidates = [
        ...candidates.core.map(b => ({ ...b, _tier: 'core' })),
        ...candidates.value.map(b => ({ ...b, _tier: 'value' })),
        ...candidates.high_pot.map(b => ({ ...b, _tier: 'high_pot' }))
    ];

    const bestPerMatch = {};
    allCandidates.forEach(bet => {
        const existing = bestPerMatch[bet.match_id];
        if (!existing) {
            bestPerMatch[bet.match_id] = bet;
        } else {
            // Priority: P > Conf > SortScore > EV
            if (bet.p_model > existing.p_model) {
                bestPerMatch[bet.match_id] = bet;
            } else if (bet.p_model === existing.p_model) {
                if (bet.confidence_score > existing.confidence_score) {
                    bestPerMatch[bet.match_id] = bet;
                } else if (bet.confidence_score === existing.confidence_score) {
                    if (bet.sort_score > existing.sort_score) {
                        bestPerMatch[bet.match_id] = bet;
                    }
                }
            }
        }
    });

    // C. Select Singles
    const selectedTiers = { core: [], value: [], high_pot: [] };
    const sorter = (a, b) => {
        if (b.p_model !== a.p_model) return b.p_model - a.p_model;
        if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;
        return b.sort_score - a.sort_score;
    };

    Object.values(bestPerMatch).forEach(bet => selectedTiers[bet._tier].push(bet));

    const finalCore = selectedTiers.core.sort(sorter).slice(0, CONFIG.core.limit_count);
    const finalValue = selectedTiers.value.sort(sorter).slice(0, CONFIG.value.limit_count);
    const finalHighPot = selectedTiers.high_pot.sort(sorter).slice(0, CONFIG.high_pot.limit_count);

    // D. Generate Combos

    // 1. Identify Match IDs for Reuse Policy
    const coreIds = new Set(finalCore.map(b => b.match_id));
    const valueIds = new Set(finalValue.map(b => b.match_id));
    const highPotIds = new Set(finalHighPot.map(b => b.match_id));

    const allSinglesIds = new Set([...coreIds, ...valueIds, ...highPotIds]);

    // Determine Allowed Reuse based on Policy
    let allowedReuseIds = new Set();
    const policy = CONFIG.combos.reuse_policy;

    if (policy === 'full') {
        allowedReuseIds = allSinglesIds;
    } else if (policy === 'core_only') {
        allowedReuseIds = coreIds;
    }
    // 'none' leaves allowedReuseIds empty

    // 2. Base Pool
    // Full sorted pool of all deduplicated best bets per match
    const comboPool = Object.values(bestPerMatch).sort(sorter);

    const combos = { core_double: null, smart_double: null, mid_combo: null, debug: [] };
    const comboUsedMatches = new Set(); // Matches used in *other* combos

    // Helper: Filter candidates for Doubles (Strict Policy Enforcement)
    const getDoubleCandidates = (maxOdds) => {
        return comboPool.filter(b =>
            !comboUsedMatches.has(b.match_id) && // Unique across combos
            b.odds <= maxOdds &&
            // Reuse Logic: Allowed if (Not in Singles) OR (In Allowed Reuse Set)
            (!allSinglesIds.has(b.match_id) || allowedReuseIds.has(b.match_id))
        );
    };

    // --- CORE DOUBLE ---
    let pool = getDoubleCandidates(CONFIG.combos.core_double.max_leg_odds);
    if (pool.length >= 2) {
        combos.core_double = {
            type: "CORE DOUBLE",
            legs: [pool[0], pool[1]],
            total_odds: parseFloat((pool[0].odds * pool[1].odds).toFixed(2))
        };
        comboUsedMatches.add(pool[0].match_id);
        comboUsedMatches.add(pool[1].match_id);
    }

    // --- SMART DOUBLE ---
    pool = getDoubleCandidates(CONFIG.combos.smart_double.max_leg_odds);
    if (pool.length >= 2) {
        combos.smart_double = {
            type: "SMART DOUBLE",
            legs: [pool[0], pool[1]],
            total_odds: parseFloat((pool[0].odds * pool[1].odds).toFixed(2))
        };
        comboUsedMatches.add(pool[0].match_id);
        comboUsedMatches.add(pool[1].match_id);
    }

    // --- MID COMBO (Max 1 Reuse Logic) ---
    // Candidate Pool: All valid legs (1.4-2.2) NOT used in other combos
    const midCandidates = comboPool.filter(b =>
        !comboUsedMatches.has(b.match_id) &&
        b.odds >= CONFIG.combos.mid_combo.min_leg_odds &&
        b.odds <= CONFIG.combos.mid_combo.max_leg_odds
    );

    // We pass sets to recursion to enforce:
    // 1. Leg allowed? (Is it allowed by policy if it is a single?)
    // 2. Count limit? (Max 1 from the singles set)
    combos.mid_combo = generateMidComboRecursive(midCandidates, 3, allSinglesIds, allowedReuseIds)
                    || generateMidComboRecursive(midCandidates, 2, allSinglesIds, allowedReuseIds);

    return {
        day_utc: day,
        meta: {
            generated_at: new Date().toISOString(),
            input_count: bets.length,
            pool_size_deduped: Object.keys(bestPerMatch).length
        },
        core_singles: finalCore,
        value_singles: finalValue,
        high_potential_singles: finalHighPot,
        combos: combos
    };
}

function checkTier(bet, tierConfig) {
    return (
        bet.p_model >= tierConfig.prob_min &&
        bet.confidence_score >= tierConfig.conf_min &&
        bet.odds >= tierConfig.odds_min &&
        bet.odds <= tierConfig.odds_max
    );
}

function generateMidComboRecursive(pool, targetLegs, allSinglesIds, allowedReuseIds) {
    if (pool.length < targetLegs) return null;

    const maxReuse = CONFIG.combos.mid_combo_max_reuse;

    const search = (index, currentCombo, currentOdds, reuseCount) => {
        if (currentCombo.length === targetLegs) {
            if (currentOdds >= CONFIG.combos.mid_combo.min_total && currentOdds <= CONFIG.combos.mid_combo.max_total) {
                return {
                    type: `MID COMBO (${targetLegs}-Leg)`,
                    legs: currentCombo,
                    total_odds: parseFloat(currentOdds.toFixed(2))
                };
            }
            return null;
        }

        for (let i = index; i < Math.min(pool.length, 12); i++) {
            const nextLeg = pool[i];

            // --- REUSE & POLICY CHECKS ---
            const isSingle = allSinglesIds.has(nextLeg.match_id);

            // 1. Policy Check: If it is a single, is it in the allowed set?
            if (isSingle && !allowedReuseIds.has(nextLeg.match_id)) {
                continue; // Skip: Single but not allowed by policy
            }

            // 2. Count Check: Max 1 reused single
            if (isSingle && reuseCount >= maxReuse) {
                continue; // Skip: Reuse limit reached
            }

            // --- ODDS CHECK ---
            const newOdds = currentOdds * nextLeg.odds;
            if (newOdds > CONFIG.combos.mid_combo.max_total) continue;

            const res = search(i + 1, [...currentCombo, nextLeg], newOdds, reuseCount + (isSingle ? 1 : 0));
            if (res) return res;
        }
        return null;
    };

    return search(0, [], 1, 0);
}

// ============================================================================
// EXPORT / N8N WRAPPER
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
    module.exports = { selectDailyPortfolio };
}
