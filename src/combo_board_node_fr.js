
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

// FR Specific Blacklist
const MARKET_BLACKLIST_FR = ["Cards_", "Corners_"];

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

// === COMBO BOARD CONFIG ===

// 1. Safe Combo (2-3 legs, ~2.0-3.0)
const SAFE_COMBO_ODDS_MIN = 2.00;
const SAFE_COMBO_ODDS_MAX = 3.00;
const SAFE_COMBO_TARGET_COUNT = 2;

// 2. Balanced Combo (2-3 legs, ~3.0-5.0)
const BALANCED_COMBO_ODDS_MIN = 3.00;
const BALANCED_COMBO_ODDS_MAX = 5.00;
const BALANCED_COMBO_TARGET_COUNT = 2;

// 3. Booster Combo (3-4 legs, 8.0+)
const BOOSTER_COMBO_MIN_TOTAL = 8.00;
const BOOSTER_COMBO_TARGET_COUNT = 1;

// General Combo Rules
const FUN_MARKET_BLACKLIST = ["Exact_Goals_Match", "Exact_Goals_Home", "Exact_Goals_Away", "Exact_Goals_2H", "ht_ft", "Combo_Result_BTTS", "Combo_Result_Total", "Combo_TotalGoals_BTTS", "Winning_Margin"];

// ==================== // HELPERS // ====================

const parseNum = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return null;
    const str = String(val).replace(/[%]/g, '').replace(',', '.');
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

const generateComboId = (type, legs) => {
    // Stable ID based on type + sorted fixture IDs
    const sortedIds = legs.map(l => l.fixture_id).sort().join('-');
    return `${type}_GLOBAL_${sortedIds}`;
};

const buildBoardTelegramBlock = (combos) => {
    const lines = [];
    lines.push(`🧩 *Combo Board*`);
    lines.push("");

    // Safe Combos
    if (combos.safe && combos.safe.length > 0) {
        combos.safe.forEach((c, idx) => {
            const total = c.total_odds || 0;
            lines.push(`✅ *Safe Combo #${idx + 1}* — Total ${Number(total).toFixed(2)}`);
            c.legs.forEach(l => {
                const odd = l.odds || 0;
                lines.push(`  • ${l.match}: ${l.market} - ${l.selection} @ ${Number(odd).toFixed(2)}`);
            });
            lines.push("");
        });
    }

    // Balanced Combos
    if (combos.balanced && combos.balanced.length > 0) {
        combos.balanced.forEach((c, idx) => {
            const total = c.total_odds || 0;
            lines.push(`⚖️ *Balanced Combo #${idx + 1}* — Total ${Number(total).toFixed(2)}`);
            c.legs.forEach(l => {
                const odd = l.odds || 0;
                lines.push(`  • ${l.match}: ${l.market} - ${l.selection} @ ${Number(odd).toFixed(2)}`);
            });
            lines.push("");
        });
    }

    // Booster Combo
    if (combos.booster && combos.booster.length > 0) {
        combos.booster.forEach((c) => {
            const total = c.total_odds || 0;
            lines.push(`🎢 *Booster Combo* — Total ${Number(total).toFixed(2)}`);
            c.legs.forEach(l => {
                const odd = l.odds || 0;
                lines.push(`  • ${l.match}: ${l.market} - ${l.selection} @ ${Number(odd).toFixed(2)}`);
            });
            lines.push("");
        });
    }

    if (lines.length <= 2) lines.push("No combos available on the board today.");

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
    // 0. FR Market Safety (Cards / Corners)
    if (MARKET_BLACKLIST_FR.some(prefix => String(b.market).startsWith(prefix))) {
        return false;
    }

    if (b.fair_prob_num > PROB_CAP_GLOBAL) return false;
    if (b.bookie_odd_num < ODDS_FLOOR) return false;
    if (b.edge_percent_num < EDGE_FLOOR) return false;
    if (b.rating_score_num < RATING_FLOOR_GLOBAL) return false;
    if (b.overround_num !== null) {
        if (b.overround_num < OVERROUND_MIN || b.overround_num > OVERROUND_MAX) return false;
    }
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
    uniqueBets.push(group[0]);
}

