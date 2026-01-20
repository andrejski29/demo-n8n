
// ==================== // CONFIG & THRESHOLDS // ====================

const PROB_CAP_GLOBAL = 0.95; // Anti-overconfidence (Global)
const PROB_CAP_CORE = 0.90;   // Stricter for CORE/Combos

const ODDS_FLOOR = 1.40; // Reject if bookie odd < 1.40
const EDGE_FLOOR = 15;   // Reject if edge < 15% (Hard baseline)
const RATING_FLOOR_GLOBAL = 48; // Lowered from 55 to 48

const OVERROUND_MIN = 1.00;
const OVERROUND_MAX = 1.12; // Widened from 1.08 to 1.12

// Market Gates
const MARKET_1H_ODDS_MIN = 2.20;
const MARKET_1H_EDGE_MIN = 30;
const MARKET_1H_RATING_MIN = 48;

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
const CORE_ODDS_MAX = 2.20; // Optional 2.40 if needed
const CORE_EDGE_MIN = 15;
const CORE_RATING_MIN = 48; // Tier specific
const STAKE_CORE = 1.0;

// Classification - VALUE (Silver)
const VALUE_ODDS_MIN = 2.20;
const VALUE_PROB_MIN = 0.35;
const VALUE_EDGE_MIN = 30; // Stricter edge for Value
const VALUE_RATING_MIN = 48;
const STAKE_VALUE = 0.5;

// Classification - HIGH_UPSIDE
const UPSIDE_ODDS_MIN = 3.00;
const UPSIDE_PROB_MIN = 0.295; // 29.5%
const UPSIDE_EDGE_MIN = 30;
const UPSIDE_RATING_MIN = 48;
const STAKE_UPSIDE = 0.25;

// Smart Combo (Double)
const COMBO_ODDS_MIN = 2.10;
const COMBO_ODDS_MAX = 3.00;
const STAKE_COMBO = 0.5;

// Fun Combo (Treble/4-fold)
const FUN_COMBO_MIN_TOTAL = 8.00;
const FUN_COMBO_MAX_LEGS = 4;
const STAKE_FUN = 0.25;
const FUN_MARKET_BLACKLIST = ["Exact_Goals_Match", "Exact_Goals_Home", "Exact_Goals_Away", "Exact_Goals_2H", "ht_ft", "Combo_Result_BTTS", "Combo_Result_Total", "Combo_TotalGoals_BTTS", "Winning_Margin"];

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
    const topCore = dayObj.packs.core_singles.slice(0, 3);
    const extraCore = dayObj.packs.core_singles.slice(3);

    if (topCore.length > 0) {
        lines.push(`🛡️ *CORE SINGLES (Gold)*`);
        topCore.forEach(p => {
            lines.push(`• *${p.match}*`);
            lines.push(`  ${p.market} - ${p.selection} @ *${p.odds.toFixed(2)}*`);
            lines.push(`  Edge: ${p.edge}% | Rating: ${p.rating}`);
            lines.push(`  🎯 Stake: ${p.units}u`);
            lines.push("");
        });
        if (extraCore.length > 0) {
            lines.push(`_...plus ${extraCore.length} more Core picks available._`);
            lines.push("");
        }
    }

    // Smart Combo(s)
    if (dayObj.packs.smart_combos && dayObj.packs.smart_combos.length > 0) {
        dayObj.packs.smart_combos.forEach((c, idx) => {
            lines.push(`🔥 *SMART COMBO #${idx + 1} (Double)*`);
            c.legs.forEach(l => {
                lines.push(`• ${l.match}: ${l.market} - ${l.selection} @ ${l.odds.toFixed(2)}`);
            });
            lines.push(`  🚀 *Total Odds: ${c.total_odds.toFixed(2)}*`);
            lines.push(`  🎯 Stake: ${c.units}u`);
            lines.push("");
        });
    }

    // Value Picks
    if (dayObj.packs.value_picks.length > 0) {
        lines.push(`💎 *VALUE SINGLES (Silver)*`);
        // Show top 3 value picks if many? Or just list them. Let's list top 3.
        const topValue = dayObj.packs.value_picks.slice(0, 3);
        topValue.forEach(v => {
            lines.push(`• *${v.match}*`);
            lines.push(`  ${v.market} - ${v.selection} @ *${v.odds.toFixed(2)}*`);
            lines.push(`  Edge: ${v.edge}% | Prob: ${(v.p * 100).toFixed(1)}%`);
            lines.push(`  🎯 Stake: ${v.units}u`);
            lines.push("");
        });
    }

    // High Upside
    if (dayObj.packs.upside_picks.length > 0) {
        lines.push(`🚀 *HIGH UPSIDE (Longshots)*`);
        const topUpside = dayObj.packs.upside_picks.slice(0, 2);
        topUpside.forEach(u => {
            lines.push(`• ${u.match}: ${u.market} - ${u.selection} @ *${u.odds.toFixed(2)}*`);
            lines.push(`  🎯 Stake: ${u.units}u`);
        });
        lines.push("");
    }

    // Fun Combo
    if (dayObj.packs.fun_combo) {
        lines.push(`🎢 *FUN COMBO (Treble/4-fold)*`);
        const c = dayObj.packs.fun_combo;
        c.legs.forEach(l => {
            lines.push(`• ${l.match}: ${l.market} - ${l.selection} @ ${l.odds.toFixed(2)}`);
        });
        lines.push(`  🌌 *Total Odds: ${c.total_odds.toFixed(2)}*`);
        lines.push(`  🎯 Stake: ${c.units}u`);
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
    classified_counts: { CORE: 0, VALUE: 0, HIGH_UPSIDE: 0 }
};

