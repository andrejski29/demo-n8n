/**
 * Home Team Normalization Module (n8n / Standalone)
 *
 * Objectives:
 * 1. Reduce payload size by filtering noise (granular thresholds, redundant totals).
 * 2. Create a "Gold Standard" object for the Predictor.
 * 3. Add Quality/Reliability flags.
 * 4. Compute Derived Market Priors.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

// Standard Betting Lines to Keep (Whitelist)
const KEPT_LINES = {
    goals_ou: ['1.5', '2.5', '3.5'],
    goals_1h_ou: ['0.5', '1.5'],
    corners_ou: ['8.5', '9.5', '10.5'],
    cards_ou: ['3.5', '4.5', '5.5']
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function normalizeHomeTeam(rawData) {
    if (!rawData || !rawData.id) return null;

    const stats = rawData.stats || {};
    const meta = {
        id: rawData.id,
        name: rawData.name,
        season: rawData.season,
        competition_id: rawData.competition_id,
        country: rawData.country
    };

    // 1. QUALITY CHECK
    // ------------------------------------------------------------------------
    const quality = _calculateQuality(stats, meta);

    // 2. SEASON STATS (Current)
    // ------------------------------------------------------------------------
    const season = _mapSeasonStats(stats);

    // 3. DERIVED PRIORS (Market Ready)
    // ------------------------------------------------------------------------
    const derived = _calculateDerivedPriors(season);

    // 4. RATES (Specific Lines)
    // ------------------------------------------------------------------------
    const rates = _mapStandardRates(stats);

    // 5. GAME STATE
    // ------------------------------------------------------------------------
    const game_state = _mapGameState(stats);

    // 6. FORM (Placeholder Structure)
    // ------------------------------------------------------------------------
    const form = {
        last5: null, // To be populated by Last 5 API branch
        last10: null // To be populated by Last 10 API branch
    };

    return {
        team_id: meta.id,
        team_name: meta.name,
        meta: {
            season: meta.season,
            competition_id: meta.competition_id,
            country: meta.country
        },
        quality: quality,
        season: {
            current: season
        },
        derived: derived,
        rates: rates,
        game_state: game_state,
        form: form
    };
}

// ============================================================================
// HELPERS
// ============================================================================

function _calculateQuality(stats, meta) {
    const matchesHome = stats.seasonMatchesPlayed_home || 0;
    const matchesTotal = stats.seasonMatchesPlayed_overall || 0;

    // Simple Heuristic for reliability
    let reliability = 'low';
    if (matchesHome >= 4) reliability = 'medium';
    if (matchesHome >= 8) reliability = 'high';

    return {
        competition_valid: meta.competition_id > 0,
        season_format: stats.season_format || "Unknown",
        matches_overall: matchesTotal,
        matches_home: matchesHome,
        reliability: {
            goals_home: matchesHome >= 3 ? 'ok' : 'low',
            corners_home: (matchesHome >= 3 && stats.cornersRecorded_matches_home > 0) ? 'ok' : 'low',
            cards_home: (matchesHome >= 3 && stats.cardsRecorded_matches_home > 0) ? 'ok' : 'low'
        },
        missing_flags: [] // Populate if critical fields are null
    };
}

function _mapSeasonStats(s) {
    return {
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
            conceded_avg_away: _num(s.seasonConcededAVG_away)
        },
        xg: {
            for_avg_overall: _num(s.xg_for_avg_overall),
            against_avg_overall: _num(s.xg_against_avg_overall),
            for_avg_home: _num(s.xg_for_avg_home),
            against_avg_home: _num(s.xg_against_avg_home)
        },
        halves: {
            ht_scored_avg_home: _num(s.scoredAVGHT_home),
            ht_conceded_avg_home: _num(s.concededAVGHT_home),
            sh_scored_avg_home: _num(s.scored_2hg_avg_home),
            sh_conceded_avg_home: _num(s.conceded_2hg_avg_home)
        },
        shots: {
            avg_home: _num(s.shotsAVG_home),
            on_target_avg_home: _num(s.shotsOnTargetAVG_home),
            conversion_rate_home: _num(s.shot_conversion_rate_home)
        },
        corners: {
            for_avg_home: _num(s.cornersAVG_home),
            against_avg_home: _num(s.cornersAgainstAVG_home),
            total_avg_home: _num(s.cornersTotalAVG_home)
        },
        cards: {
            avg_home: _num(s.cardsAVG_home),
            against_avg_home: _num(s.cards_against_avg_home)
        },
        discipline: {
            fouls_avg_home: _num(s.foulsAVG_home),
            offsides_avg_home: _num(s.offsidesTeamAVG_home)
        },
        possession: {
            avg_home: _num(s.possessionAVG_home)
        }
    };
}

function _calculateDerivedPriors(season) {
    const s = season;
    return {
        goals_total_mu_home: _safeSum(s.goals.scored_avg_home, s.goals.conceded_avg_home),
        goals_total_mu_overall: _safeSum(s.goals.scored_avg_overall, s.goals.conceded_avg_overall),

        ht_goals_mu_home: _safeSum(s.halves.ht_scored_avg_home, s.halves.ht_conceded_avg_home),
        sh_goals_mu_home: _safeSum(s.halves.sh_scored_avg_home, s.halves.sh_conceded_avg_home),

        corners_total_mu_home: s.corners.total_avg_home || _safeSum(s.corners.for_avg_home, s.corners.against_avg_home),
        cards_total_mu_home: _safeSum(s.cards.avg_home, s.cards.against_avg_home)
    };
}

function _mapStandardRates(s) {
    // Helper to find specific threshold percentages in raw stats
    // Raw keys like: seasonOver25Percentage_home

    return {
        goals_home: {
            o15: _num(s.seasonOver15Percentage_home),
            o25: _num(s.seasonOver25Percentage_home),
            o35: _num(s.seasonOver35Percentage_home),
            u25: _num(s.seasonUnder25Percentage_home) // Explicit if available, else derive? Better keep if source has it.
        },
        goals_1h_home: {
            o05: _num(s.seasonOver05PercentageHT_home),
            o15: _num(s.seasonOver15PercentageHT_home)
        },
        btts_home: _num(s.seasonBTTSPercentage_home),
        clean_sheet_home: _num(s.seasonCSPercentage_home),
        failed_to_score_home: _num(s.seasonFTSPercentage_home),

        // Corners (Often named overX5CornersPercentage_home e.g. over95)
        corners_home: {
            o85: _num(s.over85CornersPercentage_home),
            o95: _num(s.over95CornersPercentage_home),
            o105: _num(s.over105CornersPercentage_home)
        },

        // Cards (e.g. over35CardsPercentage_home)
        cards_home: {
            o35: _num(s.over35CardsPercentage_home),
            o45: _num(s.over45CardsPercentage_home)
        }
    };
}

function _mapGameState(s) {
    return {
        ppg_home: _num(s.seasonPPG_home),
        ht_ppg_home: _num(s.HTPPG_home),
        leading_at_ht_pct_home: _num(s.leadingAtHTPercentage_home),
        drawing_at_ht_pct_home: _num(s.drawingAtHTPercentage_home),
        trailing_at_ht_pct_home: _num(s.trailingAtHTPercentage_home),
        first_goal_scored_pct_home: _num(s.firstGoalScoredPercentage_home),
        win_pct_home: _num(s.winPercentage_home)
    };
}

// Utils
function _num(val) {
    if (val === undefined || val === null || val === "") return 0;
    return Number(val);
}

function _safeSum(a, b) {
    return (Number(a)||0) + (Number(b)||0);
}

// ============================================================================
// EXPORT (N8N / Node)
// ============================================================================
if (typeof module !== 'undefined') {
    module.exports = { normalizeHomeTeam };
}
