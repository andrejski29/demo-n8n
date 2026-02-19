const { selectDailyPortfolio, CONFIG } = require('./daily_picks_selector');

// Mock Data
const bets = [
    // --- RANKING TEST CASES ---
    // Match 1: High Prob, Low EV (The "Safe" trap)
    { match_id: "m1", home_team_id: "t1", away_team_id: "t2", date_iso: "2023-10-27",
      odds: 1.65, p_model: 0.65, ev: 0.07, confidence_score: 75, market_family: "win" },

    // Match 2: Lower Prob, High EV (The "Value" gem)
    { match_id: "m2", home_team_id: "t3", away_team_id: "t4", date_iso: "2023-10-27",
      odds: 2.10, p_model: 0.55, ev: 0.15, confidence_score: 70, market_family: "win" },

    // Match 3: Filler
    { match_id: "m3", home_team_id: "t5", away_team_id: "t6", date_iso: "2023-10-27",
      odds: 1.80, p_model: 0.60, ev: 0.08, confidence_score: 72, market_family: "goals" },

    // --- EXPOSURE TEST CASES ---
    // Match 4: Involves Team T1 (Same as Match 1)
    { match_id: "m4", home_team_id: "t1", away_team_id: "t7", date_iso: "2023-10-27",
      odds: 1.90, p_model: 0.58, ev: 0.10, confidence_score: 68, market_family: "goals" },
];

function runTest() {
    console.log("Starting Daily Selection Tests (Ranking V2 & Exposure)...");

    // 1. Ranking V2 Test
    // In Value Tier (AlphaScore): Match 2 (EV 0.15) should beat Match 1 (EV 0.07), despite lower Prob.
    // Let's force strict limits to see who survives if space is tight.
    // Actually, both likely make it if limit is 5.
    // Let's inspect the sort order directly in the output.

    const result = selectDailyPortfolio(bets)[0];
    const valuePicks = result.value_singles;

    console.log("Value Picks Order:", valuePicks.map(b => `${b.match_id} (EV:${b.ev}, P:${b.p_model})`));

    // Check if m2 comes before m1?
    // AlphaScore m2 approx: 15*2 + 55*1 + 7.0 = 30 + 55 + 7 = 92
    // AlphaScore m1 approx: 7*2 + 65*1 + 7.5 = 14 + 65 + 7.5 = 86.5
    // So m2 should rank higher than m1.
    if (valuePicks[0].match_id === "m2") {
        console.log("Test 1 Pass: High EV bet (m2) ranked #1 via AlphaScore.");
    } else {
        console.error("Test 1 Fail: High EV bet did not rank #1.");
    }

    // 2. Exposure Test
    // Match 1 uses Team T1. Match 4 also uses Team T1.
    // Only one should be selected across the portfolio.
    // Match 1 is Core (P 0.65 > 0.62) or Value?
    // It fits Core criteria (P>0.62, Odds<2.00).
    // Match 4 fits Value criteria (P 0.58, Odds 1.90).
    // Logic: Core selected first. Match 1 takes T1 slot.
    // Match 4 should be blocked when Value selection runs.

    const allSelectedIds = [
        ...result.core_singles.map(b => b.match_id),
        ...result.value_singles.map(b => b.match_id),
        ...result.high_potential_singles.map(b => b.match_id)
    ];

    const hasM1 = allSelectedIds.includes("m1");
    const hasM4 = allSelectedIds.includes("m4");

    if (hasM1 && !hasM4) {
        console.log("Test 2 Pass: Exposure Guard blocked m4 (Collision on Team T1).");
    } else if (hasM1 && hasM4) {
        console.error("Test 2 Fail: Both m1 and m4 selected (Exposure leak).");
    } else {
        console.warn(`Test 2 Partial: m1 selected? ${hasM1}, m4 selected? ${hasM4}`);
    }

    // 3. Rejection Log
    if (result.meta.rejection_log.length > 0) {
        console.log("Test 3 Pass: Rejection log active.", result.meta.rejection_log[0]);
    } else {
        console.error("Test 3 Fail: No rejection log found.");
    }
}

runTest();