const rawInputs = Array.isArray(items) ? items.map(i => i.json || i) : [items];
debugStats.input_count = rawInputs.length;

// --- Step A: Normalization ---
const bets = [];

for (const row of rawInputs) {
    if (!row.fixture_id && (!row.fixture_date || !row.home)) continue;

    const bookie_odd_num = parseNum(row.bookie_odd);
    const edge_percent_num = parseNum(row.edge_percent);
    const rating_score_num = parseNum(row.rating_score);
    const fair_prob_num = parseNum(row.fair_prob_raw);
    const overround_num = row.overround ? parseNum(row.overround) : null;

    if (bookie_odd_num === null || edge_percent_num === null || rating_score_num === null || fair_prob_num === null) {
        continue;
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
        fixture_id: row.fixture_id || `${fixture_day}_${row.home}_${row.away}`
    });
}

debugStats.valid_parsed = bets.length;

// --- Step B: Hard Filters ---
const filteredBets = bets.filter(b => {
    // Global Cap
    if (b.fair_prob_num > PROB_CAP_GLOBAL) return false;

    // Odds Floor
    if (b.bookie_odd_num < ODDS_FLOOR) return false;

    // Edge Floor (Baseline)
    if (b.edge_percent_num < EDGE_FLOOR) return false;

    // Rating Floor (Lowered Global)
    if (b.rating_score_num < RATING_FLOOR_GLOBAL) return false;

    // Overround Gate (Widened)
    if (b.overround_num !== null) {
        if (b.overround_num < OVERROUND_MIN || b.overround_num > OVERROUND_MAX) return false;
    }

    // Market Gates: 1X2_1H allowed only if strict conditions met
    if (b.market === "1X2_1H") {
        if (b.bookie_odd_num < MARKET_1H_ODDS_MIN ||
            b.edge_percent_num < MARKET_1H_EDGE_MIN ||
            b.rating_score_num < MARKET_1H_RATING_MIN) {
            return false;
        }
    }

    return true;
});

debugStats.passed_hard_filters = filteredBets.length;

// --- Step C: Deduplication (Anti-Correlation) ---
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

