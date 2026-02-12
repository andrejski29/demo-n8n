
const { generateComboBoard, CONFIG_MULTI } = require('./combo_board_node');

// Mock Data
const bets = [
    // Safe Candidates
    { match_id: 1, date_iso: '2023-10-27T15:00:00', odds: 1.40, p_model: 0.70, confidence_score: 80, ev: 0.05, market_family: 'result_1x2', market: '1x2' },
    { match_id: 2, date_iso: '2023-10-27T16:00:00', odds: 1.50, p_model: 0.68, confidence_score: 75, ev: 0.04, market_family: 'goals_ou', market: 'Over 2.5' },

    // Banned Markets (Corners, Cards) - Should be filtered in FR mode
    { match_id: 3, date_iso: '2023-10-27T17:00:00', odds: 1.45, p_model: 0.69, confidence_score: 78, ev: 0.06, market_family: 'corners_ou', market: 'Corners Over 9.5' },
    { match_id: 6, date_iso: '2023-10-28T17:00:00', odds: 2.10, p_model: 0.56, confidence_score: 66, ev: 0.10, market_family: 'cards_total', market: 'Cards Over 3.5' },
    { match_id: 20, date_iso: '2023-10-27T18:00:00', odds: 1.90, p_model: 0.60, confidence_score: 70, ev: 0.05, market: 'Player To Be Booked', category: 'bookings' }, // "book" keyword

    // Balanced Candidates
    { match_id: 4, date_iso: '2023-10-28T15:00:00', odds: 1.80, p_model: 0.60, confidence_score: 70, ev: 0.08, market_family: 'result_1x2', market: '1x2' },
    { match_id: 5, date_iso: '2023-10-28T16:00:00', odds: 1.90, p_model: 0.58, confidence_score: 68, ev: 0.09, market_family: 'goals_btts', market: 'BTTS Yes' },

    // Booster Candidates (Re-added)
    { match_id: 7, date_iso: '2023-10-29T15:00:00', odds: 2.80, p_model: 0.48, confidence_score: 62, ev: 0.12, market_family: 'result_1x2', market: '1x2' },
    { match_id: 8, date_iso: '2023-10-29T16:00:00', odds: 3.00, p_model: 0.46, confidence_score: 61, ev: 0.15, market_family: 'goals_ou', market: 'Over 3.5' },
    { match_id: 9, date_iso: '2023-10-29T17:00:00', odds: 2.90, p_model: 0.47, confidence_score: 63, ev: 0.14, market_family: 'defense_cs', market: 'Clean Sheet' },

    // Tie-Breaker (Match 100)
    { match_id: 100, date_iso: '2023-10-27T15:00:00', odds: 2.00, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' },
    { match_id: 100, date_iso: '2023-10-27T15:00:00', odds: 10.0, p_model: 0.60, confidence_score: 60, ev: 0.05, market: 'Winner A', selection: 'Team A' } // Higher odds wins
];

function runTest() {
    console.log("Starting Combo Board Node Tests (v1.3 FR Market Filtering)...");

    // Enable FR Mode
    CONFIG_MULTI.market.country = 'FR';

    // Test 1: FR Market Filtering
    // Bets: 1,2 (Safe), 3 (Banned), 6 (Banned), 20 (Banned), 4,5 (Bal), 7,8,9 (Boost), 100 (2->1 dedup).
    // Total Valid Unique for FR: 1, 2, 4, 5, 7, 8, 9, 100.
    // Count: 8.
    // Banned: 3, 6, 20.

    const resultFR = generateComboBoard(bets, '2023-10-27', '2023-10-30');
    if (resultFR.meta.pool_size === 8) {
        console.log("Test 1 Pass: FR Filtering Correct (Pool Size 8).");
    } else {
        console.error(`Test 1 Fail: Expected 8, got ${resultFR.meta.pool_size}`);
    }

    // Test 2: Global Mode (Disable FR)
    CONFIG_MULTI.market.country = 'GLOBAL';
    const resultGlobal = generateComboBoard(bets, '2023-10-27', '2023-10-30');
    // Expected: 8 + 3 (banned) = 11 unique matches.
    if (resultGlobal.meta.pool_size === 11) {
        console.log("Test 2 Pass: Global Mode Correct (Pool Size 11).");
    } else {
        console.error(`Test 2 Fail: Expected 11, got ${resultGlobal.meta.pool_size}`);
    }

    // Test 3: Determinism (Shuffle + FR)
    // Ensure determinism holds even with filtering
    CONFIG_MULTI.market.country = 'FR';
    let determinismPass = true;
    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    for (let i = 0; i < 20; i++) {
        const run = generateComboBoard(shuffle([...bets]), '2023-10-27', '2023-10-30');
        // Compare with resultFR
        if (JSON.stringify(run.combos) !== JSON.stringify(resultFR.combos)) {
            determinismPass = false;
            console.error(`Test 3 Fail: Iteration ${i} produced different output.`);
        }
    }

    if (determinismPass) {
         console.log("Test 3 Pass: Strict Determinism (FR Mode) Verified.");
    }

    console.log("Tests Complete.");
}

runTest();
