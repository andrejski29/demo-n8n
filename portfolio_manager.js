// -------------------------
// n8n Node: Global Portfolio Manager (V1 - Batch Optimization)
// -------------------------

// Helper to get input
function getInput() {
  if (typeof item !== 'undefined' && item.json) return item.json;
  if (typeof items !== 'undefined' && items.length > 0) return items.map(i => i.json);
  if (typeof $input !== 'undefined' && $input.all) return $input.all().map(i => i.json);
  if (typeof data !== 'undefined') return data;
  return [];
}

function buildGlobalPortfolio(matches, config = {}) {
    // Config Defaults
    const TOP_N = config.global_limit || 20;
    const MAX_PER_MATCH = config.max_per_match || 3;
    const MAX_PER_CATEGORY = config.max_per_category || 2; // e.g. max 2 'goals_ou' picks per match

    let allBets = [];
    const stats = {
        matches_processed: 0,
        total_value_bets: 0,
        distribution: {}
    };

    // 1. Flatten all bets
    for (const match of matches) {
        if (!match.all_value_bets || !Array.isArray(match.all_value_bets)) continue;

        stats.matches_processed++;

        // Enrich bets with match meta for display
        const enriched = match.all_value_bets.map(bet => ({
            ...bet,
            match_id: match.match_id,
            match_name: `${match.overview.teams.home.name} vs ${match.overview.teams.away.name}`,
            kickoff: match.meta?.date_unix,
            lambda_source: match.overview.lambdas.source
        }));

        allBets.push(...enriched);
    }
    stats.total_value_bets = allBets.length;

    // 2. Global Sort (Confidence > EV)
    // Primary: Confidence Score (Quality)
    // Secondary: EV (Value)
    allBets.sort((a, b) => {
        if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;
        return b.ev - a.ev;
    });

    // 3. Selection with Diversity Constraints
    const selected = [];
    const matchCounts = {}; // match_id -> count
    const matchCatCounts = {}; // match_id_category -> count

    // Track stats
    const categoryStats = {};

    for (const bet of allBets) {
        if (selected.length >= TOP_N) break;

        const mId = bet.match_id;
        const catKey = `${mId}_${bet.market_family}`; // e.g. 12345_goals_ou

        // Init counters
        if (!matchCounts[mId]) matchCounts[mId] = 0;
        if (!matchCatCounts[catKey]) matchCatCounts[catKey] = 0;

        // Constraint Checks
        if (matchCounts[mId] >= MAX_PER_MATCH) continue;
        if (matchCatCounts[catKey] >= MAX_PER_CATEGORY) continue;

        // Avoid exact dupes (sanity check)
        const isDupe = selected.some(s => s.match_id === mId && s.market === bet.market && s.selection === bet.selection);
        if (isDupe) continue;

        // Add to Portfolio
        selected.push(bet);

        // Update Counters
        matchCounts[mId]++;
        matchCatCounts[catKey]++;

        // Stats
        if (!categoryStats[bet.market_family]) categoryStats[bet.market_family] = 0;
        categoryStats[bet.market_family]++;
    }

    stats.distribution = categoryStats;

    return {
        portfolio: selected,
        alternatives: allBets.filter(b => !selected.includes(b)).slice(0, 20), // Next best 20
        stats
    };
}

// --- n8n Wrapper ---
const inputs = getInput();
// If input is wrapped (standard n8n), flatten it
const matchData = Array.isArray(inputs) ? inputs : [inputs];

// Mock Config (in n8n this comes from parameters or node input)
const config = {
    global_limit: 15,
    max_per_match: 2,
    max_per_category: 1 // Strict diversity per match
};

try {
    const output = buildGlobalPortfolio(matchData, config);
    return [{ json: output }]; // Return single summary item
} catch (e) {
    return [{ json: { error: e.message } }];
}
