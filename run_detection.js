
const fs = require('fs');

try {
    const rawData = fs.readFileSync('results.txt', 'utf8');
    const data = JSON.parse(rawData);

    // Simulate n8n items structure
    const items = data.map(d => ({ json: d }));

    const code = fs.readFileSync('value_bet_detector.js', 'utf8');

    console.log("Processing items...");

    // Create a function that simulates the n8n environment
    // In n8n code node, 'items' is global.
    const runCode = new Function('items', code);

    const resultItems = runCode(items);

    const output = resultItems.map(item => item.json);

    fs.writeFileSync('output.json', JSON.stringify(output, null, 2));
    console.log("Done! Output written to output.json");

} catch (err) {
    console.error("Error running detection:", err);
}