debugStats.after_dedup = uniqueBets.length;

// --- Step D: Telegram Score ---
for (const b of uniqueBets) {
    let ts = b.rating_score_num;
    if (b.bookie_odd_num >= BONUS_ODDS_MIN && b.bookie_odd_num <= BONUS_ODDS_MAX && b.edge_percent_num >= BONUS_EDGE_MIN) ts += BONUS_SCORE;
    if (b.bookie_odd_num < PENALTY_ODDS_THRESH) ts -= PENALTY_SCORE;
    if (b.fair_prob_num >= SOFT_PENALTY_PROB) ts -= SOFT_PENALTY_SCORE;
    b.telegram_score = ts;
}

// --- Step E: Classification ---
const classified = uniqueBets.map(b => {
    let tier = "OTHER";
    if (
        b.bookie_odd_num >= UPSIDE_ODDS_MIN &&
        b.fair_prob_num >= UPSIDE_PROB_MIN &&
        b.edge_percent_num >= UPSIDE_EDGE_MIN &&
        b.rating_score_num >= UPSIDE_RATING_MIN
    ) {
        tier = "HIGH_UPSIDE";
    } else if (
        b.bookie_odd_num >= VALUE_ODDS_MIN &&
        b.fair_prob_num >= VALUE_PROB_MIN &&
        b.edge_percent_num >= VALUE_EDGE_MIN &&
        b.rating_score_num >= VALUE_RATING_MIN
    ) {
        tier = "VALUE";
    } else if (
        b.fair_prob_num >= CORE_PROB_MIN &&
        b.fair_prob_num <= CORE_PROB_MAX &&
        b.bookie_odd_num >= CORE_ODDS_MIN &&
        b.bookie_odd_num <= CORE_ODDS_MAX &&
        b.edge_percent_num >= CORE_EDGE_MIN &&
        b.rating_score_num >= CORE_RATING_MIN
    ) {
        tier = "CORE";
    }
    return { ...b, tier };
}).filter(b => b.tier !== "OTHER");

classified.forEach(b => {
    if (debugStats.classified_counts[b.tier] !== undefined) debugStats.classified_counts[b.tier]++;
});

// ==================== // GLOBAL COMBO GENERATION // ====================

// Flatten pools
const poolCore = classified.filter(p => p.tier === "CORE").sort((a,b) => b.telegram_score - a.telegram_score);
const poolValue = classified.filter(p => p.tier === "VALUE").sort((a,b) => b.telegram_score - a.telegram_score);
const poolUpside = classified.filter(p => p.tier === "HIGH_UPSIDE").sort((a,b) => b.telegram_score - a.telegram_score);

const safeCombos = [];
const balancedCombos = [];
const boosterCombos = [];

const usedFixtures = new Set(); // Global anti-correlation

// Helper: Check fixture availability
const areFixturesAvailable = (legs) => {
    for (const l of legs) {
        if (usedFixtures.has(l.fixture_id)) return false;
    }
    // Also check distinctness within the combo legs itself
    const ids = new Set(legs.map(l => l.fixture_id));
    return ids.size === legs.length;
};

// Helper: Mark used
const markUsed = (legs) => {
    legs.forEach(l => usedFixtures.add(l.fixture_id));
};

// --- 1. SAFE COMBOS (Core Only preferred) ---
// Strategy: Greedy pairs/triples from top Core
const poolSafe = [...poolCore]; // Clone

