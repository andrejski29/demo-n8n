const fs = require('fs');
const { normalizeHomeTeam } = require('./normalize_home_v2.js');

// Mock Data Loading
try {
    const rawData = fs.readFileSync('./Home_Team.json', 'utf8');
    const n8nData = JSON.parse(rawData);

    // 1. Unwrap n8n Structure
    // n8n output is [ { json: { ... } }, ... ]
    let apiResponse = n8nData[0].json;

    // 2. Unwrap FootyStats API Structure
    // API response is { data: [ teamObj1, teamObj2 ... ], ... }
    // We want the first team object (usually current season or specific query)
    let teamObj = null;
    if (apiResponse.data && Array.isArray(apiResponse.data)) {
        teamObj = apiResponse.data[0];
    } else {
        // Fallback if structure is different
        teamObj = apiResponse;
    }

    if (!teamObj || !teamObj.id) {
        console.error("Could not extract valid team object from JSON.");
        console.log("Keys available:", Object.keys(apiResponse));
        process.exit(1);
    }

    console.log(`Testing with Team: ${teamObj.name} (ID: ${teamObj.id})`);

    // Run Normalization
    const normalized = normalizeHomeTeam(teamObj);

    // Output Check
    console.log("Normalization Result:");
    console.log(JSON.stringify(normalized, null, 2));

    // Basic Assertions
    if (!normalized) throw new Error("Result is null");
    if (!normalized.quality) throw new Error("Missing Quality");

    // Check specific fields
    console.log("\n--- Integrity Checks ---");
    console.log("Quality:", normalized.quality.reliability);
    console.log("Goals Home O2.5:", normalized.rates.goals_home.o25 + "%");
    console.log("Derived Expected Goals (Home):", normalized.derived.goals_total_mu_home);

    console.log("\nSUCCESS: Normalization logic verified locally.");

} catch (err) {
    console.error("TEST FAILED:", err);
    process.exit(1);
}
