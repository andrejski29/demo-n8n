/**
 * Home Team Normalization Module V2 (n8n / Standalone)
 *
 * Objectives:
 * 1. Robust Row Selection (Domestic League priority).
 * 2. Two-Layer Normalization (Core + Extras Feature Store).
 * 3. Consistent Naming (_mu).
 * 4. Strict 0-1 Percent Normalization (by Key Name).
 * 5. Robust Fallbacks for Missing Keys.
 */

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function normalizeHomeTeam(inputData) {
    // 1. Deterministic Row Selection
    const { current, previous, source } = _selectSeasons(inputData);

    if (!current || !current.id) return null;

    const meta = {
        id: current.id,
        name: current.name || current.english_name,
        season: current.season,
        season_format: current.season_format || "Unknown",
        competition_id: current.competition_id,
        country: current.country,
        season_source: source
    };

    // 2. Process Seasons (Core Stats)
    const qualityContext = { missing_fields: [] };
    const currentStats = _processSeason(current, qualityContext);
    const previousStats = previous ? _processSeason(previous, { missing_fields: [] }) : null;

    // 3. Quality & Sample Sizes
    const quality = _calculateQuality(current.stats || {}, meta, qualityContext.missing_fields);

    // 4. Extras (Rich Features from Current Season)
    const extras = _extractExtras(current.stats || {}, current.additional_info || {});

    // 5. Structure Output
    return {
        team_id: meta.id,
        team_name: meta.name,
        meta: meta,
        quality: quality,
        season: {
            current: currentStats,
            previous: previousStats
        },
        form: {
            last5: null, // Placeholder
            last10: null // Placeholder
        },
        extras: extras
    };
}

// ============================================================================
// ROW SELECTION
// ============================================================================

function _selectSeasons(data) {
    if (!Array.isArray(data)) {
        return {
            current: data,
            previous: null,
            source: { current: _makeSourceMeta(data, 0), previous: null }
        };
    }

    const seasons = {};
    data.forEach((row, index) => {
        if (!row.season) return;
        if (!seasons[row.season]) seasons[row.season] = [];
        seasons[row.season].push({ ...row, _original_index: index });
    });

    const sortedYears = Object.keys(seasons).sort((a, b) => {
        const startA = parseInt(a.split('/')[0]) || 0;
        const startB = parseInt(b.split('/')[0]) || 0;
        return startB - startA;
    });

    const currentYear = sortedYears[0];
    const previousYear = sortedYears[1];

    const getBestRow = (rows) => {
        if (!rows || rows.length === 0) return null;
        const domestic = rows.find(r => r.season_format === "Domestic League");
        return domestic || rows[0];
    };

    const currentRow = getBestRow(seasons[currentYear]);
    const previousRow = getBestRow(seasons[previousYear]);

    return {
        current: currentRow,
        previous: previousRow,
        source: {
            current: currentRow ? _makeSourceMeta(currentRow, currentRow._original_index) : null,
            previous: previousRow ? _makeSourceMeta(previousRow, previousRow._original_index) : null
        }
    };
}

function _makeSourceMeta(row, index) {
    return {
        season: row.season,
        season_format: row.season_format,
        competition_id: row.competition_id,
        row_index: index
    };
}

// ============================================================================
// CORE PROCESSING (Layer A)
// ============================================================================

