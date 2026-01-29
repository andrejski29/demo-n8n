const fs = require('fs');

try {
    const rawData = fs.readFileSync('Merge.json', 'utf8');
    const inputJson = JSON.parse(rawData);

    // Mock n8n "items"
    // Merge.json structure ALREADY matches the n8n items array (Array of 5 items)
    global.items = inputJson;

    console.log("Simulating n8n execution with " + global.items.length + " items...");

    const code = fs.readFileSync('footystats_predictor.js', 'utf8');

    // Create a function that mocks the n8n environment
    const n8nMock = new Function('items', 'module', code);

    const mockModule = { exports: {} };
    const result = n8nMock(global.items, mockModule);

    console.log("\n=== N8N SIMULATION RESULT ===");
    console.log(JSON.stringify(result, null, 2));

} catch (err) {
    console.error("Error running local test:", err);
}
