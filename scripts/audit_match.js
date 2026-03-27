const fs = require('fs');
const engine = require('./probability_engine.js');

const normalizeCode = fs.readFileSync('normalize_match_record.js', 'utf8');
const runNormalizer = new Function('item', '$input', normalizeCode);

const rawData = JSON.parse(fs.readFileSync('test_fixtures/base_test.json', 'utf8'));

try {
    const item = { json: rawData[0] };
    const normResult = runNormalizer(item, { item });
    const normInput = normResult[0].json;

    // Run Engine to get full output
    const output = engine.runEngine(normInput);

    console.log("--- Match Diagnostic ---");
    console.log(`Match: ${normInput.teams.home.name} vs ${normInput.teams.away.name}`);
    console.log(`Table: Home #${normInput.team_stats.home.team_meta.table_position} vs Away #${normInput.team_stats.away.team_meta.table_position}`);

    console.log("\n--- Inputs (Context) ---");
    console.log(JSON.stringify(normInput.context, null, 2));

    console.log("\n--- Calculated Lambdas ---");
    console.log(JSON.stringify(output.overview.lambdas, null, 2));

    console.log("\n--- Model Probabilities (1X2) ---");
    console.log(`Home Win: ${output.overview.probs.home_win}`);
    // Draw/Away not explicitly in overview probs summary, but in picks.
    // Let's find 1X2 picks
    const homePick = output.all_value_bets.find(p => p.market === '1X2' && p.selection === 'home');
    const drawPick = output.all_value_bets.find(p => p.market === '1X2' && p.selection === 'draw');
    const awayPick = output.all_value_bets.find(p => p.market === '1X2' && p.selection === 'away');

    if (homePick) console.log(`P_Model(Home): ${homePick.p_model} | P_Market(Implied): ${homePick.p_market}`);
    if (drawPick) console.log(`P_Model(Draw): ${drawPick.p_model} | P_Market(Implied): ${drawPick.p_market}`);
    if (awayPick) console.log(`P_Model(Away): ${awayPick.p_model} | P_Market(Implied): ${awayPick.p_market}`);

    // Check Discrepancy
    if (awayPick) {
        const diff = Math.abs(awayPick.p_model - awayPick.p_market);
        console.log(`\nDiscrepancy (Away): ${(diff*100).toFixed(1)}%`);
    }

} catch (e) {
    console.error(e);
}
