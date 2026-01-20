
// ==================== // CONFIG & THRESHOLDS // ====================

const PROB_CAP = 0.90; // Reject if fair prob > 0.90
const ODDS_FLOOR = 1.40; // Reject if bookie odd < 1.40
const EDGE_FLOOR = 15; // Reject if edge < 15%
const RATING_FLOOR = 55; // Reject if rating score < 55
const EXCLUDE_MARKET = "1X2_1H"; // Volatility control

const OVERROUND_MIN = 1.00;
const OVERROUND_MAX = 1.08;

// Telegram Scoring
const BONUS_ODDS_MIN = 1.80;
const BONUS_ODDS_MAX = 2.40;
const BONUS_EDGE_MIN = 20;
const BONUS_SCORE = 10;
const PENALTY_ODDS_THRESH = 1.45;
const PENALTY_SCORE = 10;
const SOFT_PENALTY_PROB = 0.88;
const SOFT_PENALTY_SCORE = 5;

// Classification - CORE (Gold)
const CORE_PROB_MIN = 0.55;
const CORE_PROB_MAX = 0.85;
const CORE_ODDS_MIN = 1.50;
const CORE_ODDS_MAX = 2.20;
const CORE_EDGE_MIN = 15;
const STAKE_CORE = 1.0;

// Classification - VALUE (Silver)
const VALUE_EDGE_MIN = 20;
const VALUE_ODDS_MIN = 2.20;
const VALUE_PROB_MIN = 0.45;
const STAKE_VALUE = 0.5;

// Combo Constraints
const COMBO_ODDS_MIN = 2.10;
const COMBO_ODDS_MAX = 3.00;
const STAKE_COMBO = 0.5;

// ==================== // HELPERS // ====================

const parseNum = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return null;
    const str = String(val).replace(/[%]/g, '');
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : null;
};

const getFixtureDay = (isoDate) => {
    if (!isoDate) return "Unknown";
    try {
        return new Date(isoDate).toISOString().split('T')[0];
    } catch (e) {
        return "Unknown";
    }
};

const buildTelegramBlock = (dayObj) => {
    const lines = [];
    const dateStr = dayObj.date;
    lines.push(`📅 *Daily Menu for ${dateStr}*`);
    lines.push("");

    // Core Singles
    if (dayObj.packs.core_singles.length > 0) {
        lines.push(`🛡️ *CORE SINGLES (Gold)*`);
        dayObj.packs.core_singles.forEach(p => {
            lines.push(`• *${p.match}*`);
            lines.push(`  ${p.market} - ${p.selection} @ *${p.odds.toFixed(2)}*`);
            lines.push(`  Edge: ${p.edge}% | Rating: ${p.rating}`);
            lines.push(`  🎯 Stake: ${p.units}u`);
            lines.push("");
        });
    }

    // Smart Combo
    if (dayObj.packs.smart_combo) {
        lines.push(`🔥 *SMART COMBO (Double)*`);
        const c = dayObj.packs.smart_combo;
        c.legs.forEach(l => {
            lines.push(`• ${l.match}: ${l.market} - ${l.selection} @ ${l.odds.toFixed(2)}`);
        });
        lines.push(`  🚀 *Total Odds: ${c.total_odds.toFixed(2)}*`);
        lines.push(`  🎯 Stake: ${c.units}u`);
        lines.push("");
    }

    // Value Pick
    if (dayObj.packs.value_pick) {
        const v = dayObj.packs.value_pick;
        lines.push(`💎 *VALUE SINGLE (Silver)*`);
        lines.push(`• *${v.match}*`);
        lines.push(`  ${v.market} - ${v.selection} @ *${v.odds.toFixed(2)}*`);
        lines.push(`  Edge: ${v.edge}% | Prob: ${(v.p * 100).toFixed(1)}%`);
        lines.push(`  🎯 Stake: ${v.units}u`);
        lines.push("");
    }

    if (lines.length <= 2) lines.push("No recommended plays for today.");

    return lines.join("\n");
};

// ==================== // MAIN LOGIC // ====================

const debugStats = {
    input_count: 0,
    valid_parsed: 0,
    passed_hard_filters: 0,
    after_dedup: 0,
    classified_core: 0,
    classified_value: 0
};

// Flatten items if n8n provides structure {json: ...}
const rawInputs = Array.isArray(items) ? items.map(i => i.json || i) : [items];
// The input might be an array of objects directly if previous node outputted one large array,
// or an array of items where each item is a bet row.
// Assuming n8n standard: array of items.

