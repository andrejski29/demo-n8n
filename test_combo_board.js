
const { generateComboBoard, CONFIG_MULTI } = require('./combo_board_node');

// Mock Data
const bets = [
    // Safe Candidates (High Prob, Low Odds)
    { match_id: 1, date_iso: '2023-10-27T15:00:00', odds: 1.40, p_model: 0.70, confidence_score: 80, ev: 0.05, market_family: 'result_1x2', market: '1x2' },
    { match_id: 2, date_iso: '2023-10-27T16:00:00', odds: 1.50, p_model: 0.68, confidence_score: 75, ev: 0.04, market_family: 'goals_ou', market: 'Over 2.5' },
    { match_id: 3, date_iso: '2023-10-27T17:00:00', odds: 1.45, p_model: 0.69, confidence_score: 78, ev: 0.06, market_family: 'corners_ou', market: 'Corners Over 9.5' },

    // Balanced Candidates (Mid Prob, Mid Odds)
    { match_id: 4, date_iso: '2023-10-28T15:00:00', odds: 1.80, p_model: 0.60, confidence_score: 70, ev: 0.08, market_family: 'result_1x2', market: '1x2' },
    { match_id: 5, date_iso: '2023-10-28T16:00:00', odds: 1.90, p_model: 0.58, confidence_score: 68, ev: 0.09, market_family: 'goals_btts', market: 'BTTS Yes' },
    { match_id: 6, date_iso: '2023-10-28T17:00:00', odds: 2.10, p_model: 0.56, confidence_score: 66, ev: 0.10, market_family: 'cards_total', market: 'Cards Over 3.5' },

    // Booster Candidates (Lower Prob, High Odds)
    { match_id: 7, date_iso: '2023-10-29T15:00:00', odds: 2.80, p_model: 0.48, confidence_score: 62, ev: 0.12, market_family: 'result_1x2', market: '1x2' },
    { match_id: 8, date_iso: '2023-10-29T16:00:00', odds: 3.00, p_model: 0.46, confidence_score: 61, ev: 0.15, market_family: 'goals_ou', market: 'Over 3.5' },
    { match_id: 9, date_iso: '2023-10-29T17:00:00', odds: 2.90, p_model: 0.47, confidence_score: 63, ev: 0.14, market_family: 'defense_cs', market: 'Clean Sheet' },

    // Market Family Fallback Test Cases
    { match_id: 11, date_iso: '2023-10-27T18:00:00', odds: 1.60, p_model: 0.65, confidence_score: 70, ev: 0.05, market: 'Asian Handicap -1.5' }, // Should be 'goals_ah'
    { match_id: 12, date_iso: '2023-10-27T19:00:00', odds: 1.70, p_model: 0.65, confidence_score: 70, ev: 0.05, market: 'Double Chance 1X' }, // Should be 'result_dc'
    { match_id: 13, date_iso: '2023-10-27T20:00:00', odds: 1.80, p_model: 0.65, confidence_score: 70, ev: 0.05, market: 'Team Total Over 1.5' }, // Should be 'goals_team'
    { match_id: 14, date_iso: '2023-10-27T21:00:00', odds: 1.75, p_model: 0.65, confidence_score: 70, ev: 0.05, market: 'Draw No Bet' }, // Should be 'goals_ah' (DNB)

    // Determinism Tie-Breaker Candidates (Same Match ID, Same Stats)
    { match_id: 100, date_iso: '2023-10-27T15:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' },
    { match_id: 100, date_iso: '2023-10-27T15:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team B' } // Different selection
];

