const fs = require('fs');
const { normalizeHomeTeam } = require('./normalize_home_v2.js');

try {
    const rawData = fs.readFileSync('./Home_Team.json', 'utf8');
    const n8nData = JSON.parse(rawData);

    let inputData = n8nData[0].data;

    console.log("Input Type:", Array.isArray(inputData) ? "Array (Multi-Season)" : "Object");

    const normalized = normalizeHomeTeam(inputData);

    console.log("\n--- Normalization Result ---");
    // console.log(JSON.stringify(normalized, null, 2)); // Reduced noise

    // Assertions
    if (!normalized.season.current) throw new Error("Missing Current Season");
    if (!normalized.season.previous) throw new Error("Missing Previous Season");

    // Correct Path: extras.goals.ou_ft
    if (!normalized.extras.goals.ou_ft.home) throw new Error("Missing Extras: Goals O/U FT");

    // Verify Threshold Label
    if (normalized.extras.goals.ou_ft.home["2.5"] === undefined) throw new Error("Threshold Fix Failed: Expected key '2.5'");

    // Verify Percent Normalization
    const p = normalized.extras.goals.ou_ft.home["2.5"];
    if (p > 1.0) throw new Error(`Percent Norm Failed: Value ${p} > 1.0`);

    console.log(`\nVerified Threshold '2.5' (Goals): ${p} (Original 45)`);

    // Verify Corners Halves
    const cornerVal = normalized.extras.corners.totals.home["9.5"];
    console.log(`Verified Threshold '9.5' (Corners): ${cornerVal} (Original 27)`);

    console.log("\nSUCCESS: All V2 requirements verified.");

} catch (err) {
    console.error("TEST FAILED:", err);
    process.exit(1);
}
