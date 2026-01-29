const fs = require('fs');

try {
    const rawData = fs.readFileSync('Merge.json', 'utf8');
    const inputJson = JSON.parse(rawData);

    // Mock n8n "items"
    global.items = [
        { json: inputJson }
    ];

    console.log("Simulating n8n execution...");

    // We need to 'require' the file but since the logic is in the top-level scope (well, conditionally),
    // simply requiring it should trigger the logic if 'items' is defined.
    // However, require caches the module. If I require it, it executes the code.

    // Note: In Node.js, `items` needs to be global for the script to see it if it checks `typeof items`.

    // Let's modify how we execute it. We can read the file content and eval it,
    // OR we can rely on the fact that I just defined global.items.

    // But `footystats_predictor.js` has `if (typeof module !== 'undefined')` at the end which exports.
    // The n8n logic is `if (typeof items !== 'undefined')`.

    // If I require it, it runs.
    const predictor = require('./footystats_predictor');

    // Wait, the n8n block returns `results`. But `require` returns `module.exports`.
    // The code inside `footystats_predictor.js` that does `return results` is strictly for n8n function node context
    // where the code is wrapped in a function.

    // In a standard Node module, `return` at top level is illegal (unless CJS wrapper logic, but typically n8n code isn't a module).
    // Ah, n8n Code Node wraps the user code in a function.

    // So, testing the *exact* n8n block via `require` is tricky because of the `return`.
    // `return results;` will throw "Illegal return statement" in Node if not in a function.

    // To properly test this locally without syntax errors, I should wrap the file content in a function.

    const code = fs.readFileSync('footystats_predictor.js', 'utf8');

    // Create a function that mocks the n8n environment
    const n8nMock = new Function('items', code + "\nreturn typeof analyzeMatch !== 'undefined' ? analyzeMatch : null;");

    // But wait, the `return results` in the file will terminate the function execution early.
    // That's perfect.

    const result = n8nMock(global.items);

    console.log("\n=== N8N SIMULATION RESULT ===");
    console.log(JSON.stringify(result, null, 2));

    fs.writeFileSync('output.json', JSON.stringify(result, null, 2));

} catch (err) {
    console.error("Error running local test:", err);
}
