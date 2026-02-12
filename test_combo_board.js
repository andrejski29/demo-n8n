
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
    { match_id: 101, date_iso: '2023-10-27T10:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' },
    { match_id: 101, date_iso: '2023-10-27T11:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' }, // Later date should win

    // Ultimate Fingerprint Determinism (Identical except hidden 'source')
    { match_id: 102, date_iso: '2023-10-27T12:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A', source: 'BookA' },
    { match_id: 102, date_iso: '2023-10-27T12:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A', source: 'BookB' }, // "BookB" > "BookA"

    // String Hygiene Test (Trimming)
    { match_id: 103, date_iso: '2023-10-27T12:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A ', selection: 'Team A' }, // "Winner A "
    { match_id: 103, date_iso: '2023-10-27T12:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' },  // "Winner A"
    // After trimming, these are identical. So dedup should merge them.
    // If NOT trimmed, "Winner A " > "Winner A". So "Winner A " would win (lexical).
    // If trimmed, they are equal. Fallback tie-breakers run.
    // Since everything else equal, order decides (keep first).

    // Numeric ID Test
    { match_id: 104, id: "9", date_iso: '2023-10-27T12:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05 },
    { match_id: 104, id: "10", date_iso: '2023-10-27T12:00:00', odds: 1.50, p_model: 0.60, confidence_score: 60, ev: 0.05 },
    // Numeric sort: 10 > 9. ID "10" wins.
    // Lexical sort: "9" > "10". ID "9" wins.
    // We expect "10" to win if numeric sort works.
];

function runTest() {
    console.log("Starting Combo Board Node Tests (v1.3 Final Hygiene)...");

    // Test 0: Input Validation
    const invalidInput = generateComboBoard("Not Array", '2023-10-27', '2023-10-30');
    if (invalidInput.error === "Input must be an array of bets.") console.log("Test 0 Pass: Input Validation OK");
    else console.error("Test 0 Fail: Input Validation missed non-array");

    // Test 1: Basic Generation
    const result = generateComboBoard(bets, '2023-10-27', '2023-10-30');
    if (result.error) console.error("Test 1 Fail:", result.error);
    else console.log("Test 1 Pass: Structure OK");

    // Test 2: Pool Size Logic
    // 9 original + 4 fallback (11-14) + 3 dedup (100, 101, 102) + 1 dedup (103) + 1 dedup (104) + 1 Negative (15) = 19 unique matches.
    if (result.meta.pool_size === 19) {
        console.log("Test 2 Pass: Pool Size Correct (19)");
    } else {
        console.error(`Test 2 Fail: Expected pool size 19, got ${result.meta.pool_size}`);
    }

    // Test 3: Search Diagnostics
    const failResult = generateComboBoard(bets.slice(0, 1), '2023-10-27', '2023-10-30');
    const stats = failResult.debug[0]?.search_stats;
    if (stats && stats.pruned_too_high !== undefined && stats.leaf_out_of_range !== undefined) {
        console.log("Test 3 Pass: New Diagnostics (pruned_too_high, leaf_out_of_range) Present");
    } else {
        console.error("Test 3 Fail: Missing new search_stats keys", stats);
    }

    // Test 4: Determinism (Strict Numeric Shuffle + Fingerprint + Hygiene)
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
         console.log("Test 4 Pass: Strict Determinism (Shuffle + Fingerprint + Hygiene) Verified.");
    }

    // Test 8: Numeric ID Sort (Match 104)
    // Both fit Balanced (P=0.60).
    // If ID "10" wins (Numeric), it is used.
    // If ID "9" wins (Lexical), it is used.
    // We can't see the ID in the output combo easily (match_id is 104 for both).
    // But we can check internal logic via deduction? No.
    // However, if Determinism Pass holds, the choice is STABLE.
    // To know WHICH one won, we'd need to inspect the 'id' field of the chosen bet.
    // The output `result.combos` contains `legs`. Each leg is the FULL bet object.
    // So we can inspect `leg.id`.

    const balLegs = result.combos.balanced ? result.combos.balanced.legs : [];
    const match104 = balLegs.find(l => l.match_id === 104);

    if (match104) {
        if (match104.id === "10") {
            console.log("Test 8 Pass: Numeric ID Comparison works ('10' > '9').");
        } else {
            console.warn(`Test 8 Warn: Lexical ID Comparison active ('9' > '10')? Got ID: ${match104.id}`);
            // Note: If code prefers "9", then numeric parse failed or logic is lexical.
        }
    } else {
        console.warn("Test 8 Warn: Match 104 not in balanced combo, cannot verify ID.");
    }

    console.log("Tests Complete.");
}

runTest();
