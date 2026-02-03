/**
 * Home Team Normalization Module V2 (n8n / Standalone)
 *
 * Objectives:
 * 1. Support Multi-Season Input (Current + Previous)
 * 2. Two-Layer Normalization:
 *    - Core (Gold): Immediate predictor signals.
 *    - Extras: Structured dictionaries for R&D.
 * 3. Consistent Naming (mu).
 */

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function normalizeHomeTeam(inputData) {
    // 1. Handle Input (Array vs Object)
    let currentRaw = null;
    let previousRaw = null;

    if (Array.isArray(inputData)) {
        currentRaw = inputData[0];
        previousRaw = inputData.length > 1 ? inputData[1] : null;
    } else {
        currentRaw = inputData;
    }

    if (!currentRaw || !currentRaw.id) return null;

    const meta = {
        id: currentRaw.id,
        name: currentRaw.name,
        season: currentRaw.season,
        competition_id: currentRaw.competition_id,
        country: currentRaw.country
    };

    // 2. Process Seasons (Core Stats)
    const current = _processSeason(currentRaw);
    const previous = previousRaw ? _processSeason(previousRaw) : null;

    // 3. Quality Check (on Current)
    const quality = _calculateQuality(currentRaw.stats || {}, meta);

    // 4. Extras (Rich Features from Current Season)
    const extras = _extractExtras(currentRaw.stats || {});

    // 5. Structure Output
    return {
        team_id: meta.id,
        team_name: meta.name,
        meta: {
            season_format: currentRaw.season_format || "Unknown",
            competition_id: meta.competition_id,
            country: meta.country,
            season_name: meta.season
        },
        quality: quality,
        season: {
            current: current,
            previous: previous
        },
        form: {
            last5: null, // To be populated by Last 5 API branch
            last10: null // To be populated by Last 10 API branch
        },
        extras: extras
    };
}

// ============================================================================
// CORE PROCESSING (Layer A)
// ============================================================================

function _processSeason(teamRaw) {
    const s = teamRaw.stats || {};

    // Base Stats
    const stats = {
        matches: {
            overall: s.seasonMatchesPlayed_overall || 0,
            home: s.seasonMatchesPlayed_home || 0,
            away: s.seasonMatchesPlayed_away || 0
        },
        goals: {
            scored_avg_overall: _num(s.seasonScoredAVG_overall),
            conceded_avg_overall: _num(s.seasonConcededAVG_overall),
            scored_avg_home: _num(s.seasonScoredAVG_home),
            conceded_avg_home: _num(s.seasonConcededAVG_home),
            scored_avg_away: _num(s.seasonScoredAVG_away),
            conceded_avg_away: _num(s.seasonConcededAVG_away),
            // Halves (Core)
            ht_scored_avg_home: _num(s.scoredAVGHT_home),
            ht_conceded_avg_home: _num(s.concededAVGHT_home),
            sh_scored_avg_home: _num(s.scored_2hg_avg_home),
            sh_conceded_avg_home: _num(s.conceded_2hg_avg_home)
        },
        xg: {
            for_avg_overall: _num(s.xg_for_avg_overall),
            against_avg_overall: _num(s.xg_against_avg_overall),
            for_avg_home: _num(s.xg_for_avg_home),
            against_avg_home: _num(s.xg_against_avg_home)
        },
        corners: {
            total_avg_home: _num(s.cornersTotalAVG_home),
            for_avg_home: _num(s.cornersAVG_home),
            against_avg_home: _num(s.cornersAgainstAVG_home)
        },
        cards: {
            total_avg_home: _num(s.cards_total_avg_home), // Note: Check precise key, often cards_total_avg_home or cardsTotalAVG_home
            avg_home: _num(s.cardsAVG_home),
            against_avg_home: _num(s.cards_against_avg_home)
        },
        game_state: {
            ppg_home: _num(s.seasonPPG_home),
            clean_sheet_pct_home: _num(s.seasonCSPercentage_home),
            failed_to_score_pct_home: _num(s.seasonFTSPercentage_home),
            btts_pct_home: _num(s.seasonBTTSPercentage_home)
        }
    };

    // Derived Mus (Expected Totals)
    // Convention: mu = mean
    const derived = {
        goals_total_mu_home: _safeSum(stats.goals.scored_avg_home, stats.goals.conceded_avg_home),
        goals_total_mu_overall: _safeSum(stats.goals.scored_avg_overall, stats.goals.conceded_avg_overall),
        ht_goals_mu_home: _safeSum(stats.goals.ht_scored_avg_home, stats.goals.ht_conceded_avg_home),
        sh_goals_mu_home: _safeSum(stats.goals.sh_scored_avg_home, stats.goals.sh_conceded_avg_home),
        corners_total_mu_home: stats.corners.total_avg_home || _safeSum(stats.corners.for_avg_home, stats.corners.against_avg_home),
        cards_total_mu_home: stats.cards.total_avg_home || _safeSum(stats.cards.avg_home, stats.cards.against_avg_home)
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
        offsides: _mapOffsides(s)
    };
}