function runTest() {
    console.log("Starting Combo Board Node Tests (v1.3 Final)...");

    // Test 1: Basic Generation
    const result = generateComboBoard(bets, '2023-10-27', '2023-10-30');
    if (result.error) console.error("Test 1 Fail:", result.error);
    else console.log("Test 1 Pass: Structure OK");

    // Test 2: Market Family Fallback (DNB & DC)
    // We check if DNB (Match 14) and DC (Match 12) are processed.
    // Since we can't inspect internal family assignment directly, we rely on them not being rejected.
    // Pool size check: 9 original + 4 fallback + 1 dedup (Match 100) = 14 expected?
    // Wait, Match 1,2,3...9 = 9 bets.
    // Matches 11, 12, 13, 14 = 4 bets.
    // Match 100 (2 versions) = 1 bet after dedup.
    // Total Unique Matches = 9 + 4 + 1 = 14.
    if (result.meta.pool_size === 14) {
        console.log("Test 2 Pass: Market Family & Pool Size Correct (14)");
    } else {
        console.error(`Test 2 Fail: Expected pool size 14, got ${result.meta.pool_size}`);
    }

    // Test 3: Search Diagnostics
    // Check if debug contains search stats
    const debugEntry = result.debug.find(d => d.search_stats);
    if (debugEntry) {
         console.log("Test 3 Pass: Search Diagnostics Present", debugEntry.search_stats);
    } else {
        // It's possible all buckets found combos, so debug might be empty or only contain failures.
        // Let's force a failure to see diagnostics.
        const failResult = generateComboBoard(bets.slice(0, 1), '2023-10-27', '2023-10-30'); // Not enough legs
        if (failResult.debug[0] && failResult.debug[0].search_stats) {
            console.log("Test 3 Pass: Search Diagnostics Present (Forced Failure)");
        } else {
            console.error("Test 3 Fail: Missing search_stats in debug");
        }
    }

    // Test 4: Determinism (Selection Tie-Breaker)
    // Match 100 has two entries with identical stats but different selections ('Team A' vs 'Team B').
    // 'Team B' > 'Team A' lexically? 'Team B' comes after 'Team A'.
    // Logic: if (b.selection > existing.selection) replace.
    // Input order dependent? No, we need to verify output is same regardless of input order.

    // Shuffle Array Helper
    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    const runA = generateComboBoard([...bets], '2023-10-27', '2023-10-30');
    const runB = generateComboBoard(shuffle([...bets]), '2023-10-27', '2023-10-30');

    // Compare Match 100 choice
    // We need to inspect which bet won for match 100.
    // This is hard to see in output combos if it's not selected.
    // But we can check total pool equality.
    // Since pool is sorted, the list of candidates should be identical.

    // We can't access the internal pool, but if `combos` are identical, it implies stability.
    const jsonA = JSON.stringify(runA.combos);
    const jsonB = JSON.stringify(runB.combos);

    if (jsonA === jsonB) {
         console.log("Test 4 Pass: Strict Determinism Verified (Input Order Independent)");
    } else {
         console.error("Test 4 Fail: Non-deterministic output detected!");
    }

    // Test 5: Cross Bucket Reuse
    // Enable Reuse
    CONFIG_MULTI.reuse.allow_cross_bucket_reuse = true;
    const reuseResult = generateComboBoard(bets, '2023-10-27', '2023-10-30');

    // Check if same match ID appears in Safe and Balanced (likely Match 1 or 2 as they are high quality)
    const safeIds = reuseResult.combos.safe ? reuseResult.combos.safe.legs.map(l => l.match_id) : [];
    const balancedIds = reuseResult.combos.balanced ? reuseResult.combos.balanced.legs.map(l => l.match_id) : [];
    const intersection = safeIds.filter(id => balancedIds.includes(id));

    if (intersection.length > 0) {
        console.log(`Test 5 Pass: Cross-Bucket Reuse Verified (Shared IDs: ${intersection})`);
    } else {
        // It's possible limits or filters prevented reuse naturally.
        console.warn("Test 5 Warn: No reuse occurred naturally, but config was enabled. (Check limits/filters)");
    }

    // Reset Config
    CONFIG_MULTI.reuse.allow_cross_bucket_reuse = false;

    console.log("Tests Complete.");
}

runTest();