function _processSeason(teamRaw, context) {
    const s = teamRaw.stats || {};
    const missing = context.missing_fields || [];

    const _get = (key, fallback = 0, critical = false) => {
        if (s[key] === undefined || s[key] === null) {
            if (critical) missing.push(key);
            return fallback;
        }
        return _num(s[key]);
    };

    // Percent Helper: Extracts & Normalizes 0-1
    const _p = (key) => _pct(s, key);

    const stats = {
        matches: {
            overall: _get('seasonMatchesPlayed_overall', 0, true),
            home: _get('seasonMatchesPlayed_home', 0, true),
            away: _get('seasonMatchesPlayed_away', 0)
        },
        goals: {
            scored_avg_overall: _get('seasonScoredAVG_overall'),
            conceded_avg_overall: _get('seasonConcededAVG_overall'),
            scored_avg_home: _get('seasonScoredAVG_home', 0, true),
            conceded_avg_home: _get('seasonConcededAVG_home', 0, true),
            scored_avg_away: _get('seasonScoredAVG_away'),
            conceded_avg_away: _get('seasonConcededAVG_away'),
            // Halves
            ht_scored_avg_home: _get('scoredAVGHT_home'),
            ht_conceded_avg_home: _get('concededAVGHT_home'),
            sh_scored_avg_home: _get('scored_2hg_avg_home'),
            sh_conceded_avg_home: _get('conceded_2hg_avg_home')
        },
        xg: {
            for_avg_overall: _get('xg_for_avg_overall'),
            against_avg_overall: _get('xg_against_avg_overall'),
            for_avg_home: _get('xg_for_avg_home'),
            against_avg_home: _get('xg_against_avg_home')
        },
        corners: {
            total_avg_home: _get('cornersTotalAVG_home') || (_get('cornersAVG_home') + _get('cornersAgainstAVG_home')),
            for_avg_home: _get('cornersAVG_home'),
            against_avg_home: _get('cornersAgainstAVG_home')
        },
        cards: {
            total_avg_home: _get('cardsTotalAVG_home') || _get('cards_total_avg_home') || (_get('cardsAVG_home') + _get('cardsAgainstAVG_home')),
            avg_home: _get('cardsAVG_home'),
            against_avg_home: _get('cardsAgainstAVG_home')
        },
        game_state: {
            ppg_home: _get('seasonPPG_home'),
            clean_sheet_pct_home: _p('seasonCSPercentage_home'),
            failed_to_score_pct_home: _p('seasonFTSPercentage_home'),
            btts_pct_home: _p('seasonBTTSPercentage_home')
        }
    };

    const derived = {
        goals_total_mu_home: _safeSum(stats.goals.scored_avg_home, stats.goals.conceded_avg_home),
        goals_total_mu_overall: _safeSum(stats.goals.scored_avg_overall, stats.goals.conceded_avg_overall),
        ht_goals_mu_home: _safeSum(stats.goals.ht_scored_avg_home, stats.goals.ht_conceded_avg_home),
        sh_goals_mu_home: _safeSum(stats.goals.sh_scored_avg_home, stats.goals.sh_conceded_avg_home),
        corners_total_mu_home: stats.corners.total_avg_home,
        cards_total_mu_home: stats.cards.total_avg_home
    };

    return { ...stats, derived };
}

// ============================================================================
// EXTRAS PROCESSING (Layer B)
// ============================================================================

function _extractExtras(s, addInfo) {
    // Merge stats and additional_info for easier access if needed,
    // though most keys are in stats.
    const combined = { ...s, ...addInfo };

    return {
        performance: _mapPerformance(combined),
        game_state: _mapGameState(combined),
        first_goal: _mapFirstGoal(combined),

        goals: {
            ou_ft: _mapThresholds(combined, 'seasonOver', 'Percentage', ['05', '15', '25', '35', '45', '55']),
            ou_ht: _mapThresholds(combined, 'seasonOver', 'PercentageHT', ['05', '15', '25']),
            timing: _mapGoalTiming(combined),
            scored_both_halves_pct: {
                 home: _pct(combined, 'scoredBothHalvesPercentage_home'),
                 overall: _pct(combined, 'scoredBothHalvesPercentage_overall')
            }
        },

        second_half: _map2HStats(combined),

        corners: {
            totals: _mapThresholds(combined, 'over', 'CornersPercentage', ['65', '75', '85', '95', '105', '115', '125']),
            for: _mapThresholds(combined, 'over', 'CornersForPercentage', ['25', '35', '45', '55', '65']),
            against: _mapThresholds(combined, 'over', 'CornersAgainstPercentage', ['25', '35', '45', '55', '65']),
            halves: _mapCornerHalves(combined)
        },

        cards: {
            totals: _mapThresholds(combined, 'over', 'CardsPercentage', ['05', '15', '25', '35', '45', '55', '65']),
            for: _mapThresholds(combined, 'over', 'CardsForPercentage', ['05', '15', '25', '35']),
            against: _mapThresholds(combined, 'over', 'CardsAgainstPercentage', ['05', '15', '25', '35'])
        },

        combo: _mapComboStats(combined),
        shots: _mapShots(combined),
        pressure: _mapPressure(combined),
        discipline: _mapDiscipline(combined)
    };
}

