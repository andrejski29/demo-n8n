
const fs = require('fs');
const { processItems } = require('./value_bet_detector');

try {
    const rawData = fs.readFileSync('results.txt', 'utf8');
    const data = JSON.parse(rawData);

    // Simulate n8n items structure
    const items = data.map(d => ({ json: d }));

    console.log("Processing items...");
    const resultItems = processItems(items);

    const output = resultItems.map(item => item.json);

    fs.writeFileSync('output.json', JSON.stringify(output, null, 2));
    console.log("Done! Output written to output.json");

} catch (err) {
    console.error("Error running detection:", err);
}
