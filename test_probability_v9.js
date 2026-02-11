const fs = require('fs');
const { runEngine } = require('./probability_engine.js');

const rawData = fs.readFileSync('./reference_match.json', 'utf8');
const matchData = JSON.parse(rawData)[0];

console.log("--- Running Probability Engine V9 Test ---");

try {
    const result = runEngine(matchData);

    console.log(`Match: ${result.overview.teams.home.name} vs ${result.overview.teams.away.name}`);
    console.log(`Lambdas: G(H${result.overview.lambdas.goals.home} A${result.overview.lambdas.goals.away}) | C(H${result.overview.lambdas.corners.home} A${result.overview.lambdas.corners.away})`);

    console.log("\n--- Top Picks (Strict Diversity) ---");
    result.top_picks.forEach(p => {
        console.log(`[${p.category.toUpperCase()}] ${p.market} - ${p.selection}: EV +${(p.ev*100).toFixed(1)}%, Kelly ${(p.kelly*100).toFixed(1)}%`);
    });

    console.log("\n--- Comparison ---");
    const categories = result.top_picks.map(p => p.category);
    const uniqueCats = new Set(categories);
    console.log(`Categories: ${categories.join(', ')}`);
    console.log(`Unique: ${uniqueCats.size} / ${categories.length}`);
    
    // Check Devig on Double Chance
    const dcBets = result.all_value_bets.filter(p => p.market === "Double Chance");
    if (dcBets.length > 0) {
        const dc = dcBets[0];
        const implied = 1 / dc.odds;
        if (Math.abs(dc.p_market - implied) < 0.0001) {
            console.log(`PASS: Double Chance (${dc.selection}) skipped devigging (Implied ${implied.toFixed(3)} == Market ${dc.p_market.toFixed(3)})`);
        } else {
             console.log(`FAIL: Double Chance was devigged!`);
        }
    }

} catch (e) {
    console.error("CRASH:", e);
}
