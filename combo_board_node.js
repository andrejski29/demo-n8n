/**
 * Combo Board Node (Multi-Day Portfolio Generator)
 *
 * Objective: Generate optimized combos (Safe, Balanced, Booster) across a multi-day window.
 * Logic: Inherits sanitation/dedup from Daily Picks Selector but operates on a global filtered pool.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG_MULTI = {
    // Global Filter Settings
    pool: {
        min_odds: 1.25,
        max_odds: 3.50,
        min_confidence: 58,
        min_p_model: 0.44,
        min_ev: 0.00,
    },

    // Diversity & Exposure
    reuse: {
        allow_cross_bucket_reuse: false, // Strict isolation between buckets
    },
    diversity: {
        max_same_family: 2,
        same_family_penalty: 0.97
    },

    // Bucket Definitions
    buckets: {
        safe: {
            legs_allowed: [2, 3],
            total_odds: { min: 2.00, max: 3.00 },
            leg_odds: { min: 1.30, max: 2.10 },
            p_model_min: 0.62,
            confidence_min: 70,
            ev_min: 0.01,
            max_pool_considered: 28,
            weights: { prob: 10000, conf: 100, ev: 10, odds: 1.0 }
        },
        balanced: {
            legs_allowed: [2, 3],
            total_odds: { min: 3.00, max: 5.00 },
            leg_odds: { min: 1.45, max: 2.50 },
            p_model_min: 0.54,
            confidence_min: 65,
            ev_min: 0.02,
            max_pool_considered: 35,
            weights: { prob: 10000, conf: 90, ev: 12, odds: 0.9 }
        },
        booster: {
            legs_allowed: [3, 4],
            total_odds: { min: 8.00, max: 30.00 },
            leg_odds: { min: 1.70, max: 3.20 },
            p_model_min: 0.45,
            confidence_min: 60,
            ev_min: 0.03,
            max_pool_considered: 45,
            weights: { prob: 9000, conf: 80, ev: 20, odds: 0.6 }
        }
    }
};

/**
 * Main Entry Point
 */
function generateComboBoard(allBets, windowStart, windowEnd) {
    // 1. Filter by Window & Basic Quality
    const validPool = filterAndSanitize(allBets, windowStart, windowEnd);

    // 2. Deduplicate (Best Per Match)
    const bestPerMatch = deduplicateBets(validPool);

    // 3. Global Sorted Pool
    // Sorter: P > Conf > Sort > EV > ID
    const globalPool = Object.values(bestPerMatch).sort(sorter);

    const result = {
        meta: {
            window: { start: windowStart, end: windowEnd },
            input_count: allBets.length,
            pool_size: globalPool.length
        },
        combos: {},
        debug: []
    };

    // Track used matches to prevent cross-bucket reuse
    const usedMatches = new Set();

    // 4. Generate Buckets sequentially
    const buckets = ['safe', 'balanced', 'booster'];

    buckets.forEach(type => {
        const config = CONFIG_MULTI.buckets[type];

        // Filter pool specifically for this bucket's strict criteria
        const bucketCandidates = globalPool.filter(b =>
            !usedMatches.has(b.match_id) && // Not used in previous buckets
            b.odds >= config.leg_odds.min &&
            b.odds <= config.leg_odds.max &&
            b.p_model >= config.p_model_min &&
            b.confidence_score >= config.confidence_min &&
            b.ev >= config.ev_min
        ).slice(0, config.max_pool_considered); // Optimization cap

        let bestCombo = null;

        // Try allowed leg counts (smallest first usually)
        for (const legCount of config.legs_allowed) {
            const combo = findBestCombo(bucketCandidates, legCount, config);
            if (combo) {
                // If we found a valid combo, checks if it's better than previous legCount result?
                // Usually heuristic: simpler (fewer legs) is better if it meets criteria.
                // Or compare scores.
                if (!bestCombo || combo.score > bestCombo.score) {
                    bestCombo = combo;
                }
            }
        }

        if (bestCombo) {
            result.combos[type] = {
                type: type.toUpperCase(),
                legs: bestCombo.legs,
                total_odds: bestCombo.total_odds,
                score: bestCombo.score // Useful for internal verification
            };

            // Mark used
            bestCombo.legs.forEach(l => usedMatches.add(l.match_id));
        } else {
            result.debug.push(`No ${type} combo found (Pool: ${bucketCandidates.length})`);
        }
    });

    // Cleanup internal scores
    Object.values(result.combos).forEach(c => delete c.score);

    return result;
}

// ============================================================================
// LOGIC HELPERS
// ============================================================================

function filterAndSanitize(bets, startStr, endStr) {
    return bets.map(sanitizeBet).filter(b => {
        if (!b) return false;

        // Date Check
        if (!b.date_iso) return false;
        const day = b.date_iso.substring(0, 10);
        if (day < startStr || day > endStr) return false;

        // Base Pool Config
        if (b.odds < CONFIG_MULTI.pool.min_odds || b.odds > CONFIG_MULTI.pool.max_odds) return false;
        if (b.p_model < CONFIG_MULTI.pool.min_p_model) return false;
        if (b.confidence_score < CONFIG_MULTI.pool.min_confidence) return false;
        if (b.ev < CONFIG_MULTI.pool.min_ev) return false;

        return true;
    });
}

