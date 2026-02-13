const fs = require('fs');
const { runEngine } = require('./probability_engine.js');

const rawData = fs.readFileSync('./reference_match.json', 'utf8');
const matchData = JSON.parse(rawData)[0];

console.log("--- Running Probability Engine V10 Test ---");

try {
    const config = { min_ev: 0.02 };
    const result = runEngine(matchData, config);

    console.log(`Match: ${result.overview.teams.home.name} vs ${result.overview.teams.away.name}`);
    console.log(`Warnings: ${result.overview.engine_warnings.length > 0 ? result.overview.engine_warnings : "None"}`);

    console.log("\n--- Audit Check: Corners O/U 10.5 ---");
    // Find Corners O/U 10.5 Under pick
    const cornerPick = result.all_value_bets.find(p => p.market === "Corners O/U 10.5" && p.selection === "under");

    if (cornerPick) {
        console.log(`Found Pick: ${cornerPick.market} ${cornerPick.selection}`);
        console.log(`Odds: ${cornerPick.odds}`);
        console.log(`Devig Applied: ${cornerPick.devig_applied}`);
        console.log(`P_Market Source: ${cornerPick.p_market_source}`);
        console.log(`P_Market Value: ${cornerPick.p_market}`);

        // Implied = 1/1.7 = 0.588. If Devig Applied, P_Market < 0.588
        const implied = 1 / 1.7;
        if (cornerPick.p_market < implied) {
            console.log("PASS: Corners O/U Devigged (Fair < Implied)");
        } else {
             console.log("FAIL: Corners O/U NOT Devigged (Fair >= Implied)");
        }
    } else {
        console.log("FAIL: Corners O/U 10.5 Under not found in value bets.");
    }

    console.log("\n--- Top Picks (Filtered min_ev > 0.02) ---");
    result.top_picks.forEach(p => {
         console.log(`[${p.category}] ${p.market}: EV ${(p.ev*100).toFixed(1)}%`);
    });

} catch (e) {
    console.error("CRASH:", e);
}
