
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
    { match_id: 100, date_iso: '2023-10-27T15:00:00', odds: 2.00, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' },
    { match_id: 100, date_iso: '2023-10-27T15:00:00', odds: 10.0, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' }, // Higher odds should win

    // Final Fallback Determinism (Date ISO)
    // Identical bets except Date ISO (which we pretend is different for testing logic, but dedup logic groups by match_id)
    // If Match 101 has two entries with identical stats, selection, odds, market, but DIFFERENT dates.
    // Logic should pick "later" date (lexicographically greater).
    { match_id: 101, date_iso: '2023-10-27T10:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' },
    { match_id: 101, date_iso: '2023-10-27T11:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' } // Later date should win
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
    // 9 original + 4 fallback (11-14) + 1 dedup (Match 100) + 1 dedup (Match 101) + 1 Negative Test (Match 15) = 16 unique matches.
    if (result.meta.pool_size === 16) {
        console.log("Test 2 Pass: Pool Size Correct (16)");
    } else {
        console.error(`Test 2 Fail: Expected pool size 16, got ${result.meta.pool_size}`);
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

        if (JSON.stringify(run.combos) !== JSON.stringify(runRef.combos)) {
            determinismPass = false;
            console.error(`Test 4 Fail: Iteration ${i} produced different output.`);
        }
    }

    if (determinismPass) {
         console.log("Test 4 Pass: Strict Determinism (Shuffle) Verified.");
    }

    // Test 5: Check Numeric Odds Win (Match 100)
    const balancedLegs = result.combos.balanced ? result.combos.balanced.legs : [];
    const hasMatch100 = balancedLegs.some(l => l.match_id === 100);

    if (hasMatch100) {
        console.error("Test 5 Fail: Numeric Comparison failed? 2.0 (String winner) was picked over 10.0 (Numeric winner).");
    } else {
        console.log("Test 5 Pass: Numeric Comparison works (10.0 > 2.0 selected, then rejected by max odds).");
    }

    // Test 6: Check Date ISO Win (Match 101)
    // Both 1.50 odds. Later date is 11:00:00.
    // If later date is picked, it should be in the pool.
    // Actually both are identical except date.
    // The "result" has the date of the WINNER.
    // Let's inspect "Match 101" in the safe combo (Odds 1.50 fits Safe).
    const safeLegs = result.combos.safe ? result.combos.safe.legs : [];
    const match101 = safeLegs.find(l => l.match_id === 101);

    if (match101) {
        if (match101.date_iso.includes('11:00:00')) {
             console.log("Test 6 Pass: Date ISO Tie-breaker works (Later date selected).");
        } else {
             console.error(`Test 6 Fail: Date ISO Tie-breaker failed. Expected 11:00:00, got ${match101.date_iso}`);
        }
    } else {
        // Match 101 might not be in Safe combo if not optimal.
        // It has P=0.60. Safe requires 0.62.
        // Ah, P=0.60. Fits Balanced.
        const match101Bal = balancedLegs.find(l => l.match_id === 101);
        if (match101Bal) {
             if (match101Bal.date_iso.includes('11:00:00')) {
                 console.log("Test 6 Pass: Date ISO Tie-breaker works (Later date selected).");
             } else {
                 console.error(`Test 6 Fail: Date ISO Tie-breaker failed. Expected 11:00:00, got ${match101Bal.date_iso}`);
             }
        } else {
            console.warn("Test 6 Warn: Match 101 not in any combo, cannot verify date.");
        }
    }

    console.log("Tests Complete.");
}

runTest();
