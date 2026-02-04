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

    // 1. Core Fallback (from additional_info)
    // cardsTotalAVG_home was in additional_info.
    // It maps to cards.total_avg_home in Core.
    if (normalized.season.current.cards.total_avg_home !== 3.5) {
        throw new Error(`Core Fallback Failed: Expected 3.5, got ${normalized.season.current.cards.total_avg_home}`);
    }
    console.log("Core Fallback: OK (3.5)");

    // 2. Corner Halves Labels
    // corners_fh_over4_percentage_home -> "4.5"
    if (normalized.extras.corners.halves.fh.ou.home["4.5"] === undefined) {
        throw new Error("Corner Halves Label Failed: Expected key '4.5'");
    }
    console.log("Corner Halves Labels: OK (4.5)");

    // 3. Form Parsing
    // "wwldw" -> 3+3+0+1+3 = 10
    if (normalized.form.last5 !== 10) {
        throw new Error(`Form Parsing Failed: Expected 10, got ${normalized.form.last5}`);
    }
    console.log("Form Parsing: OK (10)");

    // 4. Quality Flags
    if (!Array.isArray(normalized.quality.flags)) {
        throw new Error("Quality Flags Missing");
    }
    console.log("Quality Flags: OK");

    console.log("\nSUCCESS: All V2 Fixes verified.");

} catch (err) {
    console.error("TEST FAILED:", err);
    process.exit(1);
}
