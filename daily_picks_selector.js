const fs = require('fs');

/**
 * Daily Picks Selector Node
 *
 * Takes a flattened array of all bets (from Probability Engine),
 * filters, ranks, and groups them into a Daily Portfolio.
 */

// Configuration
const CONFIG = {
    min_confidence: 50,
    min_edge: 0.0,

    // Classification Thresholds
    core_prob_min: 0.55, // Slightly lower than 0.60 to capture strong favorites
    value_prob_min: 0.35,

    // Combo Constraints
    mid_combo_min_odds: 3.0,
    mid_combo_max_odds: 5.0,
    max_legs: 3
};

function selectDailyPortfolio(allBets) {
    console.log(`[Selector] Processing ${allBets.length} raw bets...`);

    // 1. Initial Filter
    const validBets = allBets.filter(b =>
        b.confidence_score >= CONFIG.min_confidence &&
        b.edge >= CONFIG.min_edge &&
        b.ev > 0
    );
    console.log(`[Selector] ${validBets.length} bets passed initial filters.`);

    // 2. Deduplicate: Max 1 bet per match (Best Sort Score)
    const bestPerMatch = {};
    validBets.forEach(bet => {
        if (!bestPerMatch[bet.match_id] || bet.sort_score > bestPerMatch[bet.match_id].sort_score) {
            bestPerMatch[bet.match_id] = bet;
        }
    });
    const uniqueBets = Object.values(bestPerMatch).sort((a, b) => b.sort_score - a.sort_score);
    console.log(`[Selector] ${uniqueBets.length} unique match bets selected.`);

    // 3. Classification
    const classification = {
        core: [],
        value: [],
        high_potential: []
    };

    uniqueBets.forEach(bet => {
        if (bet.p_model >= CONFIG.core_prob_min) {
            classification.core.push(bet);
        } else if (bet.p_model >= CONFIG.value_prob_min) {
            classification.value.push(bet);
        } else {
            classification.high_potential.push(bet);
        }
    });

    // 4. Generate Combos
    const combos = {
        core_double: generateDouble(classification.core),
        smart_double: generateDouble(classification.value),
        mid_combo: generateMidCombo(uniqueBets, CONFIG.mid_combo_min_odds, CONFIG.mid_combo_max_odds)
    };

    // 5. Construct Final Output
    const output = {
        meta: {
            generated_at: new Date().toISOString(),
            total_matches_analyzed: new Set(allBets.map(b => b.match_id)).size,
            portfolio_size: uniqueBets.length
        },
        core_singles: classification.core.slice(0, 5), // Top 5
        value_singles: classification.value.slice(0, 5), // Top 5
        high_potential_singles: classification.high_potential.slice(0, 3), // Top 3
        combos: combos,
        stats: {
            core_count: classification.core.length,
            value_count: classification.value.length,
            high_pot_count: classification.high_potential.length
        }
    };

    return output;
}

function generateDouble(pool) {
    if (pool.length < 2) return null;
    // Assumes pool is already sorted by sort_score desc
    const leg1 = pool[0];
    const leg2 = pool[1];

    return {
        type: "double",
        total_odds: parseFloat((leg1.odds * leg2.odds).toFixed(2)),
        combined_edge: parseFloat(((1 + leg1.edge) * (1 + leg2.edge) - 1).toFixed(3)),
        legs: [leg1, leg2]
    };
}

function generateMidCombo(pool, minOdds, maxOdds) {
    // Greedy search for 2-3 legs summing to range
    // Pool is sorted by quality

    // Try 2 legs first
    for (let i = 0; i < Math.min(pool.length, 20); i++) {
        for (let j = i + 1; j < Math.min(pool.length, 20); j++) {
            const leg1 = pool[i];
            const leg2 = pool[j];
            const totalOdds = leg1.odds * leg2.odds;

            if (totalOdds >= minOdds && totalOdds <= maxOdds) {
                return {
                    type: "mid_combo_2leg",
                    total_odds: parseFloat(totalOdds.toFixed(2)),
                    combined_edge: parseFloat(((1 + leg1.edge) * (1 + leg2.edge) - 1).toFixed(3)),
                    legs: [leg1, leg2]
                };
            }
        }
    }

    // Try 3 legs if no 2-leg found
    for (let i = 0; i < Math.min(pool.length, 15); i++) {
        for (let j = i + 1; j < Math.min(pool.length, 15); j++) {
            for (let k = j + 1; k < Math.min(pool.length, 15); k++) {
                const leg1 = pool[i];
                const leg2 = pool[j];
                const leg3 = pool[k];
                const totalOdds = leg1.odds * leg2.odds * leg3.odds;

                if (totalOdds >= minOdds && totalOdds <= maxOdds) {
                    return {
                        type: "mid_combo_3leg",
                        total_odds: parseFloat(totalOdds.toFixed(2)),
                        combined_edge: parseFloat(((1 + leg1.edge) * (1 + leg2.edge) * (1 + leg3.edge) - 1).toFixed(3)),
                        legs: [leg1, leg2, leg3]
                    };
                }
            }
        }
    }

    return null; // No valid combo found
}

// Execution Block (for local testing)
if (require.main === module) {
    try {
        const rawData = fs.readFileSync('base_bets.json', 'utf8');
        const bets = JSON.parse(rawData);
        const portfolio = selectDailyPortfolio(bets);

        console.log(JSON.stringify(portfolio, null, 2));

        // Optional: Write output to file for inspection
        fs.writeFileSync('daily_portfolio.json', JSON.stringify(portfolio, null, 2));
    } catch (err) {
        console.error("Error running selector:", err);
    }
}

module.exports = { selectDailyPortfolio };
