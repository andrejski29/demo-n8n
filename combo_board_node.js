/**
 * Combo Board Node (v1.1 - Hardening & Reliability)
 *
 * Changelog v1.1:
 * - Sanitation: Added `sort_score` parsing.
 * - Logic: Added Market Family fallback and deterministic Dedup.
 * - Input: Strict Window Validation (Start/End required).
 * - Optimization: Configurable search depth per bucket.
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
            search_depth: 15,
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
            search_depth: 15,
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
            search_depth: 25, // Deeper search for booster
            weights: { prob: 9000, conf: 80, ev: 20, odds: 0.6 }
        }
    }
};

/**
 * Main Entry Point
 */
function generateComboBoard(allBets, windowStart, windowEnd) {
    // 0. Strict Window Validation
    if (!windowStart || !windowEnd) {
        return { error: "Window Start and End dates are required (YYYY-MM-DD)." };
    }
    if (windowStart > windowEnd) {
        return { error: `Invalid Window: Start (${windowStart}) is after End (${windowEnd})` };
    }

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
                // score removed for clean output
            };

            // Mark used
            bestCombo.legs.forEach(l => usedMatches.add(l.match_id));
        } else {
            result.debug.push(`No ${type} combo found (Pool: ${bucketCandidates.length})`);
        }
    });

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
            // Tie-breaker: P > Conf > Sort > EV > ID (Deterministic)
            if (b.p_model > existing.p_model) best[b.match_id] = b;
            else if (b.p_model === existing.p_model) {
                if (b.confidence_score > existing.confidence_score) best[b.match_id] = b;
                else if (b.confidence_score === existing.confidence_score) {
                    if (b.sort_score > existing.sort_score) best[b.match_id] = b;
                    else if (b.sort_score === existing.sort_score) {
                        if (b.ev > existing.ev) best[b.match_id] = b;
                        else if (b.ev === existing.ev) {
                            if (b.match_id > existing.match_id) best[b.match_id] = b;
                        }
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

    // Parse Numerics
    clean.odds = parseFloat(bet.odds) || 0;
    if (clean.odds <= 1.0) return null;

    clean.p_model = parseFloat(bet.p_model) || 0;
    clean.confidence_score = parseFloat(bet.confidence_score) || 0;
    clean.sort_score = parseFloat(bet.sort_score) || 0; // Added parsing
    clean.ev = parseFloat(bet.ev) || 0;

    // Market Family Fallback
    if (!clean.market_family || clean.market_family === 'unknown') {
        clean.market_family = deriveMarketFamily(clean);
    }

    return clean;
}

function deriveMarketFamily(bet) {
    const m = (bet.market || "").toLowerCase();
    const c = (bet.category || "").toLowerCase();

    if (m.includes('corner') || c.includes('corner')) return 'corners_ou'; // simplified
    if (m.includes('card') || c.includes('card') || c.includes('book')) return 'cards_total';
    if (m.includes('btts') || m.includes('both teams')) return 'goals_btts';
    if (m.includes('over') || m.includes('under')) return 'goals_ou';
    if (m.includes('1x2') || m.includes('winner')) return 'result_1x2';
    if (m.includes('clean sheet')) return 'defense_cs';

    return 'default';
}

const sorter = (a, b) => {
    if (b.p_model !== a.p_model) return b.p_model - a.p_model;
    if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;
    if (b.sort_score !== a.sort_score) return b.sort_score - a.sort_score;
    if (b.ev !== a.ev) return b.ev - a.ev;
    return (a.match_id || 0) - (b.match_id || 0); // Deterministic Tie-Breaker
};

/**
 * Recursive Combo Finder
 * Maximizes Score: (Prob * Diversity) + Quality
 */
function findBestCombo(pool, targetLegs, config) {
    let best = null;
    const maxSameFamily = CONFIG_MULTI.diversity.max_same_family;
    const searchDepth = config.search_depth || 15;

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

        // Optimization: Configurable Search Depth
        const limit = Math.min(pool.length, index + searchDepth);

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
        let windowStart = null;
        let windowEnd = null;

        // Parse Inputs: Detect wrapper vs flat list
        if (items.length > 0 && items[0].json && items[0].json.bets && Array.isArray(items[0].json.bets)) {
            // Wrapper Object Mode
            input = items[0].json.bets;
            if (items[0].json.window) {
                windowStart = items[0].json.window.start;
                windowEnd = items[0].json.window.end;
            }
        } else {
            // Flat List Mode: Require window params via some mechanism or fail
            // Actually, spec prefers explicit window config.
            // If n8n node parameters are available, we'd use them.
            // Assuming for now inputs might carry 'window' property?
            // Fallback: If no window provided, return error as per requirement 4
            // But to be helpful in dev, we can scan if not provided?
            // "I prefer Option A strictly: require window.start and window.end" -> Fail if missing

            // NOTE: In n8n 'Function', params are usually in 'items', or hardcoded.
            // We will return Error if undefined.

            // Check if first item has config metadata?
            if (items[0].json.window_start && items[0].json.window_end) {
                 windowStart = items[0].json.window_start;
                 windowEnd = items[0].json.window_end;
                 input = items.map(i => i.json);
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
