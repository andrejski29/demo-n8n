const fs = require('fs');
const { normalizeHomeTeam } = require('./normalize_home_v2.js');

try {
    const rawData = fs.readFileSync('./Home_Team.json', 'utf8');
    const n8nData = JSON.parse(rawData);

    let inputData = n8nData[0].data;

    const normalized = normalizeHomeTeam(inputData);

    console.log("\n--- Normalization Result ---");
    // console.log(JSON.stringify(normalized, null, 2));

    // 1. Form Parsing
    // "wwl" -> 3+3+0 = 6
    if (normalized.form.last5 !== 6) {
        throw new Error(`Form Parsing Failed: Expected 6, got ${normalized.form.last5}`);
    }
    console.log("Form Parsing: OK (6)");

    // 2. Threshold Fallback (Shots)
    // num=5, recorded=10 -> 0.5
    // Key: team_shots_over -> 3.5 -> "3.5"
    // extras.shots.on_target_ou.home["3.5"]
    const shotVal = normalized.extras.shots.on_target_ou.home["3.5"];
    if (shotVal !== 0.5) {
        throw new Error(`Threshold Fallback Failed: Expected 0.5, got ${shotVal}`);
    }
    console.log("Threshold Fallback: OK (0.5)");

    // 3. Null Handling
    // Missing key should be null
    const missingVal = normalized.extras.goals.ou_ft.home["5.5"]; // Not in mock
    if (missingVal !== null) {
        throw new Error(`Null Handling Failed: Expected null, got ${missingVal}`);
    }
    console.log("Null Handling: OK (null)");

    console.log("\nSUCCESS: All Robustness Fixes Verified.");

} catch (err) {
    console.error("TEST FAILED:", err);
    process.exit(1);
}
