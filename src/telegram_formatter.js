
// Input: flattenedItems (Array of objects with 'type', 'date', etc.)
// Output: Array of { type: "DAY_TELEGRAM", date: "...", message: "..." }

const output = [];
const days = {};

// Group by date
for (const item of items) {
    // Skip RUN_STATS or undefined dates
    if (!item.date || item.type === "RUN_STATS") continue;

    if (!days[item.date]) {
        days[item.date] = {
            summary: null,
            picks: [],
            combos: {} // map combo_id -> { header, legs: [] }
        };
    }

    const dayData = days[item.date];

    if (item.type === "DAY_SUMMARY") {
        dayData.summary = item.summary;
    } else if (item.type === "PICK") {
        dayData.picks.push(item);
    } else if (item.type === "COMBO_HEADER") {
        if (!dayData.combos[item.combo_id]) {
            dayData.combos[item.combo_id] = { header: item, legs: [] };
        } else {
            // Header might arrive after legs if order isn't guaranteed, but usually header is first.
            // Just attach header data.
            dayData.combos[item.combo_id].header = item;
        }
    } else if (item.type === "COMBO_LEG") {
        if (!dayData.combos[item.combo_id]) {
            dayData.combos[item.combo_id] = { header: null, legs: [] };
        }
        dayData.combos[item.combo_id].legs.push(item);
    }
}

// Sort dates
const sortedDates = Object.keys(days).sort();

for (const dateStr of sortedDates) {
    const data = days[dateStr];
    const lines = [];

    // Title
    lines.push(`📅 Daily Menu — ${dateStr}`);

    // Summary
    if (data.summary) {
        let cleanSummary = data.summary
            .replace(/ \+ /g, " • ")
            .replace(/Smart Dbl/g, "Smart Double");
        lines.push(`Summary : ${cleanSummary}`);
    }
    lines.push("");

    // Group Picks
    const core = data.picks.filter(p => p.pack_type === "CORE").sort((a, b) => b.score - a.score);
    const value = data.picks.filter(p => p.pack_type === "VALUE").sort((a, b) => b.score - a.score);
    const upside = data.picks.filter(p => p.pack_type === "HIGH_UPSIDE").sort((a, b) => b.score - a.score);

    // 1. CORE Singles
    if (core.length > 0) {
        lines.push(`🛡️ CORE Singles (${core.length})`);

        const top3 = core.slice(0, 3);
        const rest = core.slice(3);

        if (rest.length > 0) lines.push("Top 3 shown");

        top3.forEach((p, i) => {
            lines.push(`${i + 1}. ${p.match}`);
            lines.push(`   ${p.market} - ${p.selection} @ ${p.odds.toFixed(2)}`);
            lines.push(`   Edge: ${p.edge}% | Rating: ${p.rating}`); // Keep details
            lines.push("");
        });

        if (rest.length > 0) {
            lines.push(`(+ ${rest.length} other available)`);
            lines.push("");
        }
    }

    // 2. Combos
    // Separate by type
    const smartCombos = [];
    const midCombos = [];
    const funCombos = [];

    Object.values(data.combos).forEach(c => {
        if (!c.header) return; // Should not happen if data valid
        if (c.header.combo_type === "SMART_COMBO") smartCombos.push(c);
        else if (c.header.combo_type === "MID_COMBO") midCombos.push(c);
        else if (c.header.combo_type === "FUN_COMBO") funCombos.push(c);
    });

    // Smart Combos
    if (smartCombos.length > 0) {
        lines.push(`🔥 SMART COMBOS (${smartCombos.length} doubles)`);
        smartCombos.forEach((c, idx) => {
            lines.push(`Smart #${idx + 1} — Total ${c.header.total_odds.toFixed(2)}`);
            c.legs.forEach(l => {
                 lines.push(`• ${l.match}: ${l.market} - ${l.selection} @ ${l.odds.toFixed(2)}`);
            });
            lines.push("");
        });
    }

    // Mid Combo
    if (midCombos.length > 0) {
        lines.push(`⚡ MID COMBO (${midCombos.length})`);
        midCombos.forEach(c => {
            lines.push(`Total ${c.header.total_odds.toFixed(2)}`);
            c.legs.forEach(l => {
                 lines.push(`• ${l.match}: ${l.market} - ${l.selection} @ ${l.odds.toFixed(2)}`);
            });
            lines.push("");
        });
    }

    // Value Singles
    if (value.length > 0) {
        lines.push(`💎 VALUE Singles (${value.length})`);
        // Show all or top 3? User said "either show full list OR cap to Top 3".
        // Let's show full list as they are usually few.
        value.forEach(p => {
             lines.push(`• ${p.match}`);
             lines.push(`  ${p.market} - ${p.selection} @ ${p.odds.toFixed(2)}`);
             lines.push(`  Edge: ${p.edge}% | Prob: ${(p.p * 100).toFixed(1)}%`);
             lines.push("");
        });
    }

    // High Upside
    if (upside.length > 0) {
        lines.push(`🚀 HIGH UPSIDE (${upside.length})`);
        const showUpside = upside.slice(0, 2); // Max 1-2 bullets
        showUpside.forEach(p => {
             lines.push(`• ${p.match}: ${p.market} - ${p.selection} @ ${p.odds.toFixed(2)}`);
        });
        lines.push("");
    }

    // Fun Combo
    if (funCombos.length > 0) {
        lines.push(`🎢 FUN COMBO (${funCombos.length})`);
        funCombos.forEach(c => {
            lines.push(`Total ${c.header.total_odds.toFixed(2)}`);
            c.legs.forEach(l => {
                 lines.push(`• ${l.match}: ${l.market} - ${l.selection} @ ${l.odds.toFixed(2)}`);
            });
            lines.push("");
        });
    }

    output.push({
        type: "DAY_TELEGRAM",
        date: dateStr,
        message: lines.join("\n")
    });
}

return output;
