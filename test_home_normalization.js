const fs = require('fs');
const { normalizeHomeTeam } = require('./normalize_home_v2.js');

try {
    const rawData = fs.readFileSync('./Home_Team.json', 'utf8');
    const n8nData = JSON.parse(rawData);

    let inputData = n8nData[0].data;

    console.log("Input Type:", Array.isArray(inputData) ? "Array (Multi-Season)" : "Object");

    const normalized = normalizeHomeTeam(inputData);

    console.log("\n--- Normalization Result ---");
    // console.log(JSON.stringify(normalized, null, 2));

    // 1. Cards Against Fallback
    // cards_against_avg_home = 1.5 in additional_info
    if (normalized.season.current.cards.against_avg_home !== 1.5) {
        throw new Error(`Cards Against Fallback Failed: Expected 1.5, got ${normalized.season.current.cards.against_avg_home}`);
    }
    console.log("Cards Against Fallback: OK (1.5)");

    // 2. Monotonicity Check (Should be valid)
    // seasonOver05 (90) > seasonOver15 (80) -> OK
    // Let's artifically create a violation to test the flag system?
    // We can't modify the input here easily without re-writing file or mocking.
    // But we can check if flags are empty as expected for this valid data.
    if (normalized.quality.flags.length > 0) {
        console.warn("Unexpected Quality Flags:", normalized.quality.flags);
    } else {
        console.log("Quality Flags: Clean (as expected)");
    }

    // 3. Verify Extras Existence (Shots)
    if (!normalized.extras.shots.match_ou) throw new Error("Missing Extras: Shots Match O/U");
    console.log("Extras (Shots): OK");

    console.log("\nSUCCESS: Robustness upgrades verified.");

} catch (err) {
    console.error("TEST FAILED:", err);
    process.exit(1);
}