// -- Mappers --

function _mapPerformance(s) {
    return {
        win_pct: { home: _pct(s, 'winPercentage_home'), overall: _pct(s, 'winPercentage_overall') },
        draw_pct: { home: _pct(s, 'drawPercentage_home'), overall: _pct(s, 'drawPercentage_overall') },
        loss_pct: { home: _pct(s, 'losePercentage_home'), overall: _pct(s, 'losePercentage_overall') },
        ppg: { home: _num(s.seasonPPG_home), overall: _num(s.seasonPPG_overall) }
    };
}

function _mapGameState(s) {
    return {
        ht_ppg: { home: _num(s.HTPPG_home), overall: _num(s.HTPPG_overall) },
        leading_at_ht_pct: { home: _pct(s, 'leadingAtHTPercentage_home'), overall: _pct(s, 'leadingAtHTPercentage_overall') },
        drawing_at_ht_pct: { home: _pct(s, 'drawingAtHTPercentage_home'), overall: _pct(s, 'drawingAtHTPercentage_overall') },
        trailing_at_ht_pct: { home: _pct(s, 'trailingAtHTPercentage_home'), overall: _pct(s, 'trailingAtHTPercentage_overall') }
    };
}

function _mapFirstGoal(s) {
    return {
        scored_pct: { home: _pct(s, 'firstGoalScoredPercentage_home'), overall: _pct(s, 'firstGoalScoredPercentage_overall') }
    };
}

function _mapGoalTiming(s) {
    // Buckets: 0-15, 16-30 ...
    const buckets = ['0_15', '16_30', '31_45', '46_60', '61_75', '76_90'];
    const out = { scored: { home: {}, overall: {} }, conceded: { home: {}, overall: {} } };

    buckets.forEach(b => {
        const keyMid = b.replace('_', '_to_'); // 0_15 -> 0_to_15
        out.scored.home[b] = _num(s[`goals_scored_min_${keyMid}_home`]);
        out.scored.overall[b] = _num(s[`goals_scored_min_${keyMid}`] || s[`goals_scored_min_${keyMid}_overall`]);

        out.conceded.home[b] = _num(s[`goals_conceded_min_${keyMid}_home`]);
        out.conceded.overall[b] = _num(s[`goals_conceded_min_${keyMid}`] || s[`goals_conceded_min_${keyMid}_overall`]);
    });
    return out;
}

function _map2HStats(s) {
    return {
        goals: {
            scored_avg_home: _num(s.scored_2hg_avg_home),
            conceded_avg_home: _num(s.conceded_2hg_avg_home),
            total_avg_home: _num(s.AVG_2hg_home)
        },
        ou: _mapThresholds(s, 'over', '_2hg_percentage', ['05', '15', '25']),
        clean_sheet_pct_home: _pct(s, 'cs_2hg_percentage_home'),
        failed_to_score_pct_home: _pct(s, 'fts_2hg_percentage_home'),
        btts_pct_home: _pct(s, 'btts_2hg_percentage_home'),
        btts_fhg_pct_home: _pct(s, 'btts_fhg_percentage_home'),
        btts_both_halves_pct_home: _pct(s, 'BTTS_both_halves_percentage_home')
    };
}

function _mapComboStats(s) {
    return {
        btts_win: { home: _pct(s, 'BTTS_and_win_percentage_home'), overall: _pct(s, 'BTTS_and_win_percentage_overall') },
        btts_draw: { home: _pct(s, 'BTTS_and_draw_percentage_home'), overall: _pct(s, 'BTTS_and_draw_percentage_overall') },
        btts_lose: { home: _pct(s, 'BTTS_and_lose_percentage_home'), overall: _pct(s, 'BTTS_and_lose_percentage_overall') }
    };
}

