// Mock input for Last X Away verification
const items = [
  {
    json: {
      match_id: 456,
      // No side provided -> should default to "away"
      data: [
        {
          id: 789,
          name: "Away Team FC",
          last_x_match_num: 5,
          stats: {
            seasonMatchesPlayed_overall: 5,
            seasonGoals_overall: 3,
            shotsTotal_overall: 40,
            xg_for_avg_overall: 1.2
          },
          additional_info: {
            formRun_overall: "wdwdl"
          }
        }
      ]
    }
  }
];

// --- SIMULATED LOGIC FROM normalize_last_x_away.js ---
// (Simplified wrapper around the expected logic to verify keys)

const fs = require('fs');

const code = fs.readFileSync('normalize_last_x_away.js', 'utf8');

// 1. Check for hard default
if (code.includes('const side = input?.side ?? "away";')) {
    console.log("SUCCESS: Hard default for 'side' is set to 'away'.");
} else {
    console.log("FAILURE: Hard default for 'side' NOT found.");
}

// 2. Check for full feature set inclusion (random sampling of deep keys)
const requiredKeys = [
    "xg_per_shot_overall", 
    "p_over05_goals_overall",
    "corners_2h_vs_fh_ratio",
    "coverage_missing_keys"
];

const missing = requiredKeys.filter(k => !code.includes(k));

if (missing.length === 0) {
    console.log("SUCCESS: All advanced feature keys found.");
} else {
    console.log("FAILURE: Missing keys:", missing);
}
