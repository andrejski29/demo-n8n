
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
const MARKET_1H_PROB_MIN = 0.30;

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
const STAKE_CORE = 1.0;

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
const COMBO_USE_AFTER_TOP_CORE = 3;

// Mid Combo (2-3 legs)
const MID_COMBO_ODDS_MIN = 3.00;
const MID_COMBO_ODDS_MAX = 5.00;
const STAKE_MID = 0.33;

// Fun Combo (Treble/4-fold)
const FUN_COMBO_MIN_TOTAL = 8.00;
const FUN_COMBO_STRICT_TOTAL = 10.00;
const FUN_COMBO_MAX_LEGS = 4;
const FUN_COMBO_PREFERRED_LEGS = 3;
const STAKE_FUN = 0.25;
const FUN_MARKET_BLACKLIST = ["Exact_Goals_Match", "Exact_Goals_Home", "Exact_Goals_Away", "Exact_Goals_2H", "ht_ft", "Combo_Result_BTTS", "Combo_Result_Total", "Combo_TotalGoals_BTTS", "Winning_Margin"];

// ==================== // HELPERS // ====================

const parseNum = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return null;
    const str = String(val).replace(/[%]/g, '').replace(',', '.'); // Fix comma decimals
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

const generateComboId = (type, dayStr, legs) => {
    const sortedIds = legs.map(l => l.fixture_id).sort().join('-');
    return `${type}_${dayStr}_${sortedIds}`;
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
            // No stake display per request
            lines.push("");
        });
        if (extraCore.length > 0) {
            extraCore.forEach(p => {
                lines.push(`• ${p.match}: ${p.market} - ${p.selection} @ ${p.odds.toFixed(2)}`);
            });
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
            lines.push("");
        });
    }

    // Mid Combo
    if (dayObj.packs.mid_combo) {
        lines.push(`⚡ *MID COMBO (2-3 legs)*`);
        const c = dayObj.packs.mid_combo;
        c.legs.forEach(l => {
            lines.push(`• ${l.match}: ${l.market} - ${l.selection} @ ${l.odds.toFixed(2)}`);
        });
        lines.push(`  🚀 *Total Odds: ${c.total_odds.toFixed(2)}*`);
        lines.push("");
    }

    // Value Picks
    if (dayObj.packs.value_picks.length > 0) {
        lines.push(`💎 *VALUE SINGLES (Silver)*`);
        const topValue = dayObj.packs.value_picks.slice(0, 3);
        topValue.forEach(v => {
            lines.push(`• *${v.match}*`);
            lines.push(`  ${v.market} - ${v.selection} @ *${v.odds.toFixed(2)}*`);
            lines.push(`  Edge: ${v.edge}% | Prob: ${(v.p * 100).toFixed(1)}%`);
            lines.push("");
        });
    }

    // High Upside
    if (dayObj.packs.upside_picks.length > 0) {
        lines.push(`🚀 *HIGH UPSIDE (Longshots)*`);
        const topUpside = dayObj.packs.upside_picks.slice(0, 2);
        topUpside.forEach(u => {
            lines.push(`• ${u.match}: ${u.market} - ${u.selection} @ *${u.odds.toFixed(2)}*`);
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
            b.fair_prob_num < MARKET_1H_PROB_MIN) {
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
        b.bookie_odd_num >= VALUE_ODDS_MIN &&
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

    // 1. Smart Combo (Double) - Allow up to 2
    const smartCombos = [];
    const usedInSmartCombo = new Set();

    // Candidates: Core picks ranked 4+ (index 3+)
    const comboCandidates = corePicks.slice(COMBO_USE_AFTER_TOP_CORE).filter(p => p.fair_prob_num <= PROB_CAP_CORE);

    // Greedy search for pairs OPTIMIZED (max score sum)
    while (comboCandidates.length >= 2 && smartCombos.length < 2) {
        let bestPair = null;
        let bestScoreSum = -Infinity;

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
        } else {
            break;
        }
    }

    // 2. MID COMBO (2-3 legs, 3.0-5.0 odds)
    let midCombo = null;
    // Pool: CORE (rank 4+) + VALUE (preferred?)
    // Let's mix them. Candidates not already used in smart combos.

    const midCandidates = [...corePicks.slice(COMBO_USE_AFTER_TOP_CORE), ...valuePicks]
        .filter(p => !usedInSmartCombo.has(p.fixture_id))
        .sort((a,b) => b.telegram_score - a.telegram_score);

    // Helper search
    const findMidCombo = (legCount, strictConflict) => {
        let best = null;
        let maxScore = -Infinity;

        if (midCandidates.length < legCount) return null;

        // 2 legs
        if (legCount === 2) {
             for(let i=0; i<midCandidates.length; i++) {
                for(let j=i+1; j<midCandidates.length; j++) {
                    const p1 = midCandidates[i];
                    const p2 = midCandidates[j];
                    if (p1.fixture_id === p2.fixture_id) continue;

                    const total = p1.bookie_odd_num * p2.bookie_odd_num;
                    if (total >= MID_COMBO_ODDS_MIN && total <= MID_COMBO_ODDS_MAX) {
                         const score = p1.telegram_score + p2.telegram_score;
                         if (score > maxScore) {
                             maxScore = score;
                             best = { legs: [p1, p2], total_odds: total, units: STAKE_MID };
                         }
                    }
                }
             }
        } else if (legCount === 3) {
             for(let i=0; i<midCandidates.length; i++) {
                for(let j=i+1; j<midCandidates.length; j++) {
                    for(let k=j+1; k<midCandidates.length; k++) {
                        const legs = [midCandidates[i], midCandidates[j], midCandidates[k]];
                         // Distinct fixtures
                        const fids = new Set(legs.map(l => l.fixture_id));
                        if (fids.size !== 3) continue;

                        const total = legs.reduce((acc,p)=>acc*p.bookie_odd_num, 1);
                        if (total >= MID_COMBO_ODDS_MIN && total <= MID_COMBO_ODDS_MAX) {
                            const score = legs.reduce((acc,p)=>acc+p.telegram_score, 0);
                            if (score > maxScore) {
                                maxScore = score;
                                best = { legs, total_odds: total, units: STAKE_MID };
                            }
                        }
                    }
                }
             }
        }
        return best;
    }

    // Pass 1: Try 2 legs
    midCombo = findMidCombo(2);
    // Pass 2: Try 3 legs (fallback)
    if (!midCombo) midCombo = findMidCombo(3);

    // Track used in mid combo to avoid in fun combo?
    const usedInMidCombo = new Set();
    if (midCombo) {
        midCombo.legs.forEach(l => usedInMidCombo.add(l.fixture_id));
    }

    // 3. Fun Combo (Treble/4-fold)
    let funCombo = null;
    const isSafeForFun = (p) => !FUN_MARKET_BLACKLIST.includes(p.market);
    const preferredPool = [...valuePicks, ...upsidePicks].filter(isSafeForFun);
    const backfillPool = corePicks.filter(isSafeForFun);
    const mustIncludePreferred = preferredPool.length > 0;

    const TOP_N_SEARCH = 12;
    const allFunCandidates = [...preferredPool, ...backfillPool]
        .sort((a,b) => b.telegram_score - a.telegram_score)
        .slice(0, TOP_N_SEARCH);

    const checkFunValidity = (legs, strictConflict = true) => {
        const fids = new Set(legs.map(l => l.fixture_id));
        if (fids.size !== legs.length) return false;

        // Conflict with Smart OR Mid?
        // User said: "Avoid reuse of fixtures used in Smart Combos". Didn't mention Mid explicitly but safer to avoid.
        // Let's combine conflicts
        let conflicts = 0;
        legs.forEach(l => {
            if (usedInSmartCombo.has(l.fixture_id) || usedInMidCombo.has(l.fixture_id)) conflicts++;
        });

        if (strictConflict && conflicts > 0) return false;

        if (mustIncludePreferred) {
            const hasPref = legs.some(l => l.tier === "VALUE" || l.tier === "HIGH_UPSIDE");
            if (!hasPref) return false;
        }
        return { valid: true, conflicts };
    };

    const findBestCombo = (legCount, strictConflict) => {
        let best = null;
        let maxScore = -Infinity;

        if (legCount === 3) {
            for(let i=0; i<allFunCandidates.length; i++) {
                for(let j=i+1; j<allFunCandidates.length; j++) {
                    for(let k=j+1; k<allFunCandidates.length; k++) {
                        const legs = [allFunCandidates[i], allFunCandidates[j], allFunCandidates[k]];
                        const total = legs.reduce((acc,p)=>acc*p.bookie_odd_num, 1);
                        if (total >= FUN_COMBO_MIN_TOTAL) {
                            const check = checkFunValidity(legs, strictConflict);
                            if (check && check.valid) {
                                const score = legs.reduce((acc,p)=>acc+p.telegram_score, 0);
                                if (score > maxScore) {
                                    maxScore = score;
                                    best = { legs, total_odds: total, units: STAKE_FUN };
                                }
                            }
                        }
                    }
                }
            }
        } else if (legCount === 4) {
             for(let i=0; i<allFunCandidates.length; i++) {
                for(let j=i+1; j<allFunCandidates.length; j++) {
                    for(let k=j+1; k<allFunCandidates.length; k++) {
                        for(let l=k+1; l<allFunCandidates.length; l++) {
                            const legs = [allFunCandidates[i], allFunCandidates[j], allFunCandidates[k], allFunCandidates[l]];
                            const total = legs.reduce((acc,p)=>acc*p.bookie_odd_num, 1);
                            if (total >= FUN_COMBO_MIN_TOTAL) {
                                const check = checkFunValidity(legs, strictConflict);
                                if (check && check.valid) {
                                    const score = legs.reduce((acc,p)=>acc+p.telegram_score, 0);
                                    if (score > maxScore) {
                                        maxScore = score;
                                        best = { legs, total_odds: total, units: STAKE_FUN };
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        return best;
    };

    // 2-Pass Search
    // Pass A: 3 legs, Strict Conflict Check
    if (allFunCandidates.length >= 3) {
        funCombo = findBestCombo(3, true);
    }

    // Pass B: 3 legs, Allow Conflicts (fallback)
    if (!funCombo && allFunCandidates.length >= 3) {
        funCombo = findBestCombo(3, false);
    }

    // Pass C: 4 legs, Strict Conflict Check (Only if 3 failed to meet odds or non-existent)
    if (!funCombo && allFunCandidates.length >= 4) {
        funCombo = findBestCombo(4, true);
    }

    // Pass D: 4 legs, Allow Conflicts
    if (!funCombo && allFunCandidates.length >= 4) {
        funCombo = findBestCombo(4, false);
    }

    const packObj = {
        core_singles: corePicks.map(p => formatPick(p)),
        smart_combos: smartCombos.map(c => ({
            legs: c.legs.map(l => formatPick(l, true)),
            total_odds: c.total_odds,
            units: c.units
        })),
        mid_combo: midCombo ? {
             legs: midCombo.legs.map(l => formatPick(l, true)),
             total_odds: midCombo.total_odds,
             units: midCombo.units
        } : null,
        value_picks: valuePicks.map(p => formatPick(p)),
        upside_picks: upsidePicks.map(p => formatPick(p)),
        fun_combo: funCombo ? {
            legs: funCombo.legs.map(l => formatPick(l, true)),
            total_odds: funCombo.total_odds,
            units: funCombo.units
        } : null
    };

    const summaryStr = `${packObj.core_singles.length} Core + ${packObj.smart_combos.length} Smart Dbl + ${packObj.mid_combo ? "1 Mid" : "0 Mid"} + ${packObj.value_picks.length} Value + ${packObj.upside_picks.length} Upside + ${packObj.fun_combo ? "1 Fun" : "0 Fun"}`;

    const dayResult = {
        date: dayStr,
        summary: summaryStr,
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
        stats: debugStats,
        generated_at: new Date().toISOString()
    });

    // 2. PICKS
    const emitPick = (p, packType) => {
        flattenedItems.push({
            type: "PICK",
            pack_type: packType,
            date: dayStr,
            ...p
        });
    };

    packObj.core_singles.forEach(p => emitPick(p, "CORE"));
    packObj.value_picks.forEach(p => emitPick(p, "VALUE"));
    packObj.upside_picks.forEach(p => emitPick(p, "HIGH_UPSIDE"));

    // 3. COMBOS
    const emitCombo = (c, type) => {
        const comboId = generateComboId(type, dayStr, c.legs);
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
    if (packObj.mid_combo) emitCombo(packObj.mid_combo, "MID_COMBO");
    if (packObj.fun_combo) emitCombo(packObj.fun_combo, "FUN_COMBO");
}

// 4. RUN_STATS
flattenedItems.push({
    type: "RUN_STATS",
    ...debugStats,
    generated_at: new Date().toISOString()
});

// Post-Processing: Sanitize Units from Output
const deepRemoveKey = (obj, key) => {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) return obj.forEach(x => deepRemoveKey(x, key));
  if (key in obj) delete obj[key];
  Object.values(obj).forEach(v => deepRemoveKey(v, key));
};

deepRemoveKey(flattenedItems, "units");

function formatPick(p, minimal = false) {
    const base = {
        fixture_id: p.fixture_id,
        match: `${p.home} vs ${p.away}`,
        market: p.market,
        selection: p.outcome, // Assuming input key is 'outcome'
        odds: p.bookie_odd_num,
        edge: p.edge_percent_num,
        rating: p.rating_score_num,
        tier: p.tier // Added for analytics
    };
    if (!minimal) {
        base.p = p.fair_prob_num;
        base.score = p.telegram_score;
        base.units = p.units;
    }
    return base;
}

return flattenedItems;
