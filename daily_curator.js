/**
 * Daily Curator & Telegram Formatter (v1)
 *
 * Consumes flattened analysis data (Match Summaries + Picks).
 * Groups by Day -> Classifies -> Deduplicates -> Generates Combos -> Formats for Telegram.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
    min_prob_banker: 0.80,
    min_prob_value: 0.30,
    min_prob_core: 0.55,

    // Limits per section
    limit_core: 5,
    limit_value: 8,
    limit_upside: 3,

    // Combo Limits
    limit_smart_doubles: 2, // Max number of doubles to generate
    limit_mid_combos: 1,
    limit_booster: 1
};

// ============================================================================
// LOGIC
// ============================================================================

class DailyCurator {
    constructor(inputData, debugMode = false) {
        this.data = inputData;
        this.matches = new Map(); // id -> { summary, picks[] }
        this.debugMode = debugMode;
    }

    process() {
        // 1. Re-hydrate matches from flattened list
        this._hydrateMatches();

        // 2. Group by Date
        const matchesByDay = this._groupByDay();

        // 3. Process each day
        const results = [];
        for (const [date, matchList] of Object.entries(matchesByDay)) {
            const digest = this._generateDailyDigest(date, matchList);
            const telegramText = this._formatTelegram(digest);

            const result = {
                date,
                summary_counts: digest.summary_counts,
                telegram_text: telegramText
            };

            // Optional: Include full digest only if requested or debug
            if (this.debugMode) {
                result.digest = digest;
            }

            results.push(result);
        }

        return results;
    }

    _hydrateMatches() {
        // First pass: Find all summaries
        this.data.forEach(row => {
            if (row.type === 'match_summary') {
                if (!this.matches.has(row.match_id)) {
                    this.matches.set(row.match_id, { summary: row, picks: [] });
                }
            }
        });

        // Second pass: Attach picks (with Lazy Hydration)
        this.data.forEach(row => {
            if (row.type === 'pick') {
                if (!this.matches.has(row.match_id)) {
                    // Lazy Hydration: Create container if summary missing
                    // We assume the pick has enough metadata (date, teams) to survive
                    this.matches.set(row.match_id, {
                        summary: {
                            match_id: row.match_id,
                            date_iso: row.date_iso || new Date().toISOString(), // Fallback
                            home_team: row.home_team || 'Unknown',
                            away_team: row.away_team || 'Unknown'
                        },
                        picks: []
                    });
                }
                this.matches.get(row.match_id).picks.push(row);
            }
        });
    }

    _groupByDay() {
        const groups = {};
        for (const match of this.matches.values()) {
            let d = "UNKNOWN_DATE";

            // Priority: unix timestamp with Europe/Paris TZ, fallback to ISO split
            if (match.summary.date_unix) {
                try {
                    // Normalize to Paris Day
                    const dateObj = new Date(match.summary.date_unix * 1000);
                    d = new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD
                        timeZone: 'Europe/Paris',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    }).format(dateObj);
                } catch (e) {
                    // Fallback
                }
            }

            if (d === "UNKNOWN_DATE" && match.summary.date_iso) {
                if (match.summary.date_iso.includes('T')) {
                    d = match.summary.date_iso.split('T')[0];
                } else {
                    d = match.summary.date_iso;
                }
            }

            if (!groups[d]) groups[d] = [];
            groups[d].push(match);
        }
        return groups;
    }

    _generateDailyDigest(date, matchList) {
        // Pool of all valid picks for the day
        let allPicks = [];
        matchList.forEach(m => {
            // Add reference to match summary in pick for easier access
            m.picks.forEach(p => {
                p._summary = m.summary;
                allPicks.push(p);
            });
        });

        // 1. Classification
        const classified = {
            bankers: [],
            values: [], // Edge > 0, Prob >= 0.30
            upside: []  // High odds, lower prob
        };

        allPicks.forEach(p => {
            const isEdgePositive = p.edge > 0;
            const prob = p.probability;

            // Exclusive Classification: BANKER > UPSIDE > VALUE
            // This prevents tag overwriting and duplicate counting

            // 1. BANKER (High Confidence)
            if (prob >= CONFIG.min_prob_banker) {
                p._tags_internal = ["BANKER"];
                classified.bankers.push(p);
                return; // Stop
            }

            // 2. UPSIDE (High Odds, Good Edge)
            if (isEdgePositive && p.best_odds >= 3.0) {
                p._tags_internal = ["UPSIDE"];
                classified.upside.push(p);
                return; // Stop
            }

            // 3. VALUE (Solid Edge)
            if (isEdgePositive && prob >= CONFIG.min_prob_value) {
                p._tags_internal = ["VALUE"];
                classified.values.push(p);
                return; // Stop
            }
        });

        // Sort lists by Rank Score (or Edge)
        const sortByRank = (a, b) => b.rank_score - a.rank_score;
        classified.bankers.sort(sortByRank);
        classified.values.sort(sortByRank);
        classified.upside.sort(sortByRank);

        // 2. Selection (Deduplicating Matches per section)
        // We track used match_ids per section to ensure 1 pick per match

        const corePicks = this._selectCore(classified);
        const valuePicks = this._selectValue(classified, corePicks); // Don't repeat matches from Core
        const upsidePicks = this._selectUpside(classified, corePicks, valuePicks);

        // 3. Combos
        const usedMatchesGlobal = new Set();

        // Exclude matches already used in Single Sections to maximize variety?
        // User requested: "Prevent match re-use across multiple combos".
        // Didn't explicitly forbid re-using Singles in Combos, but typically it's better to avoid overlap.
        // Let's seed the global used list with matches from Singles?
        // Actually, keeping them separate is often fine (Single bet + part of a combo).
        // BUT, strictly enforcing "1 pick per match per section" implies we shouldn't reuse.
        // For strictly unique combos, we track usage across all combos generated below.

        // Pool for combos: Bankers + High Quality Value
        const comboPool = [...classified.bankers, ...classified.values.filter(p => p.probability >= 0.5)];

        const smartDoubles = this._generateCombos(comboPool, 2, CONFIG.limit_smart_doubles, 2.0, 3.5, usedMatchesGlobal);

        // Mid Combo: 2-3 legs, Aggressive
        const midPool = [...classified.values, ...classified.upside]; // Wider pool
        const midCombos = this._generateCombos(midPool, 3, CONFIG.limit_mid_combos, 3.0, 6.0, usedMatchesGlobal);

        // Booster: 3-4 legs, High variance
        const boosterCombos = this._generateCombos([...classified.values, ...classified.upside], 4, CONFIG.limit_booster, 7.0, 20.0, usedMatchesGlobal);

        return {
            date,
            summary_counts: {
                core: corePicks.length,
                value: valuePicks.length,
                upside: upsidePicks.length,
                smart_doubles: smartDoubles.length,
                mid_combos: midCombos.length,
                booster: boosterCombos.length
            },
            sections: {
                core: corePicks,
                value: valuePicks,
                upside: upsidePicks,
                smart_doubles: smartDoubles,
                mid_combos: midCombos,
                booster: boosterCombos
            }
        };
    }

    _selectCore(classified) {
        // Priority: High Probability Value Bets -> Then Pure Bankers
        // We want the most stable picks here.

        // Candidates: Value picks with Prob >= 0.55 OR Bankers
        const candidates = [
            ...classified.values.filter(p => p.probability >= CONFIG.min_prob_core),
            ...classified.bankers
        ];

        // Sort by Rank Score
        candidates.sort((a, b) => b.rank_score - a.rank_score);

        return this._dedupeMatches(candidates, CONFIG.limit_core);
    }

    _selectValue(classified, excludeList) {
        // Candidates: All Value picks, excluding matches already in Core
        const excludeIds = new Set(excludeList.map(p => p.match_id));
        const candidates = classified.values.filter(p => !excludeIds.has(p.match_id));

        return this._dedupeMatches(candidates, CONFIG.limit_value);
    }

    _selectUpside(classified, excludeListA, excludeListB) {
        const excludeIds = new Set([
            ...excludeListA.map(p => p.match_id),
            ...excludeListB.map(p => p.match_id)
        ]);
        const candidates = classified.upside.filter(p => !excludeIds.has(p.match_id));

        return this._dedupeMatches(candidates, CONFIG.limit_upside);
    }

    _dedupeMatches(picks, limit) {
        const selected = [];
        const seenMatches = new Set();

        for (const p of picks) {
            if (selected.length >= limit) break;
            if (!seenMatches.has(p.match_id)) {
                selected.push(p);
                seenMatches.add(p.match_id);
            }
        }
        return selected;
    }

    _generateCombos(pool, legCount, comboLimit, minOdds, maxOdds, usedMatchesGlobal) {
        // Greedy approach with Global Exclusion
        const combos = [];

        // Sort pool best first
        pool.sort((a, b) => b.rank_score - a.rank_score);

        for (let i = 0; i < pool.length; i++) {
            if (combos.length >= comboLimit) break;

            // Check if start leg is already used globally
            if (usedMatchesGlobal.has(pool[i].match_id)) continue;

            // Start a combo
            const currentCombo = [pool[i]];
            const currentMatchIds = new Set([pool[i].match_id]);
            let currentOdds = pool[i].best_odds;

            // Try to find legs
            for (let j = i + 1; j < pool.length; j++) {
                const leg = pool[j];

                // Skip if match used in this combo OR globally
                if (currentMatchIds.has(leg.match_id) || usedMatchesGlobal.has(leg.match_id)) continue;

                // Add
                currentCombo.push(leg);
                currentMatchIds.add(leg.match_id);
                currentOdds *= leg.best_odds;

                if (currentCombo.length === legCount) {
                    // Check total odds constraints
                    if (currentOdds >= minOdds && currentOdds <= maxOdds) {
                        combos.push({
                            type: legCount + "-Fold",
                            legs: currentCombo,
                            total_odds: parseFloat(currentOdds.toFixed(2))
                        });

                        // Mark all matches in this combo as used globally
                        currentMatchIds.forEach(id => usedMatchesGlobal.add(id));

                        // Move outer loop forward to avoid checking the same starting leg again
                        // (though the usedMatchesGlobal check at start of loop handles it)
                    }
                    break; // Move to next potential combo
                }
            }
        }
        return combos;
    }

    _formatTelegram(digest) {
        const lines = [];
        const s = digest.summary_counts;
        const dateStr = new Date(digest.date).toDateString();

        lines.push(`📅 **Daily Analysis: ${dateStr}**`);
        lines.push(`📊 **Summary**`);
        lines.push(`• 🛡️ Core: ${s.core}`);
        lines.push(`• 💎 Value: ${s.value}`);
        if(s.upside) lines.push(`• 🚀 Upside: ${s.upside}`);
        lines.push(`• 🔥 Smart Doubles: ${s.smart_doubles}`);
        lines.push(`\n----------------------------------\n`);

        // CORE
        if (digest.sections.core.length > 0) {
            lines.push(`🛡️ **CORE SINGLES** (Stability)`);
            digest.sections.core.forEach(p => lines.push(this._fmtPick(p)));
            lines.push("");
        }

        // VALUE
        if (digest.sections.value.length > 0) {
            lines.push(`💎 **VALUE SINGLES** (Edge > 0)`);
            digest.sections.value.forEach(p => lines.push(this._fmtPick(p)));
            lines.push("");
        }

        // UPSIDE
        if (digest.sections.upside.length > 0) {
            lines.push(`🚀 **HIGH POTENTIAL** (Small Stake)`);
            digest.sections.upside.forEach(p => lines.push(this._fmtPick(p)));
            lines.push("");
        }

        // COMBOS
        if (digest.sections.smart_doubles.length > 0) {
            lines.push(`🔥 **SMART DOUBLES**`);
            digest.sections.smart_doubles.forEach((c, idx) => {
                lines.push(`\n**Double #${idx+1} @ ${c.total_odds}**`);
                c.legs.forEach(leg => {
                    const sel = leg.line ? `${leg.selection} ${leg.line}` : leg.selection;
                    lines.push(`  • ${leg.home_team} vs ${leg.away_team}: ${sel} (${leg.market})`);
                });
            });
            lines.push("");
        }

        if (digest.sections.mid_combos.length > 0) {
            lines.push(`⚡ **MID COMBO**`);
            digest.sections.mid_combos.forEach((c, idx) => {
                lines.push(`\n**Combo #${idx+1} @ ${c.total_odds}**`);
                c.legs.forEach(leg => {
                    const sel = leg.line ? `${leg.selection} ${leg.line}` : leg.selection;
                    lines.push(`  • ${leg.home_team}: ${sel} (${leg.market})`);
                });
            });
            lines.push("");
        }

        if (digest.sections.booster.length > 0) {
            lines.push(`🚀 **BOOSTER**`);
            digest.sections.booster.forEach((c, idx) => {
                lines.push(`\n**Combo #${idx+1} @ ${c.total_odds}**`);
                c.legs.forEach(leg => {
                    const sel = leg.line ? `${leg.selection} ${leg.line}` : leg.selection;
                    lines.push(`  • ${leg.home_team}: ${sel} (${leg.market})`);
                });
            });
            lines.push("");
        }

        return lines.join("\n");
    }

    _fmtPick(p) {
        // "Match — Market (Line) @ odds | prob | edge | bookmaker"
        const marketStr = p.line ? `${p.market} (${p.selection} ${p.line})` : `${p.market} (${p.selection})`;
        const probPct = Math.round(p.probability * 100) + "%";
        const edgePct = (p.edge * 100).toFixed(1) + "%";

        return `• ${p.home_team} vs ${p.away_team}\n  👉 ${marketStr} @ ${p.best_odds}\n  📊 ${probPct} | Edge: ${edgePct} | 🏦 ${p.bookmaker || 'N/A'}`;
    }
}

// ============================================================================
// EXPORT / N8N WRAPPER
// ============================================================================
if (typeof items !== 'undefined' && Array.isArray(items)) {
    // n8n Environment
    try {
        const input = items.map(i => i.json); // Assuming flattened array passed as items
        // NOTE: n8n usually passes 1 item per row if flattened.
        // We need the WHOLE array to group.
        // If n8n runs this node "Once for all items", 'items' is the array.

        // Check for debug mode input
        // e.g. items[0].json.debug_mode
        const debug = input[0] && input[0].debug_mode === true;

        const curator = new DailyCurator(input, debug);
        const results = curator.process();

        return results.map(r => ({ json: r }));
    } catch (e) {
        return [{ json: { error: e.message } }];
    }
}

if (typeof module !== 'undefined') {
    module.exports = { DailyCurator };
}
