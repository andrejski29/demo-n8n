const fs = require('fs');
const { normalizeHomeTeam } = require('./normalize_home_v2.js');

try {
    const rawData = fs.readFileSync('./Home_Team.json', 'utf8');
    const n8nData = JSON.parse(rawData);

    // Simulate n8n loop processing: passing the `data` array
    let inputData = n8nData[0].data;

    console.log("Input Type:", Array.isArray(inputData) ? "Array (Multi-Season)" : "Object");

    const normalized = normalizeHomeTeam(inputData);

    console.log("\n--- Normalization Result ---");
    console.log(JSON.stringify(normalized, null, 2));

    // 1. Season Selection
    if (!normalized.season.current) throw new Error("Missing Current Season");
    if (!normalized.season.previous) throw new Error("Missing Previous Season");
    console.log("Season Selection: OK (Current + Previous found)");

    // 2. Threshold Fix
    // In mock data, I have 'over95CornersPercentage_home'.
    // Wait, the mock data I wrote has `over95CornersPercentage_home: 27`.
    // The key in `extras.corners.totals.home` should be "9.5", NOT "95" or "9.5".
    // My code maps `over` + `95` + `CornersPercentage`.
    // The lines array in code is `['65', ..., '95', '105']`.
    // So for '105', it should be '10.5'.

    // Let's check `over95CornersPercentage_home` mapping.
    // Code: `out.home[label] = ...`. Label for '95' -> '9.5'.

    const cornerThresh = normalized.extras.corners.totals.home;
    if (cornerThresh["9.5"] === undefined) throw new Error("Threshold Fix Failed: Key '9.5' missing");
    if (cornerThresh["10.5"] === undefined) throw new Error("Threshold Fix Failed: Key '10.5' missing");
    console.log("Threshold Labels: OK (9.5, 10.5)");

    // 3. Percent Normalization
    // Mock: `over95CornersPercentage_home: 27` -> Should be 0.27
    if (cornerThresh["9.5"] > 1.0) throw new Error(`Percent Norm Failed: Value ${cornerThresh["9.5"]} > 1.0`);
    console.log("Percent Normalization: OK (Values <= 1.0)");

    // 4. Extras
    if (!normalized.extras.goal_timing.scored.home) throw new Error("Missing Goal Timing Extras");
    console.log("Extras Structure: OK");

    console.log("\nSUCCESS: All V2 requirements verified.");

} catch (err) {
    console.error("TEST FAILED:", err);
    process.exit(1);
}
