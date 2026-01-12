
const EPS = 1e-12;

// ==================== // HELPERS // ====================

const safeNum = (v, fb = 0) => {
    const n = (typeof v === "string") ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : fb;
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const pct1 = (p) => (Number.isFinite(p) ? Math.round(p * 1000) / 10 : null); // 1 decimal %

function calculateFormFactor(formString) {
    if (!formString) return 1;
    const last5 = String(formString).slice(-5);
    let pts = 0;
    for (const c of last5) {
        if (c === "W") pts += 3;
        else if (c === "D") pts += 1;
    }
    return 0.8 + ((pts / 15) * 0.4); // 0.8..1.2
}

function normalizeLineStr(s) {
    const n = parseFloat(String(s).replace(/[()]/g, "").trim());
    if (!Number.isFinite(n)) return null;
    const v = Math.abs(n) < 1e-12 ? 0 : n; // avoid "-0"
    return String(v);
}

function computeRatingScore(fairProb, evEdge, marketEdge) {
    const probScore = clamp(fairProb, 0, 1) * 100;
    const valueScore = clamp(evEdge, 0, 0.50) / 0.50 * 100;
    let score = (0.6 * probScore + 0.4 * valueScore);

    // Market Agreement Bonus/Malus
    if (marketEdge !== null) {
        if (marketEdge > 0.05) score += 2;
        if (marketEdge < -0.10) score -= 2;
    }

    return Math.round(score * 10) / 10;
}

function poissonPmfSeries(lambda, kMax) {
    lambda = Math.max(0, lambda);
    const pmf = Array(kMax + 1).fill(0);
    pmf[0] = Math.exp(-lambda);
    for (let k = 1; k <= kMax; k++) pmf[k] = pmf[k - 1] * (lambda / k);
    return pmf;
}

const sumProb = (matrix, conditionFn) => {
    let s = 0;
    for (let h = 0; h < matrix.length; h++) {
        for (let a = 0; a < matrix[h].length; a++) {
            if (conditionFn(h, a)) s += matrix[h][a];
        }
    }
    return s;
};

const renormalizeMatrix = (matrix) => {
    let s = 0;
    for (let h = 0; h < matrix.length; h++) {
        for (let a = 0; a < matrix[h].length; a++) s += matrix[h][a];
    }
    if (s > 0) {
        for (let h = 0; h < matrix.length; h++) {
            for (let a = 0; a < matrix[h].length; a++) matrix[h][a] /= s;
        }
    }
    return matrix;
};

const generateMatrix = (lHome, lAway, maxGoals = 15) => {
    lHome = clamp(safeNum(lHome, 0), 0, 10);
    lAway = clamp(safeNum(lAway, 0), 0, 10);

    const pmfH = poissonPmfSeries(lHome, maxGoals - 1);
    const pmfA = poissonPmfSeries(lAway, maxGoals - 1);

    const m = [];
    for (let h = 0; h < maxGoals; h++) {
        const row = [];
        for (let a = 0; a < maxGoals; a++) row.push(pmfH[h] * pmfA[a]);
        m.push(row);
    }
    return renormalizeMatrix(m);
};

const getTotalDist = (matrix) => {
    const maxT = (matrix.length - 1) + (matrix[0].length - 1);
    const dist = Array(maxT + 1).fill(0);
    for (let h = 0; h < matrix.length; h++) {
        for (let a = 0; a < matrix[h].length; a++) dist[h + a] += matrix[h][a];
    }
    return dist;
};

const getMarginals = (matrix) => {
    const H = matrix.length;
    const A = matrix[0].length;
    const home = Array(H).fill(0);
    const away = Array(A).fill(0);
    for (let h = 0; h < H; h++) {
        for (let a = 0; a < A; a++) {
            home[h] += matrix[h][a];
            away[a] += matrix[h][a];
        }
    }
    return {
        home,
        away
    };
};

const cdfFromDist = (dist) => {
    const cdf = [];
    let s = 0;
    for (let k = 0; k < dist.length; k++) {
        s += dist[k];
        cdf[k] = s;
    }
    if (cdf.length) cdf[cdf.length - 1] = 1;
    return cdf;
};

const probEq = (dist, k) => (k >= 0 && k < dist.length ? dist[k] : 0);
const probLe = (cdf, k) => (k < 0 ? 0 : (k >= cdf.length ? 1 : cdf[k]));
const probLt = (cdf, k) => probLe(cdf, k - 1);
const probGt = (cdf, k) => 1 - probLe(cdf, k);

const toOdds = (p) => (p && p > 1e-9 ? parseFloat((1 / p).toFixed(2)) : null);

const convertObjToOdds = (obj) => {
    const out = {};
    for (const k in obj) out[k] = toOdds(obj[k]);
    return out;
};

const calcOUFromDist = (dist, maxLine) => {
    const cdf = cdfFromDist(dist);
    const base = {};

    const ouForLine = (L) => {
        const isInt = Math.abs(L - Math.round(L)) < 1e-9;
        if (!isInt) {
            const kUnder = Math.floor(L);
            const pUnder = probLe(cdf, kUnder);
            return {
                over: 1 - pUnder,
                under: pUnder,
                push: 0
            };
        }
        const k = Math.round(L);
        const pPush = probEq(dist, k);
        const denom = 1 - pPush;
        if (denom <= 1e-12) return {
            over: null,
            under: null,
            push: pPush
        };
        const pOverRaw = probGt(cdf, k);
        const pUnderRaw = probLt(cdf, k);
        return {
            over: pOverRaw / denom,
            under: pUnderRaw / denom,
            push: pPush
        };
    };

    for (let L = 0; L <= maxLine + 1e-9; L += 0.5) base[L.toFixed(2)] = ouForLine(L);

    const res = {};
    for (let L = 0.5; L <= maxLine + 1e-9; L += 0.5) {
        const v = base[L.toFixed(2)];
        if (!v) continue;
        // Use normalized keys for fair odds structure
        const normKey = normalizeLineStr(L);
        res[`Over ${normKey}`] = v.over;
        res[`Under ${normKey}`] = v.under;
    }
    return res;
};

const calcTeamTotalsOU = (teamDist, maxLine) => calcOUFromDist(teamDist, maxLine);

const calcCleanSheet = (matrix) => {
    const homeCS = sumProb(matrix, (h, a) => a === 0);
    const awayCS = sumProb(matrix, (h, a) => h === 0);
    return {
        clean_sheet_home: {
            Yes: homeCS,
            No: 1 - homeCS
        },
        clean_sheet_away: {
            Yes: awayCS,
            No: 1 - awayCS
        },
    };
};

const calcWinToNil = (matrix) => {
    const homeWinToNil = sumProb(matrix, (h, a) => h > a && a === 0);
    const awayWinToNil = sumProb(matrix, (h, a) => a > h && h === 0);
    const no = 1 - homeWinToNil - awayWinToNil;
    return {
        Home: homeWinToNil,
        Away: awayWinToNil,
        No: clamp(no, 0, 1)
    };
};

const calc1X2 = (matrix) => ({
    "1": sumProb(matrix, (h, a) => h > a),
    "X": sumProb(matrix, (h, a) => h === a),
    "2": sumProb(matrix, (h, a) => h < a),
});

const calcBTTS = (matrix) => {
    const yes = sumProb(matrix, (h, a) => h > 0 && a > 0);
    return {
        Yes: yes,
        No: 1 - yes
    };
};

const calcDNB = (probs1X2) => {
    const denom = probs1X2["1"] + probs1X2["2"];
    if (!denom || denom <= 1e-12) return {
        "1": null,
        "2": null
    };
    return {
        "1": probs1X2["1"] / denom,
        "2": probs1X2["2"] / denom
    };
};

const calculateEuropeanHandicap = (matrix, homeHcp, awayHcp = 0) => {
    const p1 = sumProb(matrix, (h, a) => (h + homeHcp) > (a + awayHcp));
    const pX = sumProb(matrix, (h, a) => (h + homeHcp) === (a + awayHcp));
    const p2 = sumProb(matrix, (h, a) => (h + homeHcp) < (a + awayHcp));
    return {
        "1": p1,
        "X": pX,
        "2": p2
    };
};

const calcPoissonOU = (lambda, maxLine) => {
    lambda = clamp(safeNum(lambda, 0), 0, 50);
    const kMax = Math.max(30, Math.ceil(maxLine + lambda + 6 * Math.sqrt(Math.max(lambda, 1e-6))));
    const pmf = poissonPmfSeries(lambda, kMax);
    const cdf = [];
    let s = 0;
    for (let k = 0; k <= kMax; k++) {
        s += pmf[k];
        cdf[k] = s;
    }
    if (cdf.length) cdf[cdf.length - 1] = 1;
    const P_le = (k) => (k < 0 ? 0 : (k >= cdf.length ? 1 : cdf[k]));
    const P_eq = (k) => (k < 0 || k >= pmf.length ? 0 : pmf[k]);
    const out = {};
    for (let L = 0.5; L <= maxLine + 1e-9; L += 0.5) {
        const isInt = Math.abs(L - Math.round(L)) < 1e-9;
        if (!isInt) {
            const kUnder = Math.floor(L);
            const pUnder = P_le(kUnder);
            out[`Over ${parseFloat(L)}`] = 1 - pUnder;
            out[`Under ${parseFloat(L)}`] = pUnder;
        } else {
            const k = Math.round(L);
            const pPush = P_eq(k);
            const denom = 1 - pPush;
            if (denom <= 1e-12) {
                out[`Over ${parseFloat(L)}`] = null;
                out[`Under ${parseFloat(L)}`] = null;
            } else {
                const pOverRaw = 1 - P_le(k);
                const pUnderRaw = P_le(k - 1);
                out[`Over ${parseFloat(L)}`] = pOverRaw / denom;
                out[`Under ${parseFloat(L)}`] = pUnderRaw / denom;
            }
        }
    }

    // Normalize keys in Poisson OU too
    const outNorm = {};
    for(const k in out) {
       const m = k.match(/^(Over|Under)\s+(.+)$/);
       if (m) {
           outNorm[`${m[1]} ${normalizeLineStr(m[2])}`] = out[k];
       } else {
           outNorm[k] = out[k];
       }
    }
    return outNorm;
};

// ==================== // VALUE DETECTION (PRO) // ====================

function devigProportional(bookieMarketObj, selectionKey) {
    if (!bookieMarketObj || !bookieMarketObj[selectionKey]) return null;
    let sumInv = 0;
    let selOdd = safeNum(bookieMarketObj[selectionKey], 0);
    if (selOdd <= 1e-12) return null;

    let validCount = 0;
    for (const k in bookieMarketObj) {
        const o = safeNum(bookieMarketObj[k], 0);
        if (o > 1e-12) {
            sumInv += 1 / o;
            validCount++;
        }
    }
    if (sumInv <= 1e-12) return null;

    // DEBUG HIGH OVERROUND
    if (sumInv > 1.5 && validCount < 10) {
        console.log(`High Overround ${sumInv} in group:`, bookieMarketObj);
    }

    const devigProb = (1 / selOdd) / sumInv;
    return {
        devigProb,
        overround: sumInv,
        count: validCount
    };
}

function getTeamName(teamObj) {
    if (!teamObj) return "Unknown";
    return teamObj.squad || teamObj.Squad || teamObj.team_name || teamObj.name || teamObj.team || teamObj.Team || "Unknown";
}

function buildCleanOutput(data, predictions, valueBets, matrixMatch) {
    const homeName = getTeamName(data?.home);
    const awayName = getTeamName(data?.away);
    const fixtureId = data?.response?.[0]?.fixture?.id || data?.fixture_id || null;
    const fixtureDate = data?.response?.[0]?.fixture?.date || data?.fixture_date || null;

    const sortedVB = (valueBets || []).slice().sort((a, b) => (parseFloat(b.edge_percent) || 0) - (parseFloat(a.edge_percent) || 0));

    // Top Scenarios
    const topScenarios = [];

    // 1X2
    const p1x2 = predictions.probs["1X2"];
    if (p1x2) {
        const best1x2 = [
            { type: "1X2", selection: "1", prob: p1x2["1"] },
            { type: "1X2", selection: "X", prob: p1x2["X"] },
            { type: "1X2", selection: "2", prob: p1x2["2"] },
        ].sort((a, b) => b.prob - a.prob)[0];
        if (best1x2) topScenarios.push(best1x2);
    }

    // OU 2.5
    const ou25 = predictions.fair_odds["OverUnder"];
    if (ou25) {
        const oOdd = safeNum(ou25["Over 2.5"], 0);
        const uOdd = safeNum(ou25["Under 2.5"], 0);

        if (oOdd > 1e-9 && uOdd > 1e-9) {
            const o = 1 / oOdd;
            const u = 1 / uOdd;
            if (o > u) topScenarios.push({ type: "OU", selection: "Over 2.5", prob: o });
            else topScenarios.push({ type: "OU", selection: "Under 2.5", prob: u });
        }
    }

    // Correct Score
    if (matrixMatch) {
        const scores = [];
        for(let h=0; h<matrixMatch.length; h++) {
            for(let a=0; a<matrixMatch[h].length; a++) {
                scores.push({ type: "scoreline", selection: `${h}-${a}`, prob: matrixMatch[h][a] });
            }
        }
        scores.sort((a,b) => b.prob - a.prob);
        if (scores.length > 0) topScenarios.push(scores[0]);
    }

    return {
        fixture_id: fixtureId,
        fixture_date: fixtureDate,
        match: {
            home: homeName,
            away: awayName
        },
        top_scenarios: topScenarios,
        value_bets: sortedVB.map(v => ({
            market: v.market,
            outcome: v.outcome,
            bookmaker: v.bookmaker,
            fair_odd: v.fair_odd,
            bookie_odd: v.bookie_odd,
            edge_percent: v.edge_percent, // EV Edge
            ev_edge_raw: v.ev_edge_raw,
            fair_prob_raw: v.fair_prob_raw,
            market_edge_percent: v.market_edge_percent, // Devig Edge
            rating_score: v.rating_score,
            devig_prob_percent: v.devig_prob_percent ?? null,
            fair_prob_percent: v.fair_prob_percent ?? null,
            overround: v.overround ?? null,
        })),
    };
}

// ==================== // MAIN LOGIC // ====================

const results = [];

for (const item of items) {
    const data = item.json;
    if (!data?.home || !data?.away) {
        results.push(item);
        continue;
    }

    const home = data.home;
    const away = data.away;
    const homeName = getTeamName(home);
    const awayName = getTeamName(away);
    const bookmakerName = data?.response?.[0]?.bookmakers?.[0]?.name || "Unknown";

    const hAttack = safeNum(home["Shooting_npxG"], 0);
    const aAttack = safeNum(away["Shooting_npxG"], 0);
    const aOppXG = safeNum(away?.opponent?.["opp_Standard_Stats_Opp_xG"], 0);
    const hOppXG = safeNum(home?.opponent?.["opp_Standard_Stats_Opp_xG"], 0);

    const homeFormFactor = calculateFormFactor(home?.team_season?.form);
    const awayFormFactor = calculateFormFactor(away?.team_season?.form);

    const lambdaGoalsHome = clamp(clamp((hAttack + aOppXG) / 2, 0.05, 4.5) * homeFormFactor, 0.05, 5.0);
    const lambdaGoalsAway = clamp(clamp((aAttack + hOppXG) / 2, 0.05, 4.5) * awayFormFactor, 0.05, 5.0);

    let homeHTPct = safeNum(home?.team_season?.["goals_for_minute_0-15_percentage"], 0) +
        safeNum(home?.team_season?.["goals_for_minute_16-30_percentage"], 0) +
        safeNum(home?.team_season?.["goals_for_minute_31-45_percentage"], 0);

    let awayHTPct = safeNum(away?.team_season?.["goals_for_minute_0-15_percentage"], 0) +
        safeNum(away?.team_season?.["goals_for_minute_16-30_percentage"], 0) +
        safeNum(away?.team_season?.["goals_for_minute_31-45_percentage"], 0);

    if (homeHTPct > 1.5) homeHTPct /= 100;
    if (awayHTPct > 1.5) awayHTPct /= 100;

    const homeHT = clamp(homeHTPct, 0.05, 0.95);
    const awayHT = clamp(awayHTPct, 0.05, 0.95);

    const lambdaGoalsHomeHT = lambdaGoalsHome * homeHT;
    const lambdaGoalsAwayHT = lambdaGoalsAway * awayHT;
    const lambdaGoalsHome2H = lambdaGoalsHome * (1 - homeHT);
    const lambdaGoalsAway2H = lambdaGoalsAway * (1 - awayHT);

    const MAX_GOALS = 15;
    const matrixMatch = generateMatrix(lambdaGoalsHome, lambdaGoalsAway, MAX_GOALS);
    const matrixHT = generateMatrix(lambdaGoalsHomeHT, lambdaGoalsAwayHT, MAX_GOALS);
    const matrix2H = generateMatrix(lambdaGoalsHome2H, lambdaGoalsAway2H, MAX_GOALS);

    const totalDistFT = getTotalDist(matrixMatch);
    const totalDistHT = getTotalDist(matrixHT);
    const totalDist2H = getTotalDist(matrix2H);

    const margFT = getMarginals(matrixMatch);

    const probs1X2 = calc1X2(matrixMatch);
    const probs1X2_1H = calc1X2(matrixHT);
    const probs1X2_2H = calc1X2(matrix2H);

    const prob1X = probs1X2["1"] + probs1X2["X"];
    const probX2 = probs1X2["X"] + probs1X2["2"];
    const prob12 = probs1X2["1"] + probs1X2["2"];

    const probsDNB = calcDNB(probs1X2);
    const probsDNB_1H = calcDNB(probs1X2_1H);
    const probsDNB_2H = calcDNB(probs1X2_2H);

    const probsHTFT = (() => {
        const mapping = {
            "1": "Home",
            "X": "Draw",
            "2": "Away"
        };
        const expanded = {};
        for (let h1 = 0; h1 < MAX_GOALS; h1++) {
            for (let a1 = 0; a1 < MAX_GOALS; a1++) {
                const pHT = matrixHT[h1][a1];
                const htRes = h1 > a1 ? "1" : (h1 === a1 ? "X" : "2");
                for (let h2 = 0; h2 < MAX_GOALS; h2++) {
                    for (let a2 = 0; a2 < MAX_GOALS; a2++) {
                        const p2 = matrix2H[h2][a2];
                        const ftH = h1 + h2;
                        const ftA = a1 + a2;
                        const ftRes = ftH > ftA ? "1" : (ftH === ftA ? "X" : "2");
                        const key = `${mapping[htRes]}/${mapping[ftRes]}`;
                        expanded[key] = (expanded[key] || 0) + (pHT * p2);
                    }
                }
            }
        }
        return expanded;
    })();

    const probsOU_Match = calcOUFromDist(totalDistFT, 7.5);
    const probsOU_1H = calcOUFromDist(totalDistHT, 4.5);
    const probsOU_2H = calcOUFromDist(totalDist2H, 4.5);

    const probsBTTS = calcBTTS(matrixMatch);
    const probsBTTS_1H = calcBTTS(matrixHT);
    const probsBTTS_2H = calcBTTS(matrix2H);

    const handicapLines = [-3, -2, -1, 1, 2, 3];
    const probsHandicap = {};
    for (const hcp of handicapLines) {
        const res = calculateEuropeanHandicap(matrixMatch, hcp, 0);
        const sign = hcp > 0 ? "+" : "";
        const key = `(${sign}${hcp})`; // Already normalized in loop
        // Ensure consistent formatting
        const normHcp = normalizeLineStr(hcp);
        const signNorm = parseFloat(normHcp) > 0 ? "+" : "";
        const keyNorm = `(${signNorm}${normHcp})`;

        probsHandicap[`1 ${keyNorm}`] = res["1"];
        probsHandicap[`X ${keyNorm}`] = res["X"];
        probsHandicap[`2 ${keyNorm}`] = res["2"];
    }

    const probsTotalHome = calcTeamTotalsOU(margFT.home, 4.5);
    const probsTotalAway = calcTeamTotalsOU(margFT.away, 4.5);

    const cleanSheets = calcCleanSheet(matrixMatch);
    const winToNil = calcWinToNil(matrixMatch);

    const lambdaCornersHome = clamp((safeNum(home["PassTypes_CK"], 0) + safeNum(away?.opponent?.["opp_PassTypes_Opp_CK"], 0)) / 2, 0.1, 20);
    const lambdaCornersAway = clamp((safeNum(away["PassTypes_CK"], 0) + safeNum(home?.opponent?.["opp_PassTypes_Opp_CK"], 0)) / 2, 0.1, 20);
    const lambdaCornersTotal = clamp(lambdaCornersHome + lambdaCornersAway, 0.2, 30);
    const probsCornersOU = calcPoissonOU(lambdaCornersTotal, 14.5);

    const homeCardPoints = safeNum(home["Standard_Stats_CrdY"], 0) + 2 * safeNum(home["Standard_Stats_CrdR"], 0);
    const awayCardPoints = safeNum(away["Standard_Stats_CrdY"], 0) + 2 * safeNum(away["Standard_Stats_CrdR"], 0);
    const homeOppCardPoints = safeNum(home?.opponent?.["opp_Standard_Stats_Opp_CrdY"], 0) + 2 * safeNum(home?.opponent?.["opp_Standard_Stats_Opp_CrdR"], 0);
    const awayOppCardPoints = safeNum(away?.opponent?.["opp_Standard_Stats_Opp_CrdY"], 0) + 2 * safeNum(away?.opponent?.["opp_Standard_Stats_Opp_CrdR"], 0);

    const lambdaCardsHome = clamp((homeCardPoints + awayOppCardPoints) / 2, 0.05, 10);
    const lambdaCardsAway = clamp((awayCardPoints + homeOppCardPoints) / 2, 0.05, 10);
    const lambdaCardsTotal = clamp(lambdaCardsHome + lambdaCardsAway, 0.1, 15);
    const probsCardsOU = calcPoissonOU(lambdaCardsTotal, 6.5);

    const comboBTTS = {
        "Home/Yes": sumProb(matrixMatch, (h, a) => h > a && h > 0 && a > 0),
        "Draw/Yes": sumProb(matrixMatch, (h, a) => h === a && h > 0 && a > 0),
        "Away/Yes": sumProb(matrixMatch, (h, a) => a > h && h > 0 && a > 0),
        "Home/No": sumProb(matrixMatch, (h, a) => h > a && (h === 0 || a === 0)),
        "Draw/No": sumProb(matrixMatch, (h, a) => h === a && (h === 0 || a === 0)),
        "Away/No": sumProb(matrixMatch, (h, a) => a > h && (h === 0 || a === 0)),
    };

    const comboResultTotal = {
        "Home/Over 2.5": sumProb(matrixMatch, (h, a) => h > a && (h + a) > 2.5),
        "Draw/Over 2.5": sumProb(matrixMatch, (h, a) => h === a && (h + a) > 2.5),
        "Away/Over 2.5": sumProb(matrixMatch, (h, a) => a > h && (h + a) > 2.5),
        "Home/Under 2.5": sumProb(matrixMatch, (h, a) => h > a && (h + a) < 2.5),
        "Draw/Under 2.5": sumProb(matrixMatch, (h, a) => h === a && (h + a) < 2.5),
        "Away/Under 2.5": sumProb(matrixMatch, (h, a) => a > h && (h + a) < 2.5),
    };

    const fairOdds = {
        "1X2": convertObjToOdds(probs1X2),
        "1X2_1H": convertObjToOdds(probs1X2_1H),
        "1X2_2H": convertObjToOdds(probs1X2_2H),
        "DoubleChance": {
            "1X": toOdds(prob1X),
            "X2": toOdds(probX2),
            "12": toOdds(prob12)
        },
        "DNB": {
            "1": toOdds(probsDNB["1"]),
            "2": toOdds(probsDNB["2"])
        },
        "DNB_1H": {
            "1": toOdds(probsDNB_1H["1"]),
            "2": toOdds(probsDNB_1H["2"])
        },
        "DNB_2H": {
            "1": toOdds(probsDNB_2H["1"]),
            "2": toOdds(probsDNB_2H["2"])
        },
        "BTTS": convertObjToOdds(probsBTTS),
        "BTTS_1H": convertObjToOdds(probsBTTS_1H),
        "BTTS_2H": convertObjToOdds(probsBTTS_2H),
        "OverUnder": convertObjToOdds(probsOU_Match),
        "OverUnder_1H": convertObjToOdds(probsOU_1H),
        "OverUnder_2H": convertObjToOdds(probsOU_2H),
        "Handicap": convertObjToOdds(probsHandicap),
        "ht_ft": convertObjToOdds(probsHTFT),
        "Corners_OU": convertObjToOdds(probsCornersOU),
        "Cards_OU": convertObjToOdds(probsCardsOU),
        "Total_Home": convertObjToOdds(probsTotalHome),
        "Total_Away": convertObjToOdds(probsTotalAway),
        "clean_sheet_home": convertObjToOdds(cleanSheets.clean_sheet_home),
        "clean_sheet_away": convertObjToOdds(cleanSheets.clean_sheet_away),
        "WinToNil": {
            Home: toOdds(winToNil.Home),
            Away: toOdds(winToNil.Away),
            No: toOdds(winToNil.No)
        },
        "Combo_Result_BTTS": convertObjToOdds(comboBTTS),
        "Combo_Result_Total": convertObjToOdds(comboResultTotal),
    };

    const predictions = {
        lambdas: {},
        probs: { "1X2": probs1X2 },
        fair_odds: fairOdds,
    };

    let valueBets = [];
    const seenFairOdds = new Map();

    if (data.bookmaker_odds) {
        const bookie = data.bookmaker_odds;

        const pushValue = (market, outcome, fairOdd, bookieOdd, devig) => {
            const b = safeNum(bookieOdd, 0);
            const f = safeNum(fairOdd, 0);
            if (b <= 1.01 || f <= 1.01) return;

            // Betability Gate (Mandatory)
            if (b <= f + 0.01) return;

            const fStr = f.toFixed(2);
            if (seenFairOdds.has(fStr)) {
                const prev = seenFairOdds.get(fStr);
                if (prev !== `${market}:${outcome}`) {
                    console.log(`DEBUG: Duplicate Fair Odd ${fStr} seen in ${market}:${outcome}. Prev: ${prev}`);
                }
            } else {
                seenFairOdds.set(fStr, `${market}:${outcome}`);
            }

            const fairProb = 1 / f;
            const impliedProb = 1 / b;
            const marketProb = devig?.devigProb ?? impliedProb;

            // EV Edge (Betable)
            const evEdge = (b / f) - 1;

            // Market Edge (Devigged)
            let marketEdge = null;
            if (marketProb > 1e-9) {
                marketEdge = (fairProb / marketProb) - 1;
            }

            // LOGS
            console.log(`MARKET: ${market} OUTCOME: ${outcome} F_ODD: ${f} B_ODD: ${b} F_PROB: ${round2(fairProb)} M_PROB: ${round2(marketProb)} EV_EDGE: ${(evEdge*100).toFixed(1)}%`);

            // Filters on EV Edge
            if (evEdge <= 0.10 || evEdge > 0.50) return;

            // Sanity Check for 2-way devig mirror
            if (devig?.count === 2 && Math.abs(marketProb - impliedProb) > 0.25) {
                console.warn(`WARNING: Potential mirrored mapping detected for ${market}:${outcome}. Implied: ${round2(impliedProb)}, Devig: ${round2(marketProb)}`);
            }

            const ratingScore = computeRatingScore(fairProb, evEdge, marketEdge);

            valueBets.push({
                market,
                outcome,
                bookmaker: bookmakerName,
                fair_odd: f,
                bookie_odd: b,
                edge_percent: (evEdge * 100).toFixed(1) + "%",
                ev_edge_raw: round2(evEdge),
                fair_prob_raw: round2(fairProb),
                market_edge_percent: marketEdge !== null ? (marketEdge * 100).toFixed(1) + "%" : null,
                rating_score: ratingScore,
                devig_prob_percent: devig?.devigProb ? (devig.devigProb * 100).toFixed(1) + "%" : null,
                fair_prob_percent: (fairProb * 100).toFixed(1) + "%",
                overround: devig?.overround ? round2(devig.overround) : null,
            });
        };

        const check3Way = (marketKey, outcomes) => {
            const bM = bookie[marketKey];
            const fM = fairOdds[marketKey];
            if (!bM || !fM) return;
            const hasAll = outcomes.every(k => bM[k]);
            if (!hasAll) return;
            outcomes.forEach(out => {
                const fOdd = fM[out];
                const bOdd = bM[out];
                if (!fOdd || !bOdd) return;
                const devig = devigProportional(bM, out);
                pushValue(marketKey, out, fOdd, bOdd, devig);
            });
        };
        check3Way("1X2", ["1", "X", "2"]);
        check3Way("1X2_1H", ["1", "X", "2"]);
        check3Way("1X2_2H", ["1", "X", "2"]);

        const check2Way = (marketKey, outcomes) => {
            const bM = bookie[marketKey];
            const fM = fairOdds[marketKey];
            if (!bM || !fM) return;
            const hasAll = outcomes.every(k => bM[k]);
            if (!hasAll) return;
            outcomes.forEach(out => {
                const fOdd = fM[out];
                const bOdd = bM[out];
                if (!fOdd || !bOdd) return;
                const devig = devigProportional(bM, out);
                pushValue(marketKey, out, fOdd, bOdd, devig);
            });
        };
        check2Way("DNB", ["1", "2"]);
        check2Way("DNB_1H", ["1", "2"]);
        check2Way("DNB_2H", ["1", "2"]);
        check2Way("BTTS", ["Yes", "No"]);
        check2Way("BTTS_1H", ["Yes", "No"]);
        check2Way("BTTS_2H", ["Yes", "No"]);
        check2Way("clean_sheet_home", ["Yes", "No"]);
        check2Way("clean_sheet_away", ["Yes", "No"]);
        if (bookie["WinToNil"] && bookie["WinToNil"]["No"]) check3Way("WinToNil", ["Home", "Away", "No"]);

        if (bookie["DoubleChance"] && fairOdds["DoubleChance"]) {
            const bM = bookie["DoubleChance"];
            const fM = fairOdds["DoubleChance"];
            const map = { "Home/Draw": fM["1X"], "Home/Away": fM["12"], "Draw/Away": fM["X2"] };
            for (const k in map) {
                if (map[k] && bM[k]) pushValue("DoubleChance", k, map[k], bM[k], null);
            }
        }

        const checkOU = (marketKey) => {
            const bM = bookie[marketKey];
            const fM = fairOdds[marketKey];
            if (!bM || !fM) return;
            const lines = new Set();
            for (const k in bM) {
                const m = String(k).match(/^(Over|Under)\s+(.+)$/i);
                if (m) lines.add(m[2]);
            }
            lines.forEach(lineStr => {
                const raw = lineStr;
                const norm = normalizeLineStr(raw);
                if (!norm) return;

                const line = parseFloat(norm);
                const isInteger = Math.abs(line % 1) < 1e-9;

                // Policy 1: Asian Filter (Reject .25 / .75 everywhere)
                if (Math.abs(line % 0.5) > 1e-9) return;

                // Policy 2: Goal Totals -> .5 only (Also Team Totals restricted to .5)
                const isGoalOrTeamTotal = ["OverUnder", "OverUnder_1H", "OverUnder_2H", "Total_Home", "Total_Away"].includes(marketKey);
                if (isGoalOrTeamTotal && isInteger) return;

                // Whitelist for Integers: Only Cards & Corners allowed
                const allowedIntegerMarkets = ["Corners_OU", "Cards_OU"];
                if (isInteger && !allowedIntegerMarkets.includes(marketKey)) return;

                // 3-way Integer Totals Check
                if (isInteger) {
                    const rawL = String(raw).toLowerCase();
                    const normL = String(norm).toLowerCase();
                    const hasExactly = Object.keys(bM).some(k => {
                        const kk = String(k).toLowerCase();
                        // Boundary check: look for exact number with boundaries
                        // e.g. "exactly 4" or "exact 4" or "=4" or "= 4"
                        const isExactKeyword = /exact|exactly|=|\bpush\b|\brefund\b|\bvoid\b/i.test(kk);

                        // Check if line number appears as whole word
                        const lineRegexRaw = new RegExp(`\\b${rawL}\\b`);
                        const lineRegexNorm = new RegExp(`\\b${normL}\\b`);
                        const matchesLine = lineRegexRaw.test(kk) || lineRegexNorm.test(kk);

                        // But ignore if key also contains Over/Under (which would imply it's a 2-way key with notes)
                        const isOUSelection = /^(over|under)\b/i.test(kk.trim());

                        return isExactKeyword && matchesLine && !isOUSelection;
                    });
                    if (hasExactly) return;
                }

                // 3. Normalized Key Construction for FAIR lookup and OUTPUT
                // Bookie lookup MUST use RAW keys from lines set
                const overKeyB = `Over ${raw}`;
                const underKeyB = `Under ${raw}`;

                const overKeyF = `Over ${norm}`;
                const underKeyF = `Under ${norm}`;

                const overKeyOut = `Over ${norm}`;
                const underKeyOut = `Under ${norm}`;

                if (!bM[overKeyB] || !bM[underKeyB]) return;

                const mini = { [overKeyB]: bM[overKeyB], [underKeyB]: bM[underKeyB] };
                const devigOver = devigProportional(mini, overKeyB);
                const devigUnder = devigProportional(mini, underKeyB);

                if (isInteger) {
                    // Safe overround range check
                    if (!devigOver || devigOver.overround < 1.01 || devigOver.overround > 1.15) {
                        console.log(`Skipping Integer Line ${lineStr} on ${marketKey}: Overround ${devigOver?.overround}`);
                        return;
                    }
                }

                if (fM[overKeyF]) pushValue(marketKey, overKeyOut, fM[overKeyF], bM[overKeyB], devigOver);
                if (fM[underKeyF]) pushValue(marketKey, underKeyOut, fM[underKeyF], bM[underKeyB], devigUnder);
            });
        };
        ["OverUnder", "OverUnder_1H", "OverUnder_2H", "Corners_OU", "Cards_OU", "Total_Home", "Total_Away"].forEach(checkOU);

        const checkHandicapMarket = (marketKey) => {
            const bM = bookie[marketKey];
            const fM = fairOdds[marketKey];
            if (!bM || !fM) return;

            const groups = {};
            for (const k in bM) {
                const m = k.match(/([+-]?\d+(\.\d+)?)\)?$/);
                if (!m) continue;

                const kTrim = k.trim();
                let outcomeType = null;

                if (/^1\b/.test(kTrim) || /^Home\b/i.test(kTrim)) outcomeType = "1";
                else if (/^X\b/.test(kTrim) || /^Draw\b/i.test(kTrim) || /^Tie\b/i.test(kTrim)) outcomeType = "X";
                else if (/^2\b/.test(kTrim) || /^Away\b/i.test(kTrim)) outcomeType = "2";

                if (!outcomeType) continue;

                let val = parseFloat(m[1]); // e.g. -1.0
                let line = null;

                if (outcomeType === "1" || outcomeType === "X") {
                    line = val;
                } else if (outcomeType === "2") {
                    line = -val;
                }

                if (line !== null) {
                    const normLine = parseFloat(normalizeLineStr(line)); // normalize -0 to 0 etc
                    if (!groups[normLine]) groups[normLine] = {};
                    groups[normLine][k] = bM[k];
                }
            }

            for (const lineStr in groups) {
                const subMarket = groups[lineStr];
                if (Object.keys(subMarket).length !== 3) continue;
                const line = parseFloat(lineStr);
                const normLineStr = normalizeLineStr(line);

                // Fallback Logic for Fair Odds Lookup
                const sign = line > 0 ? "+" : "";
                const primarySuffix = `(${sign}${normLineStr})`;

                const fallbackLine = -line;
                const fallbackNorm = normalizeLineStr(fallbackLine);
                const fallbackSign = parseFloat(fallbackNorm) > 0 ? "+" : "";
                const fallbackSuffix = `(${fallbackSign}${fallbackNorm})`;

                // Check which set exists in Fair Odds
                // Check all 3 outcomes to be safe
                const hasPrimary = fM[`1 ${primarySuffix}`] !== undefined && fM[`X ${primarySuffix}`] !== undefined && fM[`2 ${primarySuffix}`] !== undefined;
                const hasFallback = fM[`1 ${fallbackSuffix}`] !== undefined && fM[`X ${fallbackSuffix}`] !== undefined && fM[`2 ${fallbackSuffix}`] !== undefined;

                let activeSuffix = null;
                if (hasPrimary) activeSuffix = primarySuffix;
                else if (hasFallback) {
                    activeSuffix = fallbackSuffix;
                    console.log(`HANDICAP FALLBACK USED: ${lineStr} ${primarySuffix} -> ${fallbackSuffix}`);
                }

                if (!activeSuffix) continue;

                const intKey1 = `1 ${activeSuffix}`;
                const intKeyX = `X ${activeSuffix}`;
                const intKey2 = `2 ${activeSuffix}`;

                for (const bk in subMarket) {
                    let matchedFairOdd = null;
                    const kTrim = bk.trim();

                    if (/^1\b/.test(kTrim) || /^Home\b/i.test(kTrim)) matchedFairOdd = fM[intKey1];
                    else if (/^X\b/.test(kTrim) || /^Draw\b/i.test(kTrim) || /^Tie\b/i.test(kTrim)) matchedFairOdd = fM[intKeyX];
                    else if (/^2\b/.test(kTrim) || /^Away\b/i.test(kTrim)) matchedFairOdd = fM[intKey2];

                    if (matchedFairOdd) {
                        const devig = devigProportional(subMarket, bk);
                        pushValue(marketKey, bk, matchedFairOdd, subMarket[bk], devig);
                    }
                }
            }
        };

        checkHandicapMarket("Handicap");
        checkHandicapMarket("Handicap_1H");
        checkHandicapMarket("Handicap_2H");

        ["Combo_Result_BTTS", "Combo_Result_Total", "ht_ft"].forEach(marketKey => {
            const bM = bookie[marketKey];
            const fM = fairOdds[marketKey];
            if (!bM || !fM) return;
            for (const k in bM) {
                if (!fM[k]) continue;
                pushValue(marketKey, k, fM[k], bM[k], devigProportional(bM, k));
            }
        });
    }

    const hasTotalHomeUnder05 = valueBets.some(v => v.market === "Total_Home" && v.outcome === "Under 0.5");
    const hasTotalAwayUnder05 = valueBets.some(v => v.market === "Total_Away" && v.outcome === "Under 0.5");

    if (hasTotalHomeUnder05) {
        valueBets = valueBets.filter(v => !((v.market === "clean_sheet_away" && v.outcome === "Yes") || (v.market === "WinToNil" && v.outcome === "Away")));
    }
    if (hasTotalAwayUnder05) {
        valueBets = valueBets.filter(v => !((v.market === "clean_sheet_home" && v.outcome === "Yes") || (v.market === "WinToNil" && v.outcome === "Home")));
    }

    const topMarkets = [];
    const p1x2 = predictions.probs["1X2"];
    if (p1x2) {
        const best = [
            { k: `${homeName} win`, p: p1x2["1"] },
            { k: "Draw", p: p1x2["X"] },
            { k: `${awayName} win`, p: p1x2["2"] },
        ].sort((a, b) => b.p - a.p)[0];
        if (best) topMarkets.push({ market: "1X2 (model)", selection: best.k, prob_percent: pct1(best.p) });
    }

    const cleanOutput = buildCleanOutput(data, predictions, valueBets, matrixMatch);
    results.push({ json: cleanOutput });
}

return results;
