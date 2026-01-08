
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

// Safer Poisson PMF computation (avoids factorial overflow)
// Uses recurrence: P(k) = P(k-1) * lambda / k
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

// Build independent Poisson goal matrix and renormalize (handles truncation)
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
    if (cdf.length) cdf[cdf.length - 1] = 1; // snap
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

// ==================== // MARKET CALCULATORS // ====================

// OU totals with correct push handling on integer lines (conditioned on no push) + quarters
const calcOUFromDist = (dist, maxLine) => {
    const cdf = cdfFromDist(dist);
    const base = {}; // keyed by "0.00" etc

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

        const pOverRaw = probGt(cdf, k); // > k
        const pUnderRaw = probLt(cdf, k); // < k
        return {
            over: pOverRaw / denom,
            under: pUnderRaw / denom,
            push: pPush
        };
    };

    for (let L = 0; L <= maxLine + 1e-9; L += 0.5) base[L.toFixed(2)] = ouForLine(L);

    const res = {};
    // .5 & integer
    for (let L = 0.5; L <= maxLine + 1e-9; L += 0.5) {
        const v = base[L.toFixed(2)];
        if (!v) continue;
        res[`Over ${parseFloat(L)}`] = v.over;
        res[`Under ${parseFloat(L)}`] = v.under;
    }
    // quarters (avg of neighbors)
    for (let k = 0; k <= Math.floor(maxLine); k++) {
        const a0 = base[(k).toFixed(2)];
        const a05 = base[(k + 0.5).toFixed(2)];
        const a1 = base[(k + 1).toFixed(2)];

        const L25 = k + 0.25;
        const L75 = k + 0.75;

        if (a0 && a05) {
            res[`Over ${L25}`] = (a0.over + a05.over) / 2;
            res[`Under ${L25}`] = (a0.under + a05.under) / 2;
        }
        if (a05 && a1) {
            res[`Over ${L75}`] = (a05.over + a1.over) / 2;
            res[`Under ${L75}`] = (a05.under + a1.under) / 2;
        }
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

// Poisson OU via CDF with integer push handling (corners/cards)
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
    return out;
};

// ==================== // VALUE DETECTION (PRO) // ====================

// Devig proportional on available outcomes.
// Returns {devigProb, overround} for a specific selection if possible.
function devigProportional(bookieMarketObj, selectionKey) {
    if (!bookieMarketObj || !bookieMarketObj[selectionKey]) return null;

    let sumInv = 0;
    let selOdd = safeNum(bookieMarketObj[selectionKey], 0);
    if (selOdd <= 1e-12) return null;

    let valid = 0;
    for (const k in bookieMarketObj) {
        const o = safeNum(bookieMarketObj[k], 0);
        if (o > 1e-12) {
            sumInv += 1 / o;
            valid++;
        }
    }
    // Need at least 2 valid outcomes to represent a market
    if (valid < 2 || sumInv <= 1e-12) return null;

    const devigProb = (1 / selOdd) / sumInv;
    return {
        devigProb,
        overround: sumInv
    };
}

// sanity: ignore crazy edges caused by market mismatch
function sanityValueGate({
    market,
    fairOdd,
    bookieOdd,
    devigProb,
    fairProb
}) {
    if (!fairOdd || !bookieOdd) return false;

    // very extreme "certain" lines are usually mismatches
    if (fairProb > 0.97 && (market || "").toLowerCase().includes("handicap")) return false;

    // ignore if any odds nonsense
    if (bookieOdd < 1.01 || fairOdd < 1.01) return false;

    // if devigProb exists, require fairProb meaningfully > devigProb (small buffer)
    if (Number.isFinite(devigProb)) {
        if (!(fairProb > devigProb + 0.02)) return false; // +2% absolute
    }

    return true;
}

