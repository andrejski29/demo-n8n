// Mock n8n inputs
const items = [
  {
    json: {
      match_id: 999, // Should pass through
      // side is MISSING -> should default based on file logic
      data: [
        {
          id: 156,
          name: "Sunderland",
          stats: {
            seasonMatchesPlayed_overall: 10,
            shots_recorded_matches_num_overall: 10,
            shot_conversion_rate_overall: 15,
            cardsTotal_overall: 5,
            additional_info: {
              corners_fh_avg_overall: 2.5
            }
          }
        }
      ]
    }
  }
];

// We simulate the key logic difference between the two files
const runSimulation = (inputItem, forcedSide) => {
    const input = inputItem.json;
    // --- LOGIC FROM final_node_*.js START ---
    // New: Identity & Side extraction (match_id/side passthrough)

    // In Home Node: const side = input?.side ?? "home";
    // In Away Node: const side = input?.side ?? "away";

    const side = input?.side ?? forcedSide; // Simulating the hard-coded value
    const match_id = input?.match_id ?? input?.fixture_id ?? null;
    // --- LOGIC END ---

    return { side, match_id };
};

console.log("Testing Home Node Logic:");
const homeResult = runSimulation(items[0], "home");
console.log(JSON.stringify(homeResult, null, 2));

console.log("\nTesting Away Node Logic:");
const awayResult = runSimulation(items[0], "away");
console.log(JSON.stringify(awayResult, null, 2));

// Test priority (if upstream sets side, does it stick?)
const itemsWithSide = [{ json: { ...items[0].json, side: "neutral" } }];
console.log("\nTesting Priority (Input side 'neutral' vs Default):");
// Note: The code uses ?? so input.side takes precedence if not null/undefined.
const priorityResult = runSimulation(itemsWithSide[0], "home");
console.log(JSON.stringify(priorityResult, null, 2));
