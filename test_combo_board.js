
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

    // Booster Candidates (Lower Prob, High Odds) - Re-added for full coverage
    { match_id: 7, date_iso: '2023-10-29T15:00:00', odds: 2.80, p_model: 0.48, confidence_score: 62, ev: 0.12, market_family: 'result_1x2', market: '1x2' },
    { match_id: 8, date_iso: '2023-10-29T16:00:00', odds: 3.00, p_model: 0.46, confidence_score: 61, ev: 0.15, market_family: 'goals_ou', market: 'Over 3.5' },
    { match_id: 9, date_iso: '2023-10-29T17:00:00', odds: 2.90, p_model: 0.47, confidence_score: 63, ev: 0.14, market_family: 'defense_cs', market: 'Clean Sheet' },

    // Market Family Fallback Test Cases (Updated v1.3 Final Hardened)
    { match_id: 11, date_iso: '2023-10-27T18:00:00', odds: 1.60, p_model: 0.65, confidence_score: 70, ev: 0.05, market: 'Asian Handicap -1.5' }, // 'goals_ah'
    { match_id: 12, date_iso: '2023-10-27T19:00:00', odds: 1.70, p_model: 0.65, confidence_score: 70, ev: 0.05, market: 'DC 1X' }, // 'result_dc' (Regex \bdc\b)
    { match_id: 13, date_iso: '2023-10-27T20:00:00', odds: 1.80, p_model: 0.65, confidence_score: 70, ev: 0.05, market: 'TT Over 1.5' }, // 'goals_team' (Regex \btt\b)
    { match_id: 14, date_iso: '2023-10-27T21:00:00', odds: 1.75, p_model: 0.65, confidence_score: 70, ev: 0.05, market: 'Draw No Bet' }, // 'result_dnb' (New Split)

    // Regex Negative Tests (Should Default)
    { match_id: 15, date_iso: '2023-10-27T22:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Battery' }, // Should NOT match \btt\b

    // Determinism Tie-Breaker Candidates (Same Match ID, Same Stats)
    // Numeric Comparison Test Case
    // "10.0" vs "2.0". String("10.0") < String("2.0").
    // If logic is String based, "2.0" wins (if we seek >). But 10.0 is better.
    // If logic is Numeric based, 10.0 wins (10.0 > 2.0).
    { match_id: 100, date_iso: '2023-10-27T15:00:00', odds: 2.00, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' },
    { match_id: 100, date_iso: '2023-10-27T15:00:00', odds: 10.0, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' } // Higher odds should win
];

function runTest() {
    console.log("Starting Combo Board Node Tests (v1.3 Final Strict)...");

    // Test 0: Input Validation
    const invalidInput = generateComboBoard("Not Array", '2023-10-27', '2023-10-30');
    if (invalidInput.error === "Input must be an array of bets.") console.log("Test 0 Pass: Input Validation OK");
    else console.error("Test 0 Fail: Input Validation missed non-array");

    // Test 1: Basic Generation
    const result = generateComboBoard(bets, '2023-10-27', '2023-10-30');
    if (result.error) console.error("Test 1 Fail:", result.error);
    else console.log("Test 1 Pass: Structure OK");

    // Test 2: Pool Size Logic
    if (result.meta.pool_size === 15) {
        console.log("Test 2 Pass: Pool Size Correct (15)");
    } else {
        console.error(`Test 2 Fail: Expected pool size 15, got ${result.meta.pool_size}`);
    }

    // Test 3: Search Diagnostics
    const failResult = generateComboBoard(bets.slice(0, 1), '2023-10-27', '2023-10-30');
    const stats = failResult.debug[0]?.search_stats;
    if (stats && stats.pruned_too_high !== undefined && stats.leaf_out_of_range !== undefined) {
        console.log("Test 3 Pass: New Diagnostics (pruned_too_high, leaf_out_of_range) Present");
    } else {
        console.error("Test 3 Fail: Missing new search_stats keys", stats);
    }

    // Test 4: Determinism (Strict Numeric Shuffle)
    let determinismPass = true;
    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    for (let i = 0; i < 20; i++) {
        const run = generateComboBoard(shuffle([...bets]), '2023-10-27', '2023-10-30');
        const runRef = generateComboBoard(bets, '2023-10-27', '2023-10-30');

        // Check equality
        if (JSON.stringify(run.combos) !== JSON.stringify(runRef.combos)) {
            determinismPass = false;
            console.error(`Test 4 Fail: Iteration ${i} produced different output.`);
        }
    }

    if (determinismPass) {
         console.log("Test 4 Pass: Strict Determinism (Shuffle) Verified.");
    }

    // Test 5: Check Numeric Odds Win (Match 100)
    // We can't see the pool, but we can verify if the chosen bet for Match 100 made it into a combo.
    // Match 100: P=0.60. Fits 'Balanced' (Min P 0.54) but Odds 10.0 fits 'Booster' (Min Odds 8.0? No, min odds leg 1.70).
    // Odds 10.0 is very high for a single leg.
    // Booster Leg Odds Max: 3.20.
    // So 10.0 will be filtered out by 'Booster' leg filter!
    // 2.00 will be filtered out by 'Booster' Min P 0.45? Yes.
    // 2.00 fits 'Safe' (Max 2.10)? P=0.60 < 0.62. No.
    // 2.00 fits 'Balanced' (Max 2.50)? P=0.60 > 0.54. Yes.
    // So if 2.00 is chosen, it enters Balanced pool.
    // If 10.0 is chosen, it enters Balanced pool? 10.0 > 2.50 Max leg odds. No.
    // So if 10.0 is chosen, Match 100 DISAPPEARS from Balanced!
    // If 2.00 is chosen, Match 100 APPEARS in Balanced candidates.
    // Therefore, if our logic prefers 10.0 (Numeric), Match 100 effectively vanishes from usable pool.
    // If our logic was string ("2.0" > "10.0"?), then 2.0 would be chosen and used.

    // Let's verify which one happened.
    // If Match 100 is in Balanced combo, then 2.0 was picked (String sort wins or logic flawed).
    // If Match 100 is NOT in Balanced combo (and pool has space), then 10.0 was picked (Numeric wins).

    // Actually, "2.0" > "10.0". String compare says "2" > "1". So "2.0" is greater.
    // So String compare would ALSO pick 2.0!
    // Wait. "10.0" vs "2.0". '1' < '2'. So "10.0" < "2.0".
    // If logic is `if (b.odds > existing.odds)`, and we want MAX.
    // "2.0" > "10.0" is true. So String logic picks 2.0.
    // Numeric logic picks 10.0.

    // So:
    // String Logic -> Picks 2.0 -> Fits Balanced -> Appears in Combo.
    // Numeric Logic -> Picks 10.0 -> Fails Max Odds -> Disappears.

    // Let's check Balanced Combo legs.
    const balancedLegs = result.combos.balanced ? result.combos.balanced.legs : [];
    const hasMatch100 = balancedLegs.some(l => l.match_id === 100);

    if (hasMatch100) {
        console.warn("Test 5 Info: Match 100 found in Balanced. This means Odds 2.0 was selected.");
        console.warn("   -> Since 2.0 < 10.0 numerically, this implies logic might be wrong OR 10.0 was invalid?");
        console.warn("   -> Wait, deduplicate happens BEFORE bucket filtering.");
        console.warn("   -> So dedup picks best. If dedup picks 10.0, it is passed to buckets.");
        console.warn("   -> Balanced bucket sees 10.0, rejects it (Max 2.50). Match 100 dead.");
        console.warn("   -> If dedup picks 2.0, Balanced sees 2.0, accepts it. Match 100 alive.");
        console.warn("   -> RESULT: Match 100 is present.");
        console.error("Test 5 Fail: Numeric Comparison failed? 2.0 (String winner) was picked over 10.0 (Numeric winner).");
    } else {
        console.log("Test 5 Pass: Match 100 NOT found in Balanced.");
        console.log("   -> Implies 10.0 (Numeric winner) was picked by Dedup, then rejected by Bucket Filters.");
        console.log("   -> Numeric Comparison works (10.0 > 2.0).");
    }

    console.log("Tests Complete.");
}

runTest();
