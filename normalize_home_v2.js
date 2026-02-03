/**
 * Home Team Normalization Module V2 (n8n / Standalone)
 *
 * Objectives:
 * 1. Robust Row Selection (Domestic League priority).
 * 2. Two-Layer Normalization (Core + Extras).
 * 3. Consistent Naming (_mu).
 * 4. 0-1 Percent Normalization.
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
        name: current.name,
        season: current.season,
        competition_id: current.competition_id,
        country: current.country,
        season_source: source
    };

    // 2. Process Seasons (Core Stats)
    // We collect missing fields during processing
    const qualityContext = { missing_fields: [] };

    const currentStats = _processSeason(current, qualityContext);
    const previousStats = previous ? _processSeason(previous, { missing_fields: [] }) : null;

    // 3. Quality Check (on Current)
    const quality = _calculateQuality(current.stats || {}, meta, qualityContext.missing_fields);

    // 4. Extras (Rich Features)
    const extras = _extractExtras(current.stats || {});

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
        // Single object case
        return {
            current: data,
            previous: null,
            source: { current: _makeSourceMeta(data, 0), previous: null }
        };
    }

    // Group by season name
    const seasons = {};
    data.forEach((row, index) => {
        if (!row.season) return;
        if (!seasons[row.season]) seasons[row.season] = [];
        seasons[row.season].push({ ...row, _original_index: index });
    });

    // Sort years descending (2025/2026 -> 2024/2025)
    const sortedYears = Object.keys(seasons).sort((a, b) => {
        const startA = parseInt(a.split('/')[0]) || 0;
        const startB = parseInt(b.split('/')[0]) || 0;
        return startB - startA;
    });

    const currentYear = sortedYears[0];
    const previousYear = sortedYears[1];

    const getBestRow = (rows) => {
        if (!rows || rows.length === 0) return null;
        // Priority: Domestic League > Cup
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

    // Helper to log missing keys
    const _get = (key, fallback = 0, critical = false) => {
        if (s[key] === undefined || s[key] === null) {
            if (critical) missing.push(key);
            return fallback;
        }
        return _num(s[key]);
    };

    // Base Stats
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
            // Fallback chain: Total AVG -> (For + Against) -> 0
            total_avg_home: _get('cornersTotalAVG_home') || (_get('cornersAVG_home') + _get('cornersAgainstAVG_home')),
            for_avg_home: _get('cornersAVG_home'),
            against_avg_home: _get('cornersAgainstAVG_home')
        },
        cards: {
            // Fallback chain for cards
            total_avg_home: _get('cardsTotalAVG_home') || _get('cards_total_avg_home') || (_get('cardsAVG_home') + _get('cardsAgainstAVG_home')),
            avg_home: _get('cardsAVG_home'),
            against_avg_home: _get('cardsAgainstAVG_home')
        },
        game_state: {
            ppg_home: _get('seasonPPG_home'),
            clean_sheet_pct_home: _pct(s.seasonCSPercentage_home),
            failed_to_score_pct_home: _pct(s.seasonFTSPercentage_home),
            btts_pct_home: _pct(s.seasonBTTSPercentage_home)
        }
    };

    // Derived Mus (Expected Totals)
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

function _extractExtras(s) {
    return {
        goals_ou: _mapThresholds(s, 'seasonOver', 'Percentage', ['05', '15', '25', '35', '45', '55']),
        goals_ht_ou: _mapThresholds(s, 'seasonOver', 'PercentageHT', ['05', '15', '25']),
        corners: {
            totals: _mapThresholds(s, 'over', 'CornersPercentage', ['65', '75', '85', '95', '105', '115', '125']),
            for: _mapThresholds(s, 'over', 'CornersForPercentage', ['25', '35', '45', '55', '65']),
            against: _mapThresholds(s, 'over', 'CornersAgainstPercentage', ['25', '35', '45', '55', '65'])
        },
        cards: {
            totals: _mapThresholds(s, 'over', 'CardsPercentage', ['05', '15', '25', '35', '45', '55', '65']),
            for: _mapThresholds(s, 'over', 'CardsForPercentage', ['05', '15', '25', '35']),
            against: _mapThresholds(s, 'over', 'CardsAgainstPercentage', ['05', '15', '25', '35'])
        },
        second_half: _map2HStats(s),
        combo: _mapComboStats(s),
        shots: _mapShots(s),
        offsides: _mapOffsides(s),
        performance: _mapPerformance(s),
        game_state: _mapGameState(s),
        first_goal: _mapFirstGoal(s),
        goal_timing: _mapGoalTiming(s)
    };
}

// -- Helpers for Extras --

function _mapThresholds(stats, prefix, suffix, lines) {
    const out = { home: {}, overall: {}, away: {} };
    lines.forEach(lineKey => {
        // FIX: 105 -> 10.5
        const numKey = parseInt(lineKey, 10);
        let label = lineKey;
        if (!isNaN(numKey)) {
            label = (numKey / 10).toString();
        }

        out.home[label] = _pct(stats[`${prefix}${lineKey}${suffix}_home`]);
        out.overall[label] = _pct(stats[`${prefix}${lineKey}${suffix}_overall`]);
        out.away[label] = _pct(stats[`${prefix}${lineKey}${suffix}_away`]);
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
        clean_sheet_pct_home: _pct(s.cs_2hg_percentage_home),
        failed_to_score_pct_home: _pct(s.fts_2hg_percentage_home),
        btts_pct_home: _pct(s.btts_2hg_percentage_home)
    };
}

function _mapComboStats(s) {
    return {
        btts_win: { home: _pct(s.BTTS_and_win_percentage_home), overall: _pct(s.BTTS_and_win_percentage_overall) },
        btts_draw: { home: _pct(s.BTTS_and_draw_percentage_home), overall: _pct(s.BTTS_and_draw_percentage_overall) },
        btts_lose: { home: _pct(s.BTTS_and_lose_percentage_home), overall: _pct(s.BTTS_and_lose_percentage_overall) },
        scored_both_halves_pct_home: _pct(s.scoredBothHalvesPercentage_home)
    };
}

function _mapShots(s) {
    return {
        total_avg: { home: _num(s.shotsAVG_home), overall: _num(s.shotsAVG_overall) },
        on_target_avg: { home: _num(s.shotsOnTargetAVG_home), overall: _num(s.shotsOnTargetAVG_overall) },
        off_target_avg: { home: _num(s.shotsOffTargetAVG_home), overall: _num(s.shotsOffTargetAVG_overall) }
    };
}

function _mapOffsides(s) {
    return {
        match_avg: { home: _num(s.offsidesAVG_home), overall: _num(s.offsidesAVG_overall) },
        team_avg: { home: _num(s.offsidesTeamAVG_home), overall: _num(s.offsidesTeamAVG_overall) },
        over05_team_pct_home: _pct(s.over05OffsidesTeamPercentage_home)
    };
}

function _mapPerformance(s) {
    return {
        win_pct: { home: _pct(s.winPercentage_home), overall: _pct(s.winPercentage_overall) },
        draw_pct: { home: _pct(s.drawPercentage_home), overall: _pct(s.drawPercentage_overall) },
        loss_pct: { home: _pct(s.losePercentage_home), overall: _pct(s.losePercentage_overall) },
        ppg: { home: _num(s.seasonPPG_home), overall: _num(s.seasonPPG_overall) }
    };
}

function _mapGameState(s) {
    return {
        leading_at_ht_pct: { home: _pct(s.leadingAtHTPercentage_home), overall: _pct(s.leadingAtHTPercentage_overall) },
        drawing_at_ht_pct: { home: _pct(s.drawingAtHTPercentage_home), overall: _pct(s.drawingAtHTPercentage_overall) },
        trailing_at_ht_pct: { home: _pct(s.trailingAtHTPercentage_home), overall: _pct(s.trailingAtHTPercentage_overall) }
    };
}

function _mapFirstGoal(s) {
    return {
        scored_pct: { home: _pct(s.firstGoalScoredPercentage_home), overall: _pct(s.firstGoalScoredPercentage_overall) }
    };
}

function _mapGoalTiming(s) {
    const buckets = ['0_15', '16_30', '31_45', '46_60', '61_75', '76_90'];
    const out = { scored: { home: {}, overall: {} }, conceded: { home: {}, overall: {} } };

    // FootyStats keys: goals_scored_min_0_to_15_home
    buckets.forEach(b => {
        const keyMid = b.replace('_', '_to_'); // 0_15 -> 0_to_15
        out.scored.home[b] = _num(s[`goals_scored_min_${keyMid}_home`]);
        out.scored.overall[b] = _num(s[`goals_scored_min_${keyMid}`] || s[`goals_scored_min_${keyMid}_overall`]); // Key varies

        out.conceded.home[b] = _num(s[`goals_conceded_min_${keyMid}_home`]);
        out.conceded.overall[b] = _num(s[`goals_conceded_min_${keyMid}`] || s[`goals_conceded_min_${keyMid}_overall`]);
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

    return {
        competition_valid: meta.competition_id > 0,
        matches_overall: stats.seasonMatchesPlayed_overall || 0,
        matches_home: matchesHome,
        sample_home_matches: matchesHome,
        has_xg: (stats.xg_for_avg_home !== undefined && stats.xg_for_avg_home !== null),
        has_corners: cornersRecorded > 0,
        has_cards: cardsRecorded > 0,
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

function _pct(val) {
    const n = _num(val);
    // Heuristic: if value > 1, assume 0-100 scale and divide.
    // If value <= 1, assume 0-1 scale.
    // Edge case: exactly 1 (100% vs 1%). Usually 100 is 100.
    // Safest: FootyStats is consistently 0-100 for 'Percentage' keys.
    return n > 1 ? n / 100 : n;
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
