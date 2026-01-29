const fs = require('fs');
const { analyzeMatch } = require('./footystats_predictor');

try {
    const rawData = fs.readFileSync('Merge.json', 'utf8');
    const inputJson = JSON.parse(rawData);

    console.log("Running Analysis on Merge.json...");
    const result = analyzeMatch(inputJson);

    console.log("\n=== PROBABILITIES KEYS ===");
    if (result.probabilities) {
        console.log(Object.keys(result.probabilities));
    } else {
        console.log("No probabilities found.");
    }

    fs.writeFileSync('output.json', JSON.stringify(result, null, 2));
    console.log("\nResult saved to output.json");

} catch (err) {
    console.error("Error running local test:", err);
}
