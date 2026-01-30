const { DailyCurator } = require('./daily_curator.js');

// Mock Data
// Pick A: Odds 1.5, ID A
// Pick B: Odds 1.5, ID B
// Pick C: Odds 1.5, ID C
// Pick D: Odds 1.5, ID D (This one would make a combo with A valid if B failed, but greedy logic might stop at B)

// Scenario: Target Odds 3.0 - 5.0
// Combo 1: A (1.5) + B (1.5) = 2.25 (Too low)
// Combo 2: A (1.5) + C (2.5) = 3.75 (Valid)

// With greedy break: Loop i=A. Loop j=B. Total=2.25. < Min. Break? NO, we want Continue.
// Original code had: if (currentCombo.length === legCount) { check odds; break; }
// So if it reached leg count but failed odds, it broke the inner loop.

// Let's create data to prove the fix works.
// A: 1.5
// B: 1.2 (Total 1.8 -> Too low)
// C: 2.5 (Total 3.75 -> Valid)

const input = [
    { type: 'pick', match_id: 'A', best_odds: 1.5, edge: 0.1, probability: 0.8, rank_score: 100, date_iso: '2026-01-01' },
    { type: 'pick', match_id: 'B', best_odds: 1.2, edge: 0.1, probability: 0.8, rank_score: 90, date_iso: '2026-01-01' },
    { type: 'pick', match_id: 'C', best_odds: 2.5, edge: 0.1, probability: 0.8, rank_score: 80, date_iso: '2026-01-01' }
];

// Configure curator to force smart doubles (2 legs) with min odds 3.0
// We need to check if it finds A+C.
// A+B = 1.8 (Fail)
// A+C = 3.75 (Pass)

console.log("Running Combo Logic Test...");
const curator = new DailyCurator(input, true);
// We override config internally for this test or just rely on default.
// Default Smart Doubles: Min 2.0, Max 3.5.
// 1.5 * 1.2 = 1.8 (Fail Min)
// 1.5 * 2.5 = 3.75 (Fail Max 3.5) -> Wait, 3.75 > 3.5.
// Let's adjust odds to fit default range [2.0 - 3.5].

// A: 1.5
// B: 1.2 => 1.8 (Fail Min 2.0)
// C: 2.0 => 3.0 (Pass)

input[0].best_odds = 1.5;
input[1].best_odds = 1.2;
input[2].best_odds = 2.0;

const results = curator.process();
const day = results[0];
const doubles = day.digest.sections.smart_doubles;

console.log("Smart Doubles Found:", doubles.length);
if (doubles.length > 0) {
    console.log("Double 1 Odds:", doubles[0].total_odds);
    console.log("Legs:", doubles[0].legs.map(l => l.match_id).join('+'));
} else {
    console.log("No doubles found.");
}