debugStats.input_count = rawInputs.length;

// --- Step A: Normalization ---
const bets = [];

for (const row of rawInputs) {
    // Check essential fields presence (loose check, stricter parsing below)
    if (!row.fixture_id && (!row.fixture_date || !row.home)) continue;

    const bookie_odd_num = parseNum(row.bookie_odd);
    const edge_percent_num = parseNum(row.edge_percent);
    const rating_score_num = parseNum(row.rating_score);
    const fair_prob_num = parseNum(row.fair_prob_raw);
    const overround_num = row.overround ? parseNum(row.overround) : null;

    if (bookie_odd_num === null || edge_percent_num === null || rating_score_num === null || fair_prob_num === null) {
        continue; // Drop unparseable
    }

    const fixture_day = getFixtureDay(row.fixture_date);

    bets.push({
        ...row,
        bookie_odd_num,
        edge_percent_num,
        rating_score_num,
        fair_prob_num,
        overround_num,
        fixture_day,
        fixture_id: row.fixture_id || `${fixture_day}_${row.home}_${row.away}` // Fallback ID
    });
}

debugStats.valid_parsed = bets.length;

// --- Step B: Hard Filters ---
const filteredBets = bets.filter(b => {
    if (b.fair_prob_num > PROB_CAP) return false;
    if (b.bookie_odd_num < ODDS_FLOOR) return false;
    if (b.edge_percent_num < EDGE_FLOOR) return false;
    if (b.rating_score_num < RATING_FLOOR) return false;
    if (b.market === EXCLUDE_MARKET) return false;

    if (b.overround_num !== null) {
        if (b.overround_num < OVERROUND_MIN || b.overround_num > OVERROUND_MAX) return false;
    }
    return true;
});

debugStats.passed_hard_filters = filteredBets.length;

// --- Step C: Deduplication (Anti-Correlation) ---
// Group by fixture_id
const groups = {};
for (const b of filteredBets) {
    if (!groups[b.fixture_id]) groups[b.fixture_id] = [];
    groups[b.fixture_id].push(b);
}

const uniqueBets = [];
for (const fid in groups) {
    const group = groups[fid];
    // Sort desc: Rating -> Edge -> Odds
    group.sort((a, b) => {
        if (b.rating_score_num !== a.rating_score_num) return b.rating_score_num - a.rating_score_num;
        if (b.edge_percent_num !== a.edge_percent_num) return b.edge_percent_num - a.edge_percent_num;
        return b.bookie_odd_num - a.bookie_odd_num;
    });
    uniqueBets.push(group[0]); // Keep top 1
}

debugStats.after_dedup = uniqueBets.length;

// --- Step D: Telegram Score ---
for (const b of uniqueBets) {
    let ts = b.rating_score_num;

    // Bonus
    if (b.bookie_odd_num >= BONUS_ODDS_MIN && b.bookie_odd_num <= BONUS_ODDS_MAX && b.edge_percent_num >= BONUS_EDGE_MIN) {
        ts += BONUS_SCORE;
    }

    // Penalty (Low Odds)
    if (b.bookie_odd_num < PENALTY_ODDS_THRESH) {
        ts -= PENALTY_SCORE;
    }

    // Soft Penalty (High Prob)
    if (b.fair_prob_num >= SOFT_PENALTY_PROB) {
        ts -= SOFT_PENALTY_SCORE;
    }

    b.telegram_score = ts;
}

// --- Step E: Classification ---
const classified = uniqueBets.map(b => {
    let tier = "OTHER";
    let units = 0;

    const isCore = (
        b.fair_prob_num >= CORE_PROB_MIN &&
        b.fair_prob_num <= CORE_PROB_MAX &&
        b.bookie_odd_num >= CORE_ODDS_MIN &&
        b.bookie_odd_num <= CORE_ODDS_MAX &&
        b.edge_percent_num >= CORE_EDGE_MIN
    );

    const isValue = (
        b.edge_percent_num >= VALUE_EDGE_MIN &&
        b.bookie_odd_num > VALUE_ODDS_MIN &&
        b.fair_prob_num >= VALUE_PROB_MIN
    );

    if (isCore) {
        tier = "CORE";
        units = STAKE_CORE;
    } else if (isValue) {
        tier = "VALUE";
        units = STAKE_VALUE;
    }

    return { ...b, tier, units };
}).filter(b => b.tier !== "OTHER"); // Drop unclassified

debugStats.classified_core = classified.filter(b => b.tier === "CORE").length;
debugStats.classified_value = classified.filter(b => b.tier === "VALUE").length;

