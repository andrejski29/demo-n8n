// Mock inputs
const items = [
  {
    json: {
      side: "home",
      match_id: 123,
      team: { id: 1, name: "HomeFC" },
      features: { ppg_overall: 2.0 },
      coverage: { matches_played: { overall: 20 } }
    }
  },
  {
    json: {
      side: "home",
      match_id: 123,
      team_name: "HomeFC",
      last_5: { features: { form_ppg: 3.0 } },
      last_6: {},
      last_10: {}
    }
  }
];

const mismatchItems = [
  { json: { side: "home", features: {} } },
  { json: { side: "away", last_5: {} } }
];

// --- PASTE merge_team_data.js LOGIC HERE (Simulated) ---

const mergeTeamData = (inputs) => {
  if (!inputs || inputs.length < 2) {
    return { error: "Insufficient data for merge." };
  }

  let seasonItem = null;
  let formItem = null;

  for (const item of inputs) {
    const json = item.json || item;
    if (json.features && !json.last_5) {
      seasonItem = json;
    } else if (json.last_5) {
      formItem = json;
    }
  }

  if (!seasonItem || !formItem) {
    return { error: "Could not identify distinct Season and Form datasets." };
  }

  if (seasonItem.side && formItem.side && seasonItem.side !== formItem.side) {
    return { error: `Side mismatch: ${seasonItem.side} vs ${formItem.side}` };
  }

  const merged = {
    match_id: seasonItem.match_id ?? formItem.match_id,
    side: seasonItem.side,
    team_meta: seasonItem.team,
    season_stats: {
      features: seasonItem.features,
      coverage: seasonItem.coverage
    },
    form_stats: {
      last_5: formItem.last_5,
      last_6: formItem.last_6,
      last_10: formItem.last_10
    }
  };

  return merged;
};

// --- RUN TESTS ---
console.log("Test 1: Success Case");
const successResult = mergeTeamData(items);
console.log(JSON.stringify(successResult, null, 2));

console.log("\nTest 2: Mismatch Case");
const failResult = mergeTeamData(mismatchItems);
console.log(JSON.stringify(failResult, null, 2));