const findCombos = (pool, targetCount, oddsMin, oddsMax, minLegs, maxLegs) => {
    const found = [];

    // Attempt with minLegs first (e.g. 2)
    // Then try with minLegs+1 if needed

    // Simple exhaustive search for pairs
    if (minLegs === 2) {
        for (let i = 0; i < pool.length; i++) {
            if (found.length >= targetCount) break;
            if (usedFixtures.has(pool[i].fixture_id)) continue;

            for (let j = i + 1; j < pool.length; j++) {
                if (usedFixtures.has(pool[j].fixture_id)) continue;

                const l1 = pool[i];
                const l2 = pool[j];
                // Anti-correlation check internal
                if (l1.fixture_id === l2.fixture_id) continue;

                const total = l1.bookie_odd_num * l2.bookie_odd_num;
                if (total >= oddsMin && total <= oddsMax) {
                    const legs = [l1, l2];
                    found.push({ legs, total_odds: total });
                    markUsed(legs);
                    break; // Move to next primary candidate to spread out
                }
            }
        }
    }

    // If we need more and maxLegs >= 3, try triples
    if (found.length < targetCount && maxLegs >= 3) {
         for (let i = 0; i < pool.length; i++) {
            if (found.length >= targetCount) break;
            if (usedFixtures.has(pool[i].fixture_id)) continue;

            for (let j = i + 1; j < pool.length; j++) {
                if (usedFixtures.has(pool[j].fixture_id)) continue;
                for (let k = j + 1; k < pool.length; k++) {
                    if (usedFixtures.has(pool[k].fixture_id)) continue;

                    const l1 = pool[i], l2 = pool[j], l3 = pool[k];
                    if (l1.fixture_id === l2.fixture_id || l1.fixture_id === l3.fixture_id || l2.fixture_id === l3.fixture_id) continue;

                    const total = l1.bookie_odd_num * l2.bookie_odd_num * l3.bookie_odd_num;
                    if (total >= oddsMin && total <= oddsMax) {
                        const legs = [l1, l2, l3];
                        found.push({ legs, total_odds: total });
                        markUsed(legs);
                        break;
                    }
                }
                if (usedFixtures.has(pool[i].fixture_id)) break; // Stop using i if successful
                if (found.length >= targetCount) break;
            }
         }
    }
    return found;
};

const safes = findCombos(poolSafe, SAFE_COMBO_TARGET_COUNT, SAFE_COMBO_ODDS_MIN, SAFE_COMBO_ODDS_MAX, 2, 3);
safeCombos.push(...safes);

// --- 2. BALANCED COMBOS (Core + Value mixed) ---
// Pool: Remaining Core + All Value
const poolBalanced = [...poolCore.filter(p => !usedFixtures.has(p.fixture_id)), ...poolValue].sort((a,b) => b.telegram_score - a.telegram_score);

const balanceds = findCombos(poolBalanced, BALANCED_COMBO_TARGET_COUNT, BALANCED_COMBO_ODDS_MIN, BALANCED_COMBO_ODDS_MAX, 2, 3);
balancedCombos.push(...balanceds);

// --- 3. BOOSTER COMBO (Value + Upside mixed, blacklist safe) ---
const isSafeForBooster = (p) => !FUN_MARKET_BLACKLIST.includes(p.market);
// Pool: Remaining Value + All Upside + Remaining Core (as filler)
const poolBooster = [
    ...poolValue.filter(p => !usedFixtures.has(p.fixture_id)),
    ...poolUpside.filter(p => !usedFixtures.has(p.fixture_id)),
    ...poolCore.filter(p => !usedFixtures.has(p.fixture_id))
].filter(isSafeForBooster).sort((a,b) => b.telegram_score - a.telegram_score);