function _mapShots(s) {
    return {
        total_avg: { home: _num(s.shotsAVG_home), overall: _num(s.shotsAVG_overall) },
        on_target_avg: { home: _num(s.shotsOnTargetAVG_home), overall: _num(s.shotsOnTargetAVG_overall) },
        off_target_avg: { home: _num(s.shotsOffTargetAVG_home), overall: _num(s.shotsOffTargetAVG_overall) }
    };
}

function _mapPressure(s) {
    return {
        attacks_avg: { home: _num(s.attacks_avg_home), overall: _num(s.attacks_avg_overall) },
        dangerous_attacks_avg: { home: _num(s.dangerous_attacks_avg_home), overall: _num(s.dangerous_attacks_avg_overall) }
    };
}

function _mapDiscipline(s) {
    return {
        fouls_avg: { home: _num(s.foulsAVG_home), overall: _num(s.foulsAVG_overall) },
        possession_avg: { home: _num(s.possessionAVG_home), overall: _num(s.possessionAVG_overall) },
        offsides: {
            match_avg: { home: _num(s.offsidesAVG_home), overall: _num(s.offsidesAVG_overall) },
            team_avg: { home: _num(s.offsidesTeamAVG_home), overall: _num(s.offsidesTeamAVG_overall) },
            match_over_pct: _mapThresholds(s, 'over', 'OffsidesPercentage', ['05', '15', '25', '35', '45']),
            team_over_pct: _mapThresholds(s, 'over', 'OffsidesTeamPercentage', ['05', '15', '25'])
        }
    };
}

function _mapCornerHalves(s) {
    return {
        fh: {
             avg_home: _num(s.corners_fh_avg_home),
             ou: _mapThresholds(s, 'corners_fh_over', '_percentage', ['4', '5', '6']) // keys over4, over5... map to 4.5? User said confirm. Let's keep raw num key mapping which defaults to 4->0.4.
             // User Request: "confirm meaning of over4... likely Over 4.5".
             // IMPORTANT: In _mapThresholds, '4' -> 0.4. '105' -> 10.5.
             // If key is 'corners_fh_over4_percentage', the lineKey is '4'.
             // We want 4.5 probably? Or 4?
             // FootyStats naming 'over4' usually means > 4 (Integer). i.e. 5+. Equivalent to > 4.5.
             // BUT my threshold mapper divides by 10.
             // '4' -> 0.4. This is WRONG for 'over4'.
             // I need a special handler for single digit integers if they are indeed integers.
             // However, standard lines like '105' mean 10.5.
             // Let's assume standard behavior first.
             // If lineKey is '4', numKey is 4. Label becomes '0.4'.
             // I will leave it as is for consistency with the parser logic (105->10.5),
             // but '4' becoming '0.4' is definitely weird.
             // Let's assume these are special keys.
        },
        sh: {
             avg_home: _num(s.corners_2h_avg_home),
             ou: _mapThresholds(s, 'corners_2h_over', '_percentage', ['4', '5', '6'])
        }
    };
}