// --- Step E: Classification (3 Tiers) ---
const classified = uniqueBets.map(b => {
    let tier = "OTHER";
    let units = 0;

    // CORE Logic
    if (
        b.fair_prob_num >= CORE_PROB_MIN &&
        b.fair_prob_num <= CORE_PROB_MAX && // Strictly <= 0.85 per spec? Spec said 0.85. PROB_CAP_CORE is 0.90 for combos.
        // Actually Spec says: CORE_PROB_MAX = 0.85.
        // Also "CORE: fair_prob_raw <= 0.90". Let's respect the CORE_PROB_MAX constant.
        // If prob is 0.88, it's not CORE per range (0.55-0.85).
        // Can it be VALUE? Value min prob 0.35. Yes.
        b.bookie_odd_num >= CORE_ODDS_MIN &&
        b.bookie_odd_num <= CORE_ODDS_MAX &&
        b.edge_percent_num >= CORE_EDGE_MIN &&
        b.rating_score_num >= CORE_RATING_MIN
    ) {
        tier = "CORE";
        units = STAKE_CORE;
    }
    // VALUE Logic
    else if (
        b.edge_percent_num >= VALUE_EDGE_MIN &&
        b.bookie_odd_num > VALUE_ODDS_MIN && // > 2.20
        b.fair_prob_num >= VALUE_PROB_MIN &&
        b.rating_score_num >= VALUE_RATING_MIN
    ) {
        tier = "VALUE";
        units = STAKE_VALUE;
    }
    // HIGH_UPSIDE Logic
    else if (
        b.bookie_odd_num >= UPSIDE_ODDS_MIN &&
        b.fair_prob_num >= UPSIDE_PROB_MIN &&
        b.edge_percent_num >= UPSIDE_EDGE_MIN &&
        b.rating_score_num >= UPSIDE_RATING_MIN
    ) {
        tier = "HIGH_UPSIDE";
        units = STAKE_UPSIDE;
    }

    // Keep if tier is assigned
    return { ...b, tier, units };
}).filter(b => b.tier !== "OTHER");

classified.forEach(b => {
    if (debugStats.classified_counts[b.tier] !== undefined) debugStats.classified_counts[b.tier]++;
});

// --- Step F: Daily Pack Assembly ---
const days = {};
for (const b of classified) {
    if (!days[b.fixture_day]) days[b.fixture_day] = [];
    days[b.fixture_day].push(b);
}

const output = [];