// Special finder for Booster (min total, not max)
const findBooster = () => {
    // Try 3 legs
    for (let i = 0; i < poolBooster.length; i++) {
        for (let j = i + 1; j < poolBooster.length; j++) {
            for (let k = j + 1; k < poolBooster.length; k++) {
                const legs = [poolBooster[i], poolBooster[j], poolBooster[k]];
                if (!areFixturesAvailable(legs)) continue; // Redundant if using fresh pool, but safe

                const total = legs.reduce((acc, l) => acc * l.bookie_odd_num, 1);
                if (total >= BOOSTER_COMBO_MIN_TOTAL) {
                    markUsed(legs);
                    return { legs, total_odds: total };
                }
            }
        }
    }
    // Try 4 legs
    for (let i = 0; i < poolBooster.length; i++) {
        for (let j = i + 1; j < poolBooster.length; j++) {
            for (let k = j + 1; k < poolBooster.length; k++) {
                 for (let l = k + 1; l < poolBooster.length; l++) {
                    const legs = [poolBooster[i], poolBooster[j], poolBooster[k], poolBooster[l]];
                    if (!areFixturesAvailable(legs)) continue;

                    const total = legs.reduce((acc, l) => acc * l.bookie_odd_num, 1);
                    if (total >= BOOSTER_COMBO_MIN_TOTAL) {
                        markUsed(legs);
                        return { legs, total_odds: total };
                    }
                 }
            }
        }
    }
    return null;
};

const booster = findBooster();
if (booster) boosterCombos.push(booster);


// ==================== // OUTPUT ASSEMBLY // ====================

const outputItems = [];

const combos = {
    safe: safeCombos.map(c => ({ ...c, legs: c.legs.map(l => formatPick(l, true)) })),
    balanced: balancedCombos.map(c => ({ ...c, legs: c.legs.map(l => formatPick(l, true)) })),
    booster: boosterCombos.map(c => ({ ...c, legs: c.legs.map(l => formatPick(l, true)) }))
};

const telegramText = buildBoardTelegramBlock(combos);

// 1. BOARD_SUMMARY
outputItems.push({
    type: "BOARD_SUMMARY",
    telegram_text: telegramText,
    stats: debugStats,
    generated_at: new Date().toISOString()
});

// 2. COMBO HEADERS & LEGS
const emitCombo = (c, type) => {
    const comboId = generateComboId(type, c.legs);
    outputItems.push({
        type: "COMBO_HEADER",
        combo_type: type,
        total_odds: c.total_odds,
        combo_id: comboId,
        legs_count: c.legs.length
    });
    c.legs.forEach(l => {
        outputItems.push({
            type: "COMBO_LEG",
            combo_id: comboId,
            ...formatPick(l, true)
        });
    });
};

safeCombos.forEach(c => emitCombo(c, "SAFE_COMBO"));
balancedCombos.forEach(c => emitCombo(c, "BALANCED_COMBO"));
boosterCombos.forEach(c => emitCombo(c, "BOOSTER_COMBO"));

// 3. RUN_STATS
outputItems.push({
    type: "RUN_STATS",
    ...debugStats,
    generated_at: new Date().toISOString()
});

// Post-Processing
const deepRemoveKey = (obj, key) => {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) return obj.forEach(x => deepRemoveKey(x, key));
  if (key in obj) delete obj[key];
  Object.values(obj).forEach(v => deepRemoveKey(v, key));
};
deepRemoveKey(outputItems, "units");

function formatPick(p, minimal = false) {
    let sel = p.outcome || p.selection;
    // Map 1X2 selections for display
    if (["1X2", "Corners_1X2", "Shots_1X2", "Cards_1X2"].includes(p.market)) {
        if (sel === "1") sel = "Home";
        else if (sel === "X") sel = "Draw";
        else if (sel === "2") sel = "Away";
    }

    const base = {
        fixture_id: p.fixture_id,
        match: `${p.home} vs ${p.away}`,
        market: p.market,
        selection: sel,
        odds: p.bookie_odd_num,
        edge: p.edge_percent_num,
        rating: p.rating_score_num,
        tier: p.tier
    };
    if (!minimal) {
        base.p = p.fair_prob_num;
        base.score = p.telegram_score;
    }
    return base;
}

return outputItems;
