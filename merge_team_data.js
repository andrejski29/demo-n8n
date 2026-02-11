/**
 * n8n Code node (JavaScript) — TEAM DATA MERGE
 *
 * Merges "Season Stats" (from final_node_home/away) and "Form Stats" (from Last X node)
 * into a single unified Team Dataset.
 *
 * Assumptions:
 * - Input is an array containing 2 items:
 *   1. The Season Stats object (has `features` at root).
 *   2. The Form Stats object (has `last_5` at root).
 * - Both items must belong to the same side (home/away).
 */

const items = $input.all(); // Access all input items in n8n

// ------------------------- Merge Logic -------------------------

const mergeTeamData = (inputs) => {
  if (!inputs || inputs.length < 2) {
    return { error: "Insufficient data for merge. Expected Season Stats + Form Stats." };
  }

  let seasonItem = null;
  let formItem = null;

  // 1. Detect Item Types based on structure
  for (const item of inputs) {
    const json = item.json || item; // Handle n8n wrapper
    
    // Season stats node outputs `features` at the top level
    if (json.features && !json.last_5) {
      seasonItem = json;
    } 
    // Last X node outputs `last_5` at the top level
    else if (json.last_5) {
      formItem = json;
    }
  }

  if (!seasonItem || !formItem) {
    return { 
        error: "Could not identify distinct Season and Form datasets. Check upstream outputs.",
        debug: { seasonFound: !!seasonItem, formFound: !!formItem }
    };
  }

  // 2. Validation: Ensure we are merging the same side
  if (seasonItem.side && formItem.side && seasonItem.side !== formItem.side) {
    return { 
        error: `Side mismatch detected during merge: ${seasonItem.side} vs ${formItem.side}`,
        season_team: seasonItem.team?.name,
        form_team: formItem.team_name // Note: Last X node outputs 'team_name' at root
    };
  }

  // 3. Construct Final Object
  // This structure isolates the "Season" data from "Form" snapshots
  // to preventing key collisions while keeping everything accessible.
  
  const merged = {
    // Identity
    match_id: seasonItem.match_id ?? formItem.match_id,
    side: seasonItem.side,
    team_meta: seasonItem.team, // Contains ID, Name, Logo, Season, etc.
    
    // Core Season Stats (Averages, xG, Probabilities based on full season)
    season_stats: {
      features: seasonItem.features,
      coverage: seasonItem.coverage
    },

    // Recent Form Snapshots (Last 5, 6, 10 matches)
    form_stats: {
      last_5: formItem.last_5,
      last_6: formItem.last_6,
      last_10: formItem.last_10
    }
  };

  return merged;
};

// ------------------------- Execution -------------------------

// If n8n passes items as a list, we merge them into ONE output item.
const result = mergeTeamData(items);

return [{ json: result }];
