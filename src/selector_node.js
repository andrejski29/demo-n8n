
// ==================== // CONFIG & THRESHOLDS // ====================

const PROB_CAP_GLOBAL = 0.95;
const PROB_CAP_CORE = 0.90;

const ODDS_FLOOR = 1.40;
const EDGE_FLOOR = 15;
const RATING_FLOOR_GLOBAL = 48;

const OVERROUND_MIN = 1.00;
const OVERROUND_MAX = 1.12;

// Market Gates
const MARKET_1H_ODDS_MIN = 2.20;
const MARKET_1H_EDGE_MIN = 30;
const MARKET_1H_RATING_MIN = 48;
const MARKET_1H_PROB_MIN = 0.30; // Added Prob Floor for 1X2_1H

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
const CORE_RATING_MIN = 48;
const STAKE_CORE = 1.0; // Confirmed 1.0u

// Classification - VALUE (Silver)
const VALUE_ODDS_MIN = 2.20;
const VALUE_PROB_MIN = 0.35;
const VALUE_EDGE_MIN = 30;
const VALUE_RATING_MIN = 48;
const STAKE_VALUE = 0.5;

// Classification - HIGH_UPSIDE
const UPSIDE_ODDS_MIN = 3.00;
const UPSIDE_PROB_MIN = 0.295;
const UPSIDE_EDGE_MIN = 30;
const UPSIDE_RATING_MIN = 48;
const STAKE_UPSIDE = 0.25;

// Smart Combo (Double)
const COMBO_ODDS_MIN = 2.10;
const COMBO_ODDS_MAX = 3.00;
const STAKE_COMBO = 0.5;
const COMBO_USE_AFTER_TOP_CORE = 3; // Use core picks ranked 4+