// -- Helpers for Extras --

function _mapThresholds(stats, prefix, suffix, lines) {
    // E.g. prefix="seasonOver", suffix="Percentage" -> "seasonOver05Percentage_home"
    const out = { home: {}, overall: {}, away: {} };

    lines.forEach(lineKey => {
        // Convert "05" -> "0.5" for clean key
        const label = lineKey.replace(/(\d)(\d)/, '$1.$2');

        out.home[label] = _num(stats[`${prefix}${lineKey}${suffix}_home`]);
        out.overall[label] = _num(stats[`${prefix}${lineKey}${suffix}_overall`]);
        out.away[label] = _num(stats[`${prefix}${lineKey}${suffix}_away`]);
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
        clean_sheet_pct_home: _num(s.cs_2hg_percentage_home),
        failed_to_score_pct_home: _num(s.fts_2hg_percentage_home),
        btts_pct_home: _num(s.btts_2hg_percentage_home)
    };
}

function _mapComboStats(s) {
    return {
        btts_win: {
            home: _num(s.BTTS_and_win_percentage_home),
            overall: _num(s.BTTS_and_win_percentage_overall)
        },
        btts_draw: {
            home: _num(s.BTTS_and_draw_percentage_home),
            overall: _num(s.BTTS_and_draw_percentage_overall)
        },
        btts_lose: {
            home: _num(s.BTTS_and_lose_percentage_home),
            overall: _num(s.BTTS_and_lose_percentage_overall)
        },
        scored_both_halves_pct_home: _num(s.scoredBothHalvesPercentage_home)
    };
}

function _mapShots(s) {
    return {
        total_avg: {
            home: _num(s.shotsAVG_home),
            overall: _num(s.shotsAVG_overall)
        },
        on_target_avg: {
            home: _num(s.shotsOnTargetAVG_home),
            overall: _num(s.shotsOnTargetAVG_overall)
        },
        off_target_avg: {
            home: _num(s.shotsOffTargetAVG_home),
            overall: _num(s.shotsOffTargetAVG_overall)
        }
    };
}

function _mapOffsides(s) {
    return {
        match_avg: {
            home: _num(s.offsidesAVG_home),
            overall: _num(s.offsidesAVG_overall)
        },
        team_avg: {
            home: _num(s.offsidesTeamAVG_home),
            overall: _num(s.offsidesTeamAVG_overall)
        },
        // Could add thresholds here similar to _mapThresholds if needed
        over05_team_pct_home: _num(s.over05OffsidesTeamPercentage_home)
    };
}

// ============================================================================
// UTILS & QUALITY
// ============================================================================

function _calculateQuality(stats, meta) {
    const matchesHome = stats.seasonMatchesPlayed_home || 0;

    // Fallback for Recorded counters
    const cornersRecorded = stats.cornersRecorded_matches_home || stats.cornerTimingRecorded_matches_home || matchesHome;
    const cardsRecorded = stats.cardsRecorded_matches_home || stats.cardTimingRecorded_matches_home || matchesHome;

    return {
        competition_valid: meta.competition_id > 0,
        matches_overall: stats.seasonMatchesPlayed_overall || 0,
        matches_home: matchesHome,
        reliability: {
            goals_home: matchesHome >= 3 ? 'ok' : 'low',
            corners_home: (matchesHome >= 3 && cornersRecorded > 0) ? 'ok' : 'low',
            cards_home: (matchesHome >= 3 && cardsRecorded > 0) ? 'ok' : 'low'
        }
    };
}

function _num(val) {
    if (val === undefined || val === null || val === "") return 0;
    return Number(val);
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
        // If data is an array, we pass THE WHOLE ARRAY to normalizeHomeTeam
        // so it can extract Current and Previous seasons.
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
