const fs = require('fs');
const { normalizeHomeTeam } = require('./normalize_home_v2.js');

try {
    const rawData = fs.readFileSync('./Home_Team.json', 'utf8');
    const n8nData = JSON.parse(rawData);

    // Simulate n8n loop processing
    let inputData = n8nData[0].data; // Passing the ARRAY directly as per new logic

    console.log("Input Type:", Array.isArray(inputData) ? "Array (Multi-Season)" : "Object");

    const normalized = normalizeHomeTeam(inputData);

    console.log("\n--- Normalization Result ---");
    console.log(JSON.stringify(normalized, null, 2));

    // Assertions
    if (!normalized.season.current) throw new Error("Missing Current Season");
    if (!normalized.season.previous) throw new Error("Missing Previous Season");
    if (!normalized.extras.goals_ou.home["2.5"]) throw new Error("Missing Extras: Goals O/U");
    if (!normalized.extras.second_half.goals.scored_avg_home) throw new Error("Missing Extras: 2H Stats");

    console.log("\nSUCCESS: Multi-season and Extras extracted correctly.");

} catch (err) {
    console.error("TEST FAILED:", err);
    process.exit(1);
}