// --- Step F: Daily Pack Assembly ---
// Group by Day
const days = {};
for (const b of classified) {
    if (!days[b.fixture_day]) days[b.fixture_day] = [];
    days[b.fixture_day].push(b);
}

const output = [];

for (const dayStr in days) {
    const dayPicks = days[dayStr];
    // Separate by Tier
    const corePicks = dayPicks.filter(p => p.tier === "CORE").sort((a, b) => b.telegram_score - a.telegram_score);
    const valuePicks = dayPicks.filter(p => p.tier === "VALUE").sort((a, b) => b.telegram_score - a.telegram_score); // Sort value picks too? usually by edge, but user said "Top 1 VALUE pick (if any)". Let's use telegram_score or edge. User didn't specify sort for value, implied "Top". Using telegram_score is safe.

    // 1. Top Picks (Core Singles)
    const topCore = corePicks.slice(0, 3);

    // 2. Smart Combo
    // Default legs: rank #4 and #5 from corePicks (indices 3 and 4)
    let combo = null;
    const candidates = corePicks.slice(3); // All remaining cores
    if (candidates.length >= 2) {
        // Try default #4 + #5
        const p1 = candidates[0];
        const p2 = candidates[1];
        let total = p1.bookie_odd_num * p2.bookie_odd_num;

        if (total >= COMBO_ODDS_MIN && total <= COMBO_ODDS_MAX) {
            combo = {
                legs: [p1, p2],
                total_odds: total,
                units: STAKE_COMBO
            };
        } else {
            // Search for best pair
            // Goal: maximize telegram_score sum while within odds range
            let bestPair = null;
            let bestScoreSum = -Infinity;

            for (let i = 0; i < candidates.length; i++) {
                for (let j = i + 1; j < candidates.length; j++) {
                    const l1 = candidates[i];
                    const l2 = candidates[j];
                    const t = l1.bookie_odd_num * l2.bookie_odd_num;
                    if (t >= COMBO_ODDS_MIN && t <= COMBO_ODDS_MAX) {
                        const s = l1.telegram_score + l2.telegram_score;
                        if (s > bestScoreSum) {
                            bestScoreSum = s;
                            bestPair = [l1, l2];
                        }
                    }
                }
            }
            if (bestPair) {
                combo = {
                    legs: bestPair,
                    total_odds: bestPair[0].bookie_odd_num * bestPair[1].bookie_odd_num,
                    units: STAKE_COMBO
                };
            }
        }
    }

    // 3. Fun Pick (Value Single)
    const funPick = valuePicks.length > 0 ? valuePicks[0] : null; // Top 1
    if (funPick) funPick.units = 0.25; // Override unit for Fun Pick per request

    // Format for Output
    const packObj = {
        core_singles: topCore.map(p => ({
            fixture_id: p.fixture_id,
            match: `${p.home} vs ${p.away}`,
            market: p.market,
            selection: p.outcome, // Assuming 'outcome' is the selection key
            odds: p.bookie_odd_num,
            edge: p.edge_percent_num,
            p: p.fair_prob_num,
            rating: p.rating_score_num,
            score: p.telegram_score,
            units: p.units
        })),
        smart_combo: combo ? {
            legs: combo.legs.map(l => ({
                fixture_id: l.fixture_id,
                match: `${l.home} vs ${l.away}`,
                market: l.market,
                selection: l.outcome,
                odds: l.bookie_odd_num,
                edge: l.edge_percent_num,
                rating: l.rating_score_num
            })),
            total_odds: combo.total_odds,
            units: combo.units
        } : null,
        value_pick: funPick ? {
            fixture_id: funPick.fixture_id,
            match: `${funPick.home} vs ${funPick.away}`,
            market: funPick.market,
            selection: funPick.outcome,
            odds: funPick.bookie_odd_num,
            edge: funPick.edge_percent_num,
            p: funPick.fair_prob_num,
            rating: funPick.rating_score_num,
            units: funPick.units
        } : null
    };

    const summaryStr = `${packObj.core_singles.length} Core Singles + ${packObj.smart_combo ? "1 Double" : "0 Doubles"} + ${packObj.value_pick ? "1 Value" : "0 Value"}`;

    const dayResult = {
        date: dayStr,
        summary: summaryStr,
        packs: packObj,
        telegram_text_block: "" // Filled below
    };

    dayResult.telegram_text_block = buildTelegramBlock(dayResult);
    output.push(dayResult);
}

// Return formatted
return output;