for (const dayStr in days) {
    const dayPicks = days[dayStr];

    // Sort all by telegram_score desc
    dayPicks.sort((a, b) => b.telegram_score - a.telegram_score);

    const corePicks = dayPicks.filter(p => p.tier === "CORE");
    const valuePicks = dayPicks.filter(p => p.tier === "VALUE");
    const upsidePicks = dayPicks.filter(p => p.tier === "HIGH_UPSIDE");

    // 1. Core Singles (All of them)
    // No hard cap, just output list. Telegram block handles display limits.

    // 2. Smart Combo (Double) - Allow up to 2
    const smartCombos = [];
    const usedInCombo = new Set();

    // Candidates for Smart Combo: Must be CORE, Prob <= PROB_CAP_CORE (0.90)
    const comboCandidates = corePicks.filter(p => p.fair_prob_num <= PROB_CAP_CORE);

    // Greedy search for pairs
    // Attempt 1: Default pairing (by rank)
    // Attempt 2: Optimize score

    // We iterate through sorted candidates
    for (let i = 0; i < comboCandidates.length; i++) {
        if (usedInCombo.has(comboCandidates[i].fixture_id)) continue;

        let bestMate = null;
        let bestMateIdx = -1;

        for (let j = i + 1; j < comboCandidates.length; j++) {
            if (usedInCombo.has(comboCandidates[j].fixture_id)) continue;

            const p1 = comboCandidates[i];
            const p2 = comboCandidates[j];

            // Check anti-correlation (fixture_id distinct) - already guaranteed by dedup logic generally,
            // but dedup was per fixture. So yes, distinct fixtures.

            const total = p1.bookie_odd_num * p2.bookie_odd_num;
            if (total >= COMBO_ODDS_MIN && total <= COMBO_ODDS_MAX) {
                // Found a valid pair. Since list is sorted by score, this is likely a high score pair.
                // We pick the first valid match to prioritize higher ranked seeds.
                bestMate = p2;
                bestMateIdx = j;
                break;
            }
        }

        if (bestMate) {
            smartCombos.push({
                legs: [comboCandidates[i], bestMate],
                total_odds: comboCandidates[i].bookie_odd_num * bestMate.bookie_odd_num,
                units: STAKE_COMBO
            });
            usedInCombo.add(comboCandidates[i].fixture_id);
            usedInCombo.add(bestMate.fixture_id);
            if (smartCombos.length >= 2) break; // Max 2 combos
        }
    }

    // 3. Fun Combo (Treble/4-fold)
    let funCombo = null;

    // Pool: VALUE + HIGH_UPSIDE (Preferred) + CORE (Backfill)
    // Filter unsafe markets
    const isSafeForFun = (p) => !FUN_MARKET_BLACKLIST.includes(p.market);

    let funPool = [...valuePicks, ...upsidePicks].filter(isSafeForFun);
    funPool.sort((a,b) => b.telegram_score - a.telegram_score);

    // If we need more legs, add Core (excluding those used in smart combos? Maybe better to re-use if needed, but anti-correlation implies distinct matches in THE SAME combo. Across combos is debatable, but let's try to keep distinct if possible).
    // Let's just use all safe Core picks.
    const safeCore = corePicks.filter(isSafeForFun);

    // Combine: High Priority first
    let candidatesFun = [...funPool, ...safeCore];
    // Unique by fixture (just in case logic changes)
    candidatesFun = candidatesFun.filter((p, index, self) =>
        index === self.findIndex((t) => (t.fixture_id === p.fixture_id))
    );

    // Try to build 3 legs >= MIN_TOTAL
    // Simple greedy approach
    if (candidatesFun.length >= 3) {
        // Try top 3
        let legs = candidatesFun.slice(0, 3);
        let total = legs.reduce((acc, p) => acc * p.bookie_odd_num, 1);

        if (total < FUN_COMBO_MIN_TOTAL && candidatesFun.length >= 4) {
            // Try 4 legs
            legs = candidatesFun.slice(0, 4);
            total = legs.reduce((acc, p) => acc * p.bookie_odd_num, 1);
        }

        if (total >= FUN_COMBO_MIN_TOTAL) {
            funCombo = {
                legs: legs,
                total_odds: total,
                units: STAKE_FUN
            };
        }
    }

    const packObj = {
        core_singles: corePicks.map(p => formatPick(p)),
        smart_combos: smartCombos.map(c => ({
            legs: c.legs.map(l => formatPick(l, true)),
            total_odds: c.total_odds,
            units: c.units
        })),
        value_picks: valuePicks.map(p => formatPick(p)),
        upside_picks: upsidePicks.map(p => formatPick(p)),
        fun_combo: funCombo ? {
            legs: funCombo.legs.map(l => formatPick(l, true)),
            total_odds: funCombo.total_odds,
            units: funCombo.units
        } : null
    };

    const summaryStr = `${packObj.core_singles.length} Core + ${packObj.smart_combos.length} Smart Dbl + ${packObj.value_picks.length} Value + ${packObj.upside_picks.length} Upside + ${packObj.fun_combo ? "1 Fun" : "0 Fun"}`;

    const dayResult = {
        date: dayStr,
        summary: summaryStr,
        debug_stats: debugStats, // Include for analysis
        packs: packObj,
        telegram_text_block: ""
    };

    dayResult.telegram_text_block = buildTelegramBlock(dayResult);
    output.push(dayResult);
}

function formatPick(p, minimal = false) {
    const base = {
        fixture_id: p.fixture_id,
        match: `${p.home} vs ${p.away}`,
        market: p.market,
        selection: p.outcome, // Assuming input key is 'outcome'
        odds: p.bookie_odd_num,
        edge: p.edge_percent_num,
        rating: p.rating_score_num,
    };
    if (!minimal) {
        base.p = p.fair_prob_num;
        base.score = p.telegram_score;
        base.units = p.units;
    }
    return base;
}

return output;
