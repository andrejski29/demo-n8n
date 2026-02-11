/**
 * n8n Code node (JavaScript) — TEAM DATA MERGE STRATEGY
 *
 * Merges "Season Stats" (final_node_home/away) and "Form Stats" (normalize_last_x)
 * into a single comprehensive Team Object.
 *
 * Logic:
 * 1. Identifies which input is "Season" and which is "Form".
 * 2. Validates they belong to the same team/side.
 * 3. Merges into a clean 'team_dataset' structure.
 */

// ------------------------- Input Simulation -------------------------
// In n8n, if you use a "Merge" node (Mode: Combine, Join by Position or ID), 
// you might get a single merged item. 
// IF you pass them as two separate inputs to a Code node:
// const seasonData = $input.item.json (from Input 1)
// const formData = $input.item.json (from Input 2)
//
// Assuming the user wants a Code Node that takes the *collection* of items 
// (likely flattened or appended upstream) and merges them into one object.

const mergeTeamData = (items) => {
  // We expect 2 items for the same team (or pairs if multiple matches)
  // Since n8n execution is per-item, we might receive an array of 2 items here
  // if they were appended.
  
  if (!items || items.length < 2) {
    return { error: "Insufficient data for merge. Expected Season Stats + Form Stats." };
  }

  let seasonItem = null;
  let formItem = null;

  // 1. Detect Item Types
  for (const item of items) {
    const json = item.json || item;
    if (json.features && !json.last_5) {
      seasonItem = json;
    } else if (json.last_5) {
      formItem = json;
    }
  }

  if (!seasonItem || !formItem) {
    return { 
        error: "Could not identify distinct Season and Form datasets.",
        debug: { seasonFound: !!seasonItem, formFound: !!formItem }
    };
  }

  // 2. Validation (Optional but recommended)
  if (seasonItem.side !== formItem.side) {
    return { error: `Side mismatch: ${seasonItem.side} vs ${formItem.side}` };
  }
  // If match_id is available, check it
  if (seasonItem.match_id && formItem.match_id && seasonItem.match_id !== formItem.match_id) {
     // Warning or Error depending on strictness
  }

  // 3. Construct Final Object
  // We prioritize the explicit structure requested:
  // "cleanly merge ... making it explicit that this one corresponds to the home team"
  
  const merged = {
    match_id: seasonItem.match_id ?? formItem.match_id, // Recovery
    side: seasonItem.side,
    team_meta: seasonItem.team, // ID, Name, Season, etc.
    
    // Global Season Stats
    season_stats: {
      features: seasonItem.features,
      coverage: seasonItem.coverage
    },

    // Form Snapshots
    form_stats: {
      last_5: formItem.last_5,
      last_6: formItem.last_6,
      last_10: formItem.last_10
    }
  };

  return merged;
};

// ------------------------- Mock Inputs from User -------------------------
const mockSeasonInput = [
  {
    "match_id": null,
    "side": "home",
    "team": {
      "id": 156,
      "name": "Sunderland",
      "season": "2025/2026",
      "competition_id": 15050
    },
    "coverage": { "matches_played": { "overall": 23 } }, // Simplified for brevity
    "features": { "ppg_overall": 1.43, "xg_for_avg_overall": 1.15 }
  }
];

const mockFormInput = [
  {
    "match_id": null,
    "side": "home",
    "team_id": 156,
    "team_name": "Sunderland",
    "last_5": { "features": { "form_ppg_overall": 1 } },
    "last_6": { "features": { "form_ppg_overall": 1 } },
    "last_10": { "features": { "form_ppg_overall": 1.1 } }
  }
];

// Verify the merge function
const result = mergeTeamData([{ json: mockSeasonInput[0] }, { json: mockFormInput[0] }]);

console.log(JSON.stringify(result, null, 2));
