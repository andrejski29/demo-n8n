const fs = require('fs');
const { analyzeMatch } = require('./footystats_predictor');

try {
    const rawData = fs.readFileSync('Merge.json', 'utf8');
    const inputJson = JSON.parse(rawData);

    // In n8n wrapper, we consolidate inputs. Do the same here.
    const consolidatedInput = inputJson; // Merge.json is already the array of 5 items

    const result = analyzeMatch(consolidatedInput);

    console.log("=== RECOMMENDED PICKS ===");
    console.log(JSON.stringify(result.recommended_picks, null, 2));

} catch (err) {
    console.error(err);
}