function _mapThresholds(stats, prefix, suffix, lines) {
    const out = { home: {}, overall: {}, away: {} };
    lines.forEach(lineKey => {
        // Threshold Label Logic:
        // 105 -> 10.5
        // 05 -> 0.5
        // 4 -> 4.0 (If we treat it same way? No, 4 is usually integer line in FS)
        // If length is 1, it's likely integer line?
        // User instruction: "105 -> 10.5, 115 -> 11.5".
        // This implies X5 -> X.5.
        // If lineKey is '4', '5', '6' (Corners Halves), treating as X.0?
        // Let's apply /10 rule strictly as requested for '105'.
        // For '4', it becomes 0.4. That's clearly wrong for corners.
        // Special case: if lineKey has NO '5' at end? No.
        // Let's stick to the /10 rule for 2-3 digit codes (05, 15, 105).
        // For single digits '4', '5', '6', assume they are Integers (4.5?).

        let label = lineKey;
        const num = parseInt(lineKey, 10);

        if (!isNaN(num)) {
            if (lineKey.length >= 2 || lineKey === '05') {
                 label = (num / 10).toString();
            } else {
                 // Single digit like '4' -> keep as '4' or map to '4.5'?
                 // User said "confirm... likely Over 4.5".
                 // Let's label it '4.5' for safety? Or just keep '4'.
                 // Keeping '4' is safer if unsure.
                 label = num.toString();
            }
        }

        // Key construction
        // Special case for 'corners_fh_over' + '4' + '_percentage' -> corners_fh_over4_percentage
        const fullKeyHome = `${prefix}${lineKey}${suffix}_home`;
        const fullKeyOver = `${prefix}${lineKey}${suffix}_overall`;
        const fullKeyAway = `${prefix}${lineKey}${suffix}_away`;

        out.home[label] = _pct(stats, fullKeyHome);
        out.overall[label] = _pct(stats, fullKeyOver);
        out.away[label] = _pct(stats, fullKeyAway);
    });
    return out;
}

// ============================================================================
// UTILS & QUALITY
// ============================================================================

function _calculateQuality(stats, meta, missingFields) {
    const matchesHome = stats.seasonMatchesPlayed_home || 0;

    // Fallback for Recorded counters
    const cornersRecorded = stats.cornersRecorded_matches_home || stats.cornerTimingRecorded_matches_home || matchesHome;
    const cardsRecorded = stats.cardsRecorded_matches_home || stats.cardTimingRecorded_matches_home || matchesHome;
    const offsidesRecorded = stats.offsidesRecorded_matches_home || matchesHome;
    const timingRecorded = stats.seasonMatchesPlayedGoalTimingRecorded_home || matchesHome;

    return {
        competition_valid: meta.competition_id > 0,
        matches_overall: stats.seasonMatchesPlayed_overall || 0,
        matches_home: matchesHome,
        sample_home_matches: matchesHome,
        has_xg: (stats.xg_for_avg_home !== undefined && stats.xg_for_avg_home !== null),
        has_corners: cornersRecorded > 3,
        has_cards: cardsRecorded > 3,

        sample: {
            corners_recorded: { home: cornersRecorded },
            cards_recorded: { home: cardsRecorded },
            offsides_recorded: { home: offsidesRecorded },
            goal_timing_recorded: { home: timingRecorded }
        },

        reliability: {
            goals_home: matchesHome >= 3 ? 'ok' : 'low',
            corners_home: (matchesHome >= 3 && cornersRecorded > 0) ? 'ok' : 'low',
            cards_home: (matchesHome >= 3 && cardsRecorded > 0) ? 'ok' : 'low'
        },
        missing_fields: missingFields || []
    };
}

function _num(val) {
    if (val === undefined || val === null || val === "") return 0;
    return Number(val);
}

function _pct(stats, key) {
    const val = stats[key];
    const n = _num(val);

    // Strict Rule: Normalize if key contains "percentage" (case insensitive)
    if (key && key.toLowerCase().includes('percentage')) {
        return n / 100;
    }
    return n;
}

function _safeSum(a, b) {
    return (Number(a)||0) + (Number(b)||0);
}

// ============================================================================
// EXECUTION (n8n / Node)
// ============================================================================

// N8N WRAPPER
if (typeof items !== 'undefined' && Array.isArray(items)) {
    const results = [];
    for (const item of items) {
        let inputData = item.json || item;

        // UNWRAP API RESPONSE { success: true, data: [...] }
        if (inputData && inputData.data && Array.isArray(inputData.data)) {
            inputData = inputData.data;
        }

        const normalized = normalizeHomeTeam(inputData);

        if (normalized) {
            results.push({ json: normalized });
        }
    }
    return results;
}

// NODE.JS EXPORT
if (typeof module !== 'undefined') {
    module.exports = { normalizeHomeTeam };
}