// detect if a handicap market looks "European 3-way" vs "2-way Asian"
function isEuropeanHandicap3Way(bookieHandicapObj) {
    if (!bookieHandicapObj) return false;
    const keys = Object.keys(bookieHandicapObj);
    // our european keys are like "1 (-1)", "X (-1)", "2 (-1)" or similar
    const has1 = keys.some(k => /^\s*1\s*\(/.test(k));
    const hasX = keys.some(k => /^\s*X\s*\(/.test(k));
    const has2 = keys.some(k => /^\s*2\s*\(/.test(k));
    if (has1 && hasX && has2) return true;

    // if it uses "Home/Draw/Away" also 3-way
    const hasHome = keys.some(k => /^\s*Home\s*\(/.test(k) || /Home [+-]\d/.test(k));
    const hasDraw = keys.some(k => /^\s*Draw\s*\(/.test(k) || /Draw [+-]\d/.test(k));
    const hasAway = keys.some(k => /^\s*Away\s*\(/.test(k) || /Away [+-]\d/.test(k));
    return hasHome && hasDraw && hasAway;
}

// ==================== // OUTPUT CLEANER // ====================

function buildCleanOutput(data, predictions, valueBets) {
    const homeName = data?.home?.team_name || data?.home?.name || data?.home?.team || data?.home?.Team || "Home";
    const awayName = data?.away?.team_name || data?.away?.name || data?.away?.team || data?.away?.Team || "Away";

    // small “top markets” summary (interpretable)
    const p1x2 = predictions?.probs?.["1X2"] || null;

    const topMarkets = [];
    if (p1x2) {
        const homeP = p1x2["1"];
        const drawP = p1x2["X"];
        const awayP = p1x2["2"];
        const best = [{
                k: `${homeName} win`,
                p: homeP
            },
            {
                k: "Draw",
                p: drawP
            },
            {
                k: `${awayName} win`,
                p: awayP
            },
        ].filter(x => Number.isFinite(x.p)).sort((a, b) => b.p - a.p)[0];
        if (best) topMarkets.push({
            market: "1X2 (model)",
            selection: best.k,
            prob_percent: pct1(best.p)
        });
    }

    // sort value bets by edge descending
    const sortedVB = (valueBets || []).slice().sort((a, b) => (b.edge || 0) - (a.edge || 0));

    return {
        match: {
            home: homeName,
            away: awayName
        },
        lambdas: predictions?.lambdas || null,
        top_markets: topMarkets,
        value_bets: sortedVB.map(v => ({
            market: v.market,
            outcome: v.outcome,
            fair_odd: v.fair_odd,
            bookie_odd: v.bookie_odd,
            edge_percent: v.edge_percent,
            devig_prob_percent: v.devig_prob_percent ?? null,
            fair_prob_percent: v.fair_prob_percent ?? null,
            overround: v.overround ?? null,
        })),
        // If you want: keep fair odds. Otherwise comment this line.
        // fair_odds: predictions?.fair_odds || null,
    };
}

// ==================== // MAIN LOGIC // ====================

function processItems(items) {
    const results = [];
    for (const item of items) {
        const data = item.json;
        if (!data?.home || !data?.away) {
            results.push(item);
            continue;
        }

        const home = data.home;
        const away = data.away;

        // --- A) Lambdas goals
        const hAttack = safeNum(home["Shooting_npxG"], 0);
        const aAttack = safeNum(away["Shooting_npxG"], 0);
        const aOppXG = safeNum(away?.opponent?.["opp_Standard_Stats_Opp_xG"], 0);
        const hOppXG = safeNum(home?.opponent?.["opp_Standard_Stats_Opp_xG"], 0);

        const homeFormFactor = calculateFormFactor(home?.team_season?.form);
        const awayFormFactor = calculateFormFactor(away?.team_season?.form);

        const lambdaGoalsHome = clamp(clamp((hAttack + aOppXG) / 2, 0.05, 4.5) * homeFormFactor, 0.05, 5.0);
        const lambdaGoalsAway = clamp(clamp((aAttack + hOppXG) / 2, 0.05, 4.5) * awayFormFactor, 0.05, 5.0);

        // --- B) HT splits (auto-detect base 0-1 vs 0-100)
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

        // --- C) Matrices
        const MAX_GOALS = 15;
        const matrixMatch = generateMatrix(lambdaGoalsHome, lambdaGoalsAway, MAX_GOALS);
        const matrixHT = generateMatrix(lambdaGoalsHomeHT, lambdaGoalsAwayHT, MAX_GOALS);
        const matrix2H = generateMatrix(lambdaGoalsHome2H, lambdaGoalsAway2H, MAX_GOALS);

        const totalDistFT = getTotalDist(matrixMatch);
        const totalDistHT = getTotalDist(matrixHT);
        const totalDist2H = getTotalDist(matrix2H);

        const margFT = getMarginals(matrixMatch);

        // --- D) Market probabilities
        const probs1X2 = calc1X2(matrixMatch);
        const probs1X2_1H = calc1X2(matrixHT);
        const probs1X2_2H = calc1X2(matrix2H);

        const prob1X = probs1X2["1"] + probs1X2["X"];
        const probX2 = probs1X2["X"] + probs1X2["2"];
        const prob12 = probs1X2["1"] + probs1X2["2"];

        const probsDNB = calcDNB(probs1X2);
        const probsDNB_1H = calcDNB(probs1X2_1H);
        const probsDNB_2H = calcDNB(probs1X2_2H);

        // HT/FT
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

        // Handicap European (3-way)
        const handicapLines = [-3, -2, -1, 1, 2, 3];
        const probsHandicap = {};
        for (const hcp of handicapLines) {
            const res = calculateEuropeanHandicap(matrixMatch, hcp, 0);
            const sign = hcp > 0 ? "+" : "";
            const key = `(${sign}${hcp})`;
            probsHandicap[`1 ${key}`] = res["1"];
            probsHandicap[`X ${key}`] = res["X"];
            probsHandicap[`2 ${key}`] = res["2"];
        }

        const probsTotalHome = calcTeamTotalsOU(margFT.home, 4.5);
        const probsTotalAway = calcTeamTotalsOU(margFT.away, 4.5);

        const cleanSheets = calcCleanSheet(matrixMatch);
        const winToNil = calcWinToNil(matrixMatch);

        // Corners & Cards lambdas
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

        // Combos
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

        // Fair odds
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

        // Keep probs for summary only (not full dump)
        const predictions = {
            lambdas: {
                goals_home: round2(lambdaGoalsHome),
                goals_away: round2(lambdaGoalsAway),
                goals_home_HT: round2(lambdaGoalsHomeHT),
                goals_away_HT: round2(lambdaGoalsAwayHT),
                corners_total: round2(lambdaCornersTotal),
                cards_total: round2(lambdaCardsTotal),
            },
            probs: {
                "1X2": probs1X2
            },
            fair_odds: fairOdds,
        };

        // ==================== // VALUE DETECTION (PRO) // ====================
        const valueBets = [];

        if (data.bookmaker_odds) {
            const bookie = data.bookmaker_odds;

            const pushValue = (market, outcome, fairOdd, bookieOdd, devig) => {
                const b = safeNum(bookieOdd, 0);
                const f = safeNum(fairOdd, 0);
                if (b <= 1e-12 || f <= 1e-12) return;

                const fairProb = 1 / f;
                const edge = (b / f) - 1;

                const devigProb = devig?.devigProb;
                const ok = sanityValueGate({
                    market,
                    fairOdd: f,
                    bookieOdd: b,
                    devigProb,
                    fairProb
                });
                if (!ok) return;

                // thresholds: Edge must be > 10% AND <= 50%
                if (edge > 0.10 && edge <= 0.50) {
                    valueBets.push({
                        market,
                        outcome,
                        fair_odd: f,
                        bookie_odd: b,
                        edge,
                        edge_percent: (edge * 100).toFixed(1) + "%",
                        devig_prob_percent: Number.isFinite(devigProb) ? (devigProb * 100).toFixed(1) + "%" : null,
                        fair_prob_percent: (fairProb * 100).toFixed(1) + "%",
                        overround: devig?.overround ? round2(devig.overround) : null,
                    });
                }
            };

            // 1X2, DNB, BTTS etc (simple)
            const checkSimpleMarket = (marketKey, outcomes) => {
                const bM = bookie[marketKey];
                const fM = fairOdds[marketKey];
                if (!bM || !fM) return;

                outcomes.forEach(out => {
                    const fOdd = fM[out];
                    const bOdd = bM[out];
                    if (!fOdd || !bOdd) return;
                    const devig = devigProportional(bM, out);
                    pushValue(marketKey, out, fOdd, bOdd, devig);
                });
            };

            checkSimpleMarket("1X2", ["1", "X", "2"]);
            checkSimpleMarket("1X2_1H", ["1", "X", "2"]);
            checkSimpleMarket("1X2_2H", ["1", "X", "2"]);
            checkSimpleMarket("DNB", ["1", "2"]);
            checkSimpleMarket("DNB_1H", ["1", "2"]);
            checkSimpleMarket("DNB_2H", ["1", "2"]);
            checkSimpleMarket("BTTS", ["Yes", "No"]);
            checkSimpleMarket("BTTS_1H", ["Yes", "No"]);
            checkSimpleMarket("BTTS_2H", ["Yes", "No"]);
            checkSimpleMarket("clean_sheet_home", ["Yes", "No"]);
            checkSimpleMarket("clean_sheet_away", ["Yes", "No"]);
            checkSimpleMarket("WinToNil", ["Home", "Away", "No"]);
            // checkSimpleMarket("DoubleChance", ["Home/Draw", "Home/Away", "Draw/Away"]); // handled specially below

            // DoubleChance mapping (No Devigging)
            if (bookie["DoubleChance"] && fairOdds["DoubleChance"]) {
                const bM = bookie["DoubleChance"];
                const fM = fairOdds["DoubleChance"];
                const map = {
                    "Home/Draw": fM["1X"],
                    "Home/Away": fM["12"],
                    "Draw/Away": fM["X2"],
                };
                for (const k in map) {
                    if (map[k] && bM[k]) {
                        // Pass null for devig to skip devig sanity checks and rely on raw comparison
                        pushValue("DoubleChance", k, map[k], bM[k], null);
                    }
                }
            }

            // OU style markets: evaluate per "Over X" / "Under X"
            const checkOU = (marketKey) => {
                const bM = bookie[marketKey];
                const fM = fairOdds[marketKey];
                if (!bM || !fM) return;

                // try to pair over/under for same line
                const lines = new Set();
                for (const k in bM) {
                    const m = String(k).match(/^(Over|Under)\s+(.+)$/i);
                    if (m) lines.add(m[2]);
                }
                lines.forEach(line => {
                    const overKey = `Over ${line}`;
                    const underKey = `Under ${line}`;
                    if (!bM[overKey] || !bM[underKey]) return;
                    const mini = {
                        [overKey]: bM[overKey],
                        [underKey]: bM[underKey]
                    };

                    if (fM[overKey]) pushValue(marketKey, overKey, fM[overKey], bM[overKey], devigProportional(mini, overKey));
                    if (fM[underKey]) pushValue(marketKey, underKey, fM[underKey], bM[underKey], devigProportional(mini, underKey));
                });
            };

            ["OverUnder", "OverUnder_1H", "OverUnder_2H", "Corners_OU", "Cards_OU", "Total_Home", "Total_Away"].forEach(checkOU);

            // Handicap: Segmentation by line + Key Mapping
            if (bookie["Handicap"] && fairOdds["Handicap"] && isEuropeanHandicap3Way(bookie["Handicap"])) {
                const bM = bookie["Handicap"];
                const fM = fairOdds["Handicap"];

                // 1. Group by line value (e.g. "1")
                // Bookie keys might look like "1 (-1)", "X (-1)", "2 (+1)" or "2 (-1)" depending on format

                const groups = {}; // Key: "-1" -> { "1 (-1)": odd, "X (-1)": odd, "2 (+1)": odd }

                for (const k in bM) {
                    // Regex to capture the number in parens: "1 (-1)", "2 (+1)", "Home -1"
                    const m = k.match(/([+-]?\d+(\.\d+)?)\)$/);
                    if (m) {
                        const hcpVal = parseFloat(m[1]); // e.g. -1, +1
                        // We want to group "Home -1" (val -1), "Tie -1" (val -1), "Away +1" (val +1).
                        // Note: Away +1 implies Home -1 line.
                        // So if we see +1 on Away, the "line" is -1.
                        // If we see -1 on Away, the "line" is +1.
                        // Let's define the "Line" as the Home Handicap.

                        let line = null;
                        if (k.includes("1 (") || k.includes("Home") || k.includes("X (") || k.includes("Draw") || k.includes("Tie")) {
                             line = hcpVal;
                        } else if (k.includes("2 (") || k.includes("Away")) {
                             line = -hcpVal;
                        }

                        if (line !== null) {
                            if (!groups[line]) groups[line] = {};
                            groups[line][k] = bM[k];
                        }
                    }
                }

                // 2. Process each group
                for (const lineStr in groups) {
                    const subMarket = groups[lineStr];
                    const line = parseFloat(lineStr);

                    // Construct our internal keys for this line
                    // We generated keys like "1 (-1)", "X (-1)", "2 (-1)".
                    // Where "2 (-1)" meant the 3rd outcome of the (-1) simulation.
                    const sign = line > 0 ? "+" : "";
                    const internalSuffix = `(${sign}${line})`;
                    const intKey1 = `1 ${internalSuffix}`;
                    const intKeyX = `X ${internalSuffix}`;
                    const intKey2 = `2 ${internalSuffix}`;

                    // Now map Bookie keys in subMarket to these internal keys
                    // Bookie "1 (-1)" matches intKey1
                    // Bookie "X (-1)" matches intKeyX
                    // Bookie "2 (+1)" matches intKey2

                    for (const bk in subMarket) {
                        let matchedFairOdd = null;

                        // normalize bk to see what it is
                        if (bk.includes("1 (") || bk.includes("Home")) {
                             matchedFairOdd = fM[intKey1];
                        } else if (bk.includes("X (") || bk.includes("Draw") || bk.includes("Tie")) {
                             matchedFairOdd = fM[intKeyX];
                        } else if (bk.includes("2 (") || bk.includes("Away")) {
                             matchedFairOdd = fM[intKey2];
                        }

                        if (matchedFairOdd) {
                            // Devig using the subMarket
                            const devig = devigProportional(subMarket, bk);
                            pushValue("Handicap", bk, matchedFairOdd, subMarket[bk], devig);
                        }
                    }
                }
            }

            // Complex markets (HT/FT + combos): devig on whatever outcomes exist, but sanity-gated
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

        // ==================== // CLEAN OUTPUT ONLY // ====================
        const cleanOutput = buildCleanOutput(data, predictions, valueBets);
        results.push({ json: cleanOutput });
    }

    return results;
}

module.exports = { processItems };
