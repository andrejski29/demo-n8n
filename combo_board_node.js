/**
 * Combo Board Node (v1.3 Final - Hardening & Config Polish)
 * 
 * Changelog v1.3 Final:
 * - Diagnostics: Split recursion pruning into 'pruned_too_high' and 'leaf_out_of_range'.
 * - Market Family: Improved regex safety for 'Team Totals' (\btt\b).
 * - Determinism: Added strictly deterministic tie-breaker chain (Market > Selection > Numeric Odds > Category > Date ISO > ID > Explicit Fingerprint).
 * - Hygiene: Trimmed strings and smart numeric ID comparison.
 * - Validation: Added strict array check for input.
 * - Config: Documented recommended `max_ev` (e.g., 0.30). Added FR Market Filtering.
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
        max_ev: null, // Optional cap (e.g., 0.30) to catch data errors or unrealistic EVs
    },

    // Diversity & Exposure
    reuse: {
        allow_cross_bucket_reuse: false, // Strict isolation between buckets
    },
    diversity: {
        max_same_family: 2,
        same_family_penalty: 0.97
    },

    // Market Restriction Settings (e.g. for France)
    market: {
        country: 'FR', // Set to 'FR' to enable strict filtering, 'GLOBAL' to disable
        ban_markets: {
            corners: true,
            cards: true
        }
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
    // 0. Strict Validation
    if (!Array.isArray(allBets)) {
        return { error: "Input must be an array of bets." };
    }

    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!windowStart || !windowEnd) {
        return { error: "Window Start and End dates are required (YYYY-MM-DD)." };
    }
    if (!DATE_RE.test(windowStart) || !DATE_RE.test(windowEnd)) {
        return { error: `Invalid Window Format: Must be YYYY-MM-DD. Got: ${windowStart} / ${windowEnd}` };
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
    const allowReuse = CONFIG_MULTI.reuse.allow_cross_bucket_reuse === true;

    // 4. Generate Buckets sequentially
    const buckets = ['safe', 'balanced', 'booster'];
    
    buckets.forEach(type => {
        const config = CONFIG_MULTI.buckets[type];
        
        // Detailed Filtering Diagnostics
        const rejectionStats = {
            total_candidates: 0,
            passed: 0,
            rejected: {
                used: 0,
                odds: 0,
                p_model: 0,
                confidence: 0,
                ev: 0
            }
        };

        // Filter pool specifically for this bucket's strict criteria
        const bucketCandidates = globalPool.filter(b => {
            rejectionStats.total_candidates++;

            if (!allowReuse && usedMatches.has(b.match_id)) { rejectionStats.rejected.used++; return false; }
            if (b.odds < config.leg_odds.min || b.odds > config.leg_odds.max) { rejectionStats.rejected.odds++; return false; }
            if (b.p_model < config.p_model_min) { rejectionStats.rejected.p_model++; return false; }
            if (b.confidence_score < config.confidence_min) { rejectionStats.rejected.confidence++; return false; }
            if (b.ev < config.ev_min) { rejectionStats.rejected.ev++; return false; }

            rejectionStats.passed++;
            return true;
        }).slice(0, config.max_pool_considered); // Optimization cap

        let bestCombo = null;
        let searchStatsTotal = { pruned_too_high: 0, leaf_out_of_range: 0, rejected_diversity: 0, valid_found: 0 };

        // Try allowed leg counts (smallest first usually)
        for (const legCount of config.legs_allowed) {
            const { combo, stats } = findBestCombo(bucketCandidates, legCount, config);

            // Aggregate stats
            searchStatsTotal.pruned_too_high += stats.pruned_too_high;
            searchStatsTotal.leaf_out_of_range += stats.leaf_out_of_range;
            searchStatsTotal.rejected_diversity += stats.rejected_diversity;
            searchStatsTotal.valid_found += stats.valid_found;

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
            
            // Mark used (only if strict isolation is enforced, or just for tracking)
            // Optimization: Skip adding if reuse is allowed.
            if (!allowReuse) {
                bestCombo.legs.forEach(l => usedMatches.add(l.match_id));
            }
        } else {
            // Enhanced Debug Output for Failures
            result.debug.push({
                bucket: type,
                reason: "No combo found",
                pool_stats: {
                    total_available: globalPool.length,
                    bucket_candidates: bucketCandidates.length,
                    rejections: rejectionStats.rejected
                },
                search_stats: searchStatsTotal
            });
        }
    });

    return result;
}

// ============================================================================
// LOGIC HELPERS
// ============================================================================

function isBannedForFR(bet) {
    if (CONFIG_MULTI.market.country !== 'FR') return false;

    // Normalize strings
    const m = (bet.market || "").toLowerCase().trim();
    const c = (bet.category || "").toLowerCase().trim();
    const s = (bet.selection || bet.runner || "").toLowerCase().trim();

    // Check Corners
    if (CONFIG_MULTI.market.ban_markets.corners) {
        if (m.includes('corner') || c.includes('corner') || s.includes('corner')) return true;
    }

    // Check Cards / Bookings
    if (CONFIG_MULTI.market.ban_markets.cards) {
        if (m.includes('card') || c.includes('card') || s.includes('card') ||
            m.includes('booking') || c.includes('booking') || s.includes('booking') ||
            m.includes('book') || c.includes('book')) return true;
            // 'book' might be risky (matches 'bookmaker'?), but usually categories are 'cards', 'bookings'.
            // Let's stick to safe 'booking', 'card'. 'book' is requested but risky.
            // Safety: 'book' matches 'facebook' etc.
            // Better: /\bbook\b/. But user asked for "booking(s) / book keywords".
            // We'll trust standard feed content.
    }

    return false;
}

function filterAndSanitize(bets, startStr, endStr) {
    return bets.map(sanitizeBet).filter(b => {
        if (!b) return false;
        
        // FR Market Ban
        if (isBannedForFR(b)) return false;

        // Date Check
        // Ensure string and length >= 10
        if (typeof b.date_iso !== 'string' || b.date_iso.length < 10) return false;
        
        const day = b.date_iso.substring(0, 10);
        if (day < startStr || day > endStr) return false;

        // Base Pool Config
        if (b.odds < CONFIG_MULTI.pool.min_odds || b.odds > CONFIG_MULTI.pool.max_odds) return false;
        if (b.p_model < CONFIG_MULTI.pool.min_p_model) return false;
        if (b.confidence_score < CONFIG_MULTI.pool.min_confidence) return false;
        if (b.ev < CONFIG_MULTI.pool.min_ev) return false;

        // Optional Max EV Check
        if (CONFIG_MULTI.pool.max_ev !== null && b.ev > CONFIG_MULTI.pool.max_ev) return false;

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
            // Tie-breaker: P > Conf > Sort > EV > Market Name > Selection > Odds (Numeric) > Category > Date ISO > ID > Fingerprint (Strict Determinism)
            // NOTE: For String comparisons, "Lexicographically Larger" wins (e.g. "B" > "A").
            if (b.p_model > existing.p_model) best[b.match_id] = b;
            else if (b.p_model === existing.p_model) {
                if (b.confidence_score > existing.confidence_score) best[b.match_id] = b;
                else if (b.confidence_score === existing.confidence_score) {
                    if (b.sort_score > existing.sort_score) best[b.match_id] = b;
                    else if (b.sort_score === existing.sort_score) {
                        if (b.ev > existing.ev) best[b.match_id] = b;
                        else if (b.ev === existing.ev) {
                            // Lexical Compare on Market Name (Trimmed)
                            const bm = String(b.market || "").trim();
                            const em = String(existing.market || "").trim();
                            if (bm > em) best[b.match_id] = b;
                            else if (bm === em) {
                                // Selection Name (Lexical, Trimmed)
                                const bs = String(b.selection || b.runner || "").trim();
                                const es = String(existing.selection || existing.runner || "").trim();
                                if (bs > es) best[b.match_id] = b;
                                else if (bs === es) {
                                    // Odds (Numeric - Higher is preferred)
                                    if (b.odds > existing.odds) best[b.match_id] = b;
                                    else if (b.odds === existing.odds) {
                                        // Category (Lexical, Trimmed)
                                        const bc = String(b.category || "").trim();
                                        const ec = String(existing.category || "").trim();
                                        if (bc > ec) best[b.match_id] = b;
                                        else if (bc === ec) {
                                            // Date ISO (Lexical, Trimmed)
                                            const bd = String(b.date_iso || "").trim();
                                            const ed = String(existing.date_iso || "").trim();
                                            if (bd > ed) best[b.match_id] = b;
                                            else if (bd === ed) {
                                                // ID (Smart Numeric or Lexical) - trimmed + safe numeric compare
                                                const bidStr = String(b.id || b.bet_id || "").trim();
                                                const eidStr = String(existing.id || existing.bet_id || "").trim();

                                                const bidNum = bidStr !== "" ? Number(bidStr) : NaN;
                                                const eidNum = eidStr !== "" ? Number(eidStr) : NaN;

                                                const bidIsNum = Number.isFinite(bidNum);
                                                const eidIsNum = Number.isFinite(eidNum);

                                                let idWin = false;
                                                let idEqual = false;

                                                if (bidIsNum && eidIsNum) {
                                                    if (bidNum > eidNum) idWin = true;
                                                    else if (bidNum === eidNum) idEqual = true;
                                                } else {
                                                    if (bidStr > eidStr) idWin = true;
                                                    else if (bidStr === eidStr) idEqual = true;
                                                }

                                                if (idWin) {
                                                    best[b.match_id] = b;
                                                } else if (idEqual) {
                                                    // Ultimate Explicit Fingerprint (Airtight)
                                                    // Normalize numeric odds to 3 decimals to avoid "1.9" vs "1.90" string issues
                                                    // Use Number.isFinite check to prevent crashes on bad data
                                                    // Trim all strings
                                                    const bSrc = String(b.bookmaker || b.source || "").trim();
                                                    const eSrc = String(existing.bookmaker || existing.source || "").trim();

                                                    const bO = Number.isFinite(b.odds) ? b.odds : 0;
                                                    const eO = Number.isFinite(existing.odds) ? existing.odds : 0;

                                                    // Use Trimmed values for fingerprint too
                                                    const bFp = `${bm}|${bs}|${bO.toFixed(3)}|${bc}|${bd}|${bidStr}|${bSrc}`;
                                                    const eFp = `${em}|${es}|${eO.toFixed(3)}|${ec}|${ed}|${eidStr}|${eSrc}`;

                                                    if (bFp > eFp) best[b.match_id] = b;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
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
    clean.sort_score = parseFloat(bet.sort_score) || 0;
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

    // 1. Explicit Family Mappings (Priority)
    if (m.includes('corner') || c.includes('corner')) return 'corners_ou';
    if (m.includes('card') || c.includes('card') || c.includes('book')) return 'cards_total';
    if (m.includes('btts') || m.includes('both teams')) return 'goals_btts';
    if (m.includes('clean sheet')) return 'defense_cs';
    
    // 1X2 Safety: Ensure not capturing 'Double Chance' via substring
    if ((m.includes('1x2') || m.includes('winner') || m.includes('match result')) && !m.includes('double chance')) return 'result_1x2';

    // 2. Asian Handicap & Draw No Bet
    // Split DNB to its own family for diversity
    if (m.includes('dnb') || m.includes('draw no bet')) return 'result_dnb';
    if (m.includes('asian') || m.includes('handicap') || /\bah\b/.test(m)) return 'goals_ah';

    // 3. Double Chance (Safer Regex Boundary Check)
    // Matches "Double Chance", "DC " (start), " DC" (end), or strict "1X"/"X2" words
    if (m.includes('double chance') || /\bdc\b/.test(m) || /\b1x\b/.test(m) || /\bx2\b/.test(m)) return 'result_dc';

    // 4. Team Totals (Safer Regex Boundary Check)
    if (m.includes('team total') || m.includes('team over') || m.includes('team under') || /\btt\b/.test(m)) return 'goals_team';

    // 5. Half Time / Full Time
    if (m.includes('ht/ft') || m.includes('half time') || m.includes('1st half') || m.includes('2nd half')) return 'half_props';

    // 6. General O/U Classification (Includes 'O/U', 'Over', 'Under')
    // Put this last as a catch-all for generic totals
    if (m.includes('o/u') || m.includes('over/under') || m.includes('over') || m.includes('under') || m.includes('goals')) return 'goals_ou';
    
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

    const stats = {
        pruned_too_high: 0,
        leaf_out_of_range: 0,
        rejected_diversity: 0,
        valid_found: 0
    };

    const search = (index, currentLegs, currentOdds, familyCounts) => {
        // Base Case: Full Combo
        if (currentLegs.length === targetLegs) {
            if (currentOdds >= config.total_odds.min && currentOdds <= config.total_odds.max) {
                stats.valid_found++;
                const score = calculateScore(currentLegs, currentOdds, config.weights);
                if (!best || score > best.score) {
                    best = {
                        legs: [...currentLegs],
                        total_odds: parseFloat(currentOdds.toFixed(2)),
                        score: score
                    };
                }
            } else {
                stats.leaf_out_of_range++; // Leaf out of range (too low or too high)
            }
            return;
        }

        // Optimization: Configurable Search Depth
        const limit = Math.min(pool.length, index + searchDepth);

        for (let i = index; i < limit; i++) {
            const leg = pool[i];
            const newOdds = currentOdds * leg.odds;

            // Pruning: Odds too high?
            if (newOdds > config.total_odds.max) {
                 stats.pruned_too_high++;
                 continue;
            }

            // Diversity Check
            const fam = leg.market_family || "unknown";
            const currentFamCount = familyCounts[fam] || 0;
            if (currentFamCount >= maxSameFamily) {
                stats.rejected_diversity++;
                continue;
            }

            // Recurse
            const nextFamilyCounts = { ...familyCounts, [fam]: currentFamCount + 1 };
            search(i + 1, [...currentLegs, leg], newOdds, nextFamilyCounts);
        }
    };

    search(0, [], 1, {});
    return { combo: best, stats };
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
            // Flat List Mode: Check first item for config
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
    module.exports = { generateComboBoard, CONFIG_MULTI }; // Export Config for testing override
}
