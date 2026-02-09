/**
 * Daily Picks Selector Node (v2.1 - Fixes & Quality Assurance)
 *
 * Changelog v2.1:
 * - Fixed Date Grouping (Robust UTC Date parsing)
 * - Added Combo Reuse Policy (Prevent starvation on small slates)
 * - Improved Deduplication Logic (Strict P > Conf > Sort order)
 * - Tuned Mid Combo Search (Prioritize 3-leg stability)
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
        allow_reuse_singles: true, // Allow reusing singles in combos
        reuse_policy: "core_only", // "none" | "core_only" | "full"
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
 * @param {Array} allBets - Flat list of bet objects
 * @returns {Array} - Array of Daily Portfolio Objects
 */
function selectDailyPortfolio(allBets) {
    // 1. Group by Day (UTC YYYY-MM-DD)
    const betsByDay = {};

    allBets.forEach(bet => {
        if (!bet.date_iso) return;

        let dayKey = "UNKNOWN";
        try {
            // Normalize spaces to T for standard ISO parsing if needed
            const normDate = bet.date_iso.replace(' ', 'T');
            const d = new Date(normDate);
            if (!isNaN(d.getTime())) {
                // Extract YYYY-MM-DD in UTC
                dayKey = d.toISOString().split('T')[0];
            } else {
                // Fallback: simple string split if already roughly ISO
                dayKey = bet.date_iso.substring(0, 10);
            }
        } catch (e) {
            dayKey = "INVALID_DATE";
        }

        if (!betsByDay[dayKey]) betsByDay[dayKey] = [];
        betsByDay[dayKey].push(bet);
    });

    const dailyPortfolios = [];

    // 2. Process Each Day Independently
    Object.keys(betsByDay).sort().forEach(day => {
        if (day === 'INVALID_DATE' || day === 'UNKNOWN') return;

        const dayBets = betsByDay[day];
        const portfolio = processDay(day, dayBets);
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
    // A. Filter & Classify Candidates
    const candidates = {
        core: [],
        value: [],
        high_pot: []
    };

    bets.forEach(bet => {
        // Enforce EV > 0 globally (or per config)
        if (bet.ev <= 0) return;

        // Check CORE
        if (checkTier(bet, CONFIG.core)) {
            candidates.core.push(bet);
        }
        // Check VALUE
        else if (checkTier(bet, CONFIG.value)) {
            candidates.value.push(bet);
        }
        // Check HIGH POTENTIAL
        else if (checkTier(bet, CONFIG.high_pot)) {
            candidates.high_pot.push(bet);
        }
        // Else discard (Longshots / Low quality)
    });

    // B. Deduplicate Matches (Pick Best per Match)
    // Strategy: Consolidate all candidates, Group by Match, Pick Safest (Highest Probability)

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
            // Strict Tie-Breaker: P > Conf > SortScore > EV
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

    // C. Re-Distribute into Tiers (Limit & Sort)
    const selectedTiers = {
        core: [],
        value: [],
        high_pot: []
    };

    // Sort function: Prob Desc > Conf Desc > SortScore Desc
    const sorter = (a, b) => {
        if (b.p_model !== a.p_model) return b.p_model - a.p_model;
        if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;
        return b.sort_score - a.sort_score;
    };

    Object.values(bestPerMatch).forEach(bet => {
        selectedTiers[bet._tier].push(bet);
    });

    // Apply Limits
    const finalCore = selectedTiers.core.sort(sorter).slice(0, CONFIG.core.limit_count);
    const finalValue = selectedTiers.value.sort(sorter).slice(0, CONFIG.value.limit_count);
    const finalHighPot = selectedTiers.high_pot.sort(sorter).slice(0, CONFIG.high_pot.limit_count);

    // D. Generate Combos with Reuse Policy
    // Reuse Strategy:
    // If 'allow_reuse_singles' is true, we allow using matches that are in singles list.
    // However, we must ALWAYS avoid picking 2 legs from the same match in a combo.
    // And generally we want unique legs within a combo.

    // Create exclude set based on reuse policy
    const matchesUsedInSingles = new Set([
        ...finalCore,
        ...finalValue,
        ...finalHighPot
    ].map(b => b.match_id));

    // Base Pool: High quality legs from the deduped list
    // We prioritize Core and Value bets for combos
    const comboPool = Object.values(bestPerMatch).sort(sorter);

    const combos = {
        core_double: null,
        smart_double: null,
        mid_combo: null,
        debug: []
    };

    // Helper to get candidates respecting exclusion
    const getCandidates = (pool, excludeIds, maxOdds, minOdds = 0) => {
        return pool.filter(b =>
            !excludeIds.has(b.match_id) &&
            b.odds <= maxOdds &&
            b.odds >= minOdds
        );
    };

    // Determine exclusion set for combos
    let baseExclude = new Set();
    if (!CONFIG.combos.allow_reuse_singles) {
        baseExclude = new Set(matchesUsedInSingles);
    }
    // If reuse allowed, we start with empty exclude (but track usage to update)

    // 1. CORE DOUBLE (2 legs, safer)
    const coreDoubleCandidates = getCandidates(comboPool, baseExclude, CONFIG.combos.core_double.max_leg_odds);
    if (coreDoubleCandidates.length >= 2) {
        combos.core_double = {
            type: "CORE DOUBLE",
            legs: [coreDoubleCandidates[0], coreDoubleCandidates[1]],
            total_odds: parseFloat((coreDoubleCandidates[0].odds * coreDoubleCandidates[1].odds).toFixed(2))
        };
        // Mark used so Smart Double doesn't reuse the exact same legs?
        // Usually good to avoid duplicate combos.
        baseExclude.add(coreDoubleCandidates[0].match_id);
        baseExclude.add(coreDoubleCandidates[1].match_id);
    } else {
        combos.debug.push("Not enough legs for Core Double");
    }

    // 2. SMART DOUBLE (2 legs, <= 2.60)
    const smartDoubleCandidates = getCandidates(comboPool, baseExclude, CONFIG.combos.smart_double.max_leg_odds);
    if (smartDoubleCandidates.length >= 2) {
        combos.smart_double = {
            type: "SMART DOUBLE",
            legs: [smartDoubleCandidates[0], smartDoubleCandidates[1]],
            total_odds: parseFloat((smartDoubleCandidates[0].odds * smartDoubleCandidates[1].odds).toFixed(2))
        };
        baseExclude.add(smartDoubleCandidates[0].match_id);
        baseExclude.add(smartDoubleCandidates[1].match_id);
    } else {
        combos.debug.push("Not enough legs for Smart Double");
    }

    // 3. MID COMBO (2-3 legs, 3.0-5.0 total, legs 1.4-2.2)
    // Reuse policy for Mid: Limit reuse?
    // Let's use the remaining pool + maybe 1 reused leg if desperate?
    // For simplicity, stick to the cumulative exclusion set to maximize diversity
    const midCandidates = getCandidates(comboPool, baseExclude, CONFIG.combos.mid_combo.max_leg_odds, CONFIG.combos.mid_combo.min_leg_odds);

    // Prefer 3 legs for stability (Low odds legs)
    combos.mid_combo = generateMidComboRecursive(midCandidates, 3) || generateMidComboRecursive(midCandidates, 2);

    if (!combos.mid_combo) combos.debug.push("No valid Mid Combo found");

    // E. Construct Output
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

function generateMidComboRecursive(pool, targetLegs) {
    if (pool.length < targetLegs) return null;

    // Greedy Search
    const search = (index, currentCombo, currentOdds) => {
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
            const newOdds = currentOdds * nextLeg.odds;

            if (newOdds > CONFIG.combos.mid_combo.max_total) continue; // Prune

            const res = search(i + 1, [...currentCombo, nextLeg], newOdds);
            if (res) return res;
        }
        return null;
    };

    return search(0, [], 1);
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

        // Return multiple items (one per day)
        return portfolios.map(p => ({ json: p }));
    } catch (e) {
        return [{ json: { error: e.message, stack: e.stack } }];
    }
}

if (typeof module !== 'undefined') {
    module.exports = { selectDailyPortfolio };
}
