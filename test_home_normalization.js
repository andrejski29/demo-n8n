const fs = require('fs');
const { normalizeHomeTeam } = require('./normalize_home_v2.js');

// Mock Data Loading
try {
    const rawData = fs.readFileSync('./Home_Team.json', 'utf8');
    const n8nData = JSON.parse(rawData);

    // 1. Unwrap n8n Structure
    // The user provided file is [ { success: true, data: [...] } ]
    // Standard n8n is [ { json: { ... } } ]
    // We need to handle both for robust testing.

    let inputItem = n8nData[0];
    let apiResponse = inputItem.json || inputItem;

    // 2. Simulate n8n Wrapper Logic (Partial) or Direct Function Call
    // We want to test if normalizeHomeTeam handles the un-wrapped object?
    // actually normalizeHomeTeam expects the TEAM OBJECT.
    // The unwrapping logic is currently inside the n8n execution block in the file, NOT in the exported function.
    // So for this test script to work with the exported function, WE must unwrap it here,
    // mimicking what the n8n block does.

    let teamObj = apiResponse;

    if (teamObj.data && Array.isArray(teamObj.data) && !teamObj.id) {
        console.log("Detected API Wrapper. Extracting first team...");
        teamObj = teamObj.data[0];
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