// Fun Combo (Treble/4-fold)
const FUN_COMBO_MIN_TOTAL = 8.00; // Default 8.0
const FUN_COMBO_STRICT_TOTAL = 10.00; // Switchable
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
    // We display "Top 3" specifically, then mention others?
    // Spec: "Output core_singles as ALL core picks... Telegram block can show Top 3 + Others"
    // Let's list top 3 full details, then just count.
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
            b.rating_score_num < MARKET_1H_RATING_MIN ||
            b.fair_prob_num < MARKET_1H_PROB_MIN) { // Added Prob Floor
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

// --- Step E: Classification (3 Tiers - Odds First) ---
const classified = uniqueBets.map(b => {
    let tier = "OTHER";
    let units = 0;

    // 1. HIGH_UPSIDE (Risky / Longshot)
    if (
        b.bookie_odd_num >= UPSIDE_ODDS_MIN &&
        b.fair_prob_num >= UPSIDE_PROB_MIN &&
        b.edge_percent_num >= UPSIDE_EDGE_MIN &&
        b.rating_score_num >= UPSIDE_RATING_MIN
    ) {
        tier = "HIGH_UPSIDE";
        units = STAKE_UPSIDE;
    }
    // 2. VALUE (Silver) - Higher Odds/Edge
    else if (
        b.bookie_odd_num >= VALUE_ODDS_MIN && // Fixed > to >=
        b.fair_prob_num >= VALUE_PROB_MIN &&
        b.edge_percent_num >= VALUE_EDGE_MIN &&
        b.rating_score_num >= VALUE_RATING_MIN
    ) {
        tier = "VALUE";
        units = STAKE_VALUE;
    }
    // 3. CORE (Gold) - Stable
    else if (
        b.fair_prob_num >= CORE_PROB_MIN &&
        b.fair_prob_num <= CORE_PROB_MAX &&
        b.bookie_odd_num >= CORE_ODDS_MIN &&
        b.bookie_odd_num <= CORE_ODDS_MAX &&
        b.edge_percent_num >= CORE_EDGE_MIN &&
        b.rating_score_num >= CORE_RATING_MIN
    ) {
        tier = "CORE";
        units = STAKE_CORE;
    }

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

// Flattened output accumulator
const flattenedItems = [];

for (const dayStr in days) {
    const dayPicks = days[dayStr];

    // Sort all by telegram_score desc
    dayPicks.sort((a, b) => b.telegram_score - a.telegram_score);

    const corePicks = dayPicks.filter(p => p.tier === "CORE");
    const valuePicks = dayPicks.filter(p => p.tier === "VALUE");
    const upsidePicks = dayPicks.filter(p => p.tier === "HIGH_UPSIDE");

    // 1. Core Singles
    // Use ALL core picks

    // 2. Smart Combo (Double) - Allow up to 2
    const smartCombos = [];
    const usedInSmartCombo = new Set();

    // Candidates: Core picks ranked 4+ (index 3+)
    // If fewer than COMBO_USE_AFTER_TOP_CORE, we might have no candidates for combo if strictly following rule
    // "Build smart combos after top CORE singles (configurable)"
    const comboCandidates = corePicks.slice(COMBO_USE_AFTER_TOP_CORE).filter(p => p.fair_prob_num <= PROB_CAP_CORE);

    // Greedy search for pairs OPTIMIZED (max score sum)
    while (comboCandidates.length >= 2 && smartCombos.length < 2) {
        let bestPair = null;
        let bestScoreSum = -Infinity;
        let p1Index = -1;
        let p2Index = -1;

        for (let i = 0; i < comboCandidates.length; i++) {
            if (usedInSmartCombo.has(comboCandidates[i].fixture_id)) continue;
            for (let j = i + 1; j < comboCandidates.length; j++) {
                if (usedInSmartCombo.has(comboCandidates[j].fixture_id)) continue;

                const p1 = comboCandidates[i];
                const p2 = comboCandidates[j];

                // Anti-correlation: Fixtures must be distinct
                if (p1.fixture_id === p2.fixture_id) continue;

                const total = p1.bookie_odd_num * p2.bookie_odd_num;
                if (total >= COMBO_ODDS_MIN && total <= COMBO_ODDS_MAX) {
                    const s = p1.telegram_score + p2.telegram_score;
                    if (s > bestScoreSum) {
                        bestScoreSum = s;
                        bestPair = [p1, p2];
                        p1Index = i;
                        p2Index = j;
                    }
                }
            }
        }

        if (bestPair) {
            smartCombos.push({
                legs: bestPair,
                total_odds: bestPair[0].bookie_odd_num * bestPair[1].bookie_odd_num,
                units: STAKE_COMBO
            });
            usedInSmartCombo.add(bestPair[0].fixture_id);
            usedInSmartCombo.add(bestPair[1].fixture_id);
            // Remove used from candidates to avoid re-checking?
            // Or just rely on usedInSmartCombo set. Set is cleaner.
        } else {
            break; // No valid pairs found
        }
    }

    // 3. Fun Combo (Treble/4-fold)
    let funCombo = null;

    // Pool: VALUE + HIGH_UPSIDE (Preferred) + CORE (Backfill)
    const isSafeForFun = (p) => !FUN_MARKET_BLACKLIST.includes(p.market);

    const preferredPool = [...valuePicks, ...upsidePicks].filter(isSafeForFun);
    const backfillPool = corePicks.filter(isSafeForFun); // Can use any core? Yes.

    // Requirement: "Require at least 1 VALUE or HIGH_UPSIDE leg if there is at least one available"
    const mustIncludePreferred = preferredPool.length > 0;

    // Combine for search
    // We want to maximize score sum given constraints.
    // Full search might be expensive if many picks. Bounded search: Top N.
    const TOP_N_SEARCH = 12;
    const allFunCandidates = [...preferredPool, ...backfillPool]
        .sort((a,b) => b.telegram_score - a.telegram_score)
        .slice(0, TOP_N_SEARCH); // Optimization

    // Bounded Search 3 or 4 legs
    let bestFun = null;
    let bestFunScore = -Infinity;

    // Helper to check combo validity
    const checkFunValidity = (legs) => {
        // Distinct fixtures?
        const fids = new Set(legs.map(l => l.fixture_id));
        if (fids.size !== legs.length) return false;

        // "Avoid reuse of fixture_id already used in smart_combos" (Soft Rule)
        // Let's count conflicts. If possible, 0 conflicts.
        const conflicts = legs.filter(l => usedInSmartCombo.has(l.fixture_id)).length;

        // "Require at least 1 VALUE/UPSIDE"
        if (mustIncludePreferred) {
            const hasPref = legs.some(l => l.tier === "VALUE" || l.tier === "HIGH_UPSIDE");
            if (!hasPref) return false;
        }

        return { valid: true, conflicts };
    };

    // Try 3 legs first
    if (allFunCandidates.length >= 3) {
        // Simple combinations logic 3 loops
        for(let i=0; i<allFunCandidates.length; i++) {
            for(let j=i+1; j<allFunCandidates.length; j++) {
                for(let k=j+1; k<allFunCandidates.length; k++) {
                    const legs = [allFunCandidates[i], allFunCandidates[j], allFunCandidates[k]];
                    const total = legs.reduce((acc,p)=>acc*p.bookie_odd_num, 1);

                    if (total >= FUN_COMBO_MIN_TOTAL) {
                        const check = checkFunValidity(legs);
                        if (check && check.valid) {
                            // Penalty for conflicts?
                            const score = legs.reduce((acc,p)=>acc+p.telegram_score, 0) - (check.conflicts * 50); // Heavy penalty
                            if (score > bestFunScore) {
                                bestFunScore = score;
                                bestFun = { legs, total_odds: total, units: STAKE_FUN };
                            }
                        }
                    }
                }
            }
        }
    }

    // If 3 legs didn't yield result (or low score), try 4 legs?
    // Spec: "3 legs preferred, 4 only if needed". "Objective: maximize sum".
    // If we found a 3-leg, we usually stick to it unless 4-leg is strictly required to meet odds.
    // If `bestFun` is null (no 3-leg met odds), try 4.
    if (!bestFun && allFunCandidates.length >= 4) {
         for(let i=0; i<allFunCandidates.length; i++) {
            for(let j=i+1; j<allFunCandidates.length; j++) {
                for(let k=j+1; k<allFunCandidates.length; k++) {
                    for(let l=k+1; l<allFunCandidates.length; l++) {
                        const legs = [allFunCandidates[i], allFunCandidates[j], allFunCandidates[k], allFunCandidates[l]];
                        const total = legs.reduce((acc,p)=>acc*p.bookie_odd_num, 1);

                        if (total >= FUN_COMBO_MIN_TOTAL) {
                            const check = checkFunValidity(legs);
                            if (check && check.valid) {
                                const score = legs.reduce((acc,p)=>acc+p.telegram_score, 0) - (check.conflicts * 50);
                                if (score > bestFunScore) {
                                    bestFunScore = score;
                                    bestFun = { legs, total_odds: total, units: STAKE_FUN };
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Final check: if no funnel found valid pair due to "Preferred" constraint, fallback to any?
    // User said: "If none exist, allow CORE-only fallback."
    // Logic: `mustIncludePreferred` handles existence. If none exist, flag is false, core-only allowed.
    // If they existed but didn't fit odds/fixtures? Then `bestFun` remains null.

    funCombo = bestFun;

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
        // debug_stats: debugStats, // Removed from per-day object to avoid repetition
        packs: packObj,
        telegram_text_block: ""
    };

    dayResult.telegram_text_block = buildTelegramBlock(dayResult);

    // --- FLATTENING for DB Storage ---

    // 1. DAY_SUMMARY
    flattenedItems.push({
        type: "DAY_SUMMARY",
        date: dayStr,
        summary: summaryStr,
        telegram_text: dayResult.telegram_text_block,
        stats: debugStats, // Include stats once per day summary if needed, or globally
        generated_at: new Date().toISOString()
    });

    // 2. PICKS (CORE, VALUE, UPSIDE)
    const emitPick = (p, packType) => {
        flattenedItems.push({
            type: "PICK",
            pack_type: packType, // CORE, VALUE, HIGH_UPSIDE
            date: dayStr,
            ...p
        });
    };

    packObj.core_singles.forEach(p => emitPick(p, "CORE"));
    packObj.value_picks.forEach(p => emitPick(p, "VALUE"));
    packObj.upside_picks.forEach(p => emitPick(p, "HIGH_UPSIDE"));

    // 3. COMBOS
    const emitCombo = (c, type) => {
        const comboId = `${type}_${dayStr}_${Math.random().toString(36).substr(2, 5)}`; // Simple ID
        flattenedItems.push({
            type: "COMBO_HEADER",
            combo_type: type,
            date: dayStr,
            total_odds: c.total_odds,
            units: c.units,
            combo_id: comboId,
            legs_count: c.legs.length
        });
        c.legs.forEach(l => {
            flattenedItems.push({
                type: "COMBO_LEG",
                combo_id: comboId,
                date: dayStr,
                ...l
            });
        });
    };

    packObj.smart_combos.forEach(c => emitCombo(c, "SMART_COMBO"));
    if (packObj.fun_combo) emitCombo(packObj.fun_combo, "FUN_COMBO");
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

return flattenedItems;