function deduplicateBets(bets) {
    const best = {};
    bets.forEach(b => {
        const existing = best[b.match_id];
        if (!existing) {
            best[b.match_id] = b;
        } else {
            // Tie-breaker: P > Conf > Sort > EV
            if (b.p_model > existing.p_model) best[b.match_id] = b;
            else if (b.p_model === existing.p_model) {
                if (b.confidence_score > existing.confidence_score) best[b.match_id] = b;
                else if (b.confidence_score === existing.confidence_score) {
                    if (b.sort_score > existing.sort_score) best[b.match_id] = b;
                    else if (b.sort_score === existing.sort_score) {
                        if (b.ev > existing.ev) best[b.match_id] = b;
                    }
                }
            }
        }
    });
    return best;
}

function sanitizeBet(bet) {
    if (!bet.match_id) return null;
    const clean = { ...bet };

    clean.odds = parseFloat(bet.odds) || 0;
    if (clean.odds <= 1.0) return null;

    clean.p_model = parseFloat(bet.p_model) || 0;
    clean.confidence_score = parseFloat(bet.confidence_score) || 0;
    clean.ev = parseFloat(bet.ev) || 0;

    return clean;
}

const sorter = (a, b) => {
    if (b.p_model !== a.p_model) return b.p_model - a.p_model;
    if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;
    if (b.sort_score !== a.sort_score) return b.sort_score - a.sort_score;
    if (b.ev !== a.ev) return b.ev - a.ev;
    return (a.match_id || 0) - (b.match_id || 0);
};

/**
 * Recursive Combo Finder
 * Maximizes Score: (Prob * Diversity) + Quality
 */
function findBestCombo(pool, targetLegs, config) {
    let best = null;
    const maxSameFamily = CONFIG_MULTI.diversity.max_same_family;

    const search = (index, currentLegs, currentOdds, familyCounts) => {
        // Base Case: Full Combo
        if (currentLegs.length === targetLegs) {
            if (currentOdds >= config.total_odds.min && currentOdds <= config.total_odds.max) {
                const score = calculateScore(currentLegs, currentOdds, config.weights);
                if (!best || score > best.score) {
                    best = {
                        legs: [...currentLegs],
                        total_odds: parseFloat(currentOdds.toFixed(2)),
                        score: score
                    };
                }
            }
            return;
        }

        // Optimization: Don't scan entire pool if deep
        const limit = Math.min(pool.length, index + 15);

        for (let i = index; i < limit; i++) {
            const leg = pool[i];
            const newOdds = currentOdds * leg.odds;

            // Pruning: Odds too high?
            if (newOdds > config.total_odds.max) continue;

            // Diversity Check
            const fam = leg.market_family || "unknown";
            const currentFamCount = familyCounts[fam] || 0;
            if (currentFamCount >= maxSameFamily) continue;

            // Recurse
            const nextFamilyCounts = { ...familyCounts, [fam]: currentFamCount + 1 };
            search(i + 1, [...currentLegs, leg], newOdds, nextFamilyCounts);
        }
    };

    search(0, [], 1, {});
    return best;
}

function calculateScore(legs, totalOdds, weights) {
    let pairProb = 1;
    let minConf = 100;
    let sumEV = 0;
    let sameFamilyCount = 0;

    // Calculate metrics
    legs.forEach(l => {
        pairProb *= l.p_model;
        if (l.confidence_score < minConf) minConf = l.confidence_score;
        sumEV += l.ev;
    });

    // Diversity Penalty Calculation
    const families = legs.map(l => l.market_family);
    const uniqueFamilies = new Set(families).size;
    // If fewer unique families than legs, we have overlap
    if (uniqueFamilies < legs.length) {
        // Apply penalty for each overlap
        const overlaps = legs.length - uniqueFamilies;
        for(let k=0; k<overlaps; k++) {
            pairProb *= CONFIG_MULTI.diversity.same_family_penalty;
        }
    }

    // Weighted Score Formula
    return (pairProb * weights.prob) +
           (minConf * weights.conf) +
           (sumEV * weights.ev) -
           (totalOdds * weights.odds);
}

// ============================================================================
// EXPORT / N8N WRAPPER
// ============================================================================
if (typeof items !== 'undefined' && Array.isArray(items)) {
    try {
        let input = [];
        let windowStart = new Date().toISOString().substring(0, 10);
        let windowEnd = windowStart;

        // Parse Inputs
        // Expecting either items[0].json with 'data' and 'config'
        // OR standard items list where we might use n8n node parameters (not available here directly)
        // Let's assume input items ARE the bets, and we get window from items[0].json.window if present

        if (items.length > 0 && items[0].json && items[0].json.bets && Array.isArray(items[0].json.bets)) {
            // Mode: Wrapper object
            input = items[0].json.bets;
            if (items[0].json.window) {
                windowStart = items[0].json.window.start || windowStart;
                windowEnd = items[0].json.window.end || windowEnd;
            }
        } else {
            // Mode: Flat list
            input = items.map(i => i.json);
            // Default window: Look at data range or Today?
            // For safety, require window injection or scan all.
            // Let's scan all if not provided (sets window to min/max of data)
            const dates = input.map(b => b.date_iso).filter(d => d).sort();
            if (dates.length > 0) {
                windowStart = dates[0].substring(0, 10);
                windowEnd = dates[dates.length - 1].substring(0, 10);
            }
        }

        const board = generateComboBoard(input, windowStart, windowEnd);
        return [{ json: board }];

    } catch (e) {
        return [{ json: { error: e.message, stack: e.stack } }];
    }
}

if (typeof module !== 'undefined') {
    module.exports = { generateComboBoard };
}
