# Probability Engine & EV Scanner - Technical Reference

## 1. Overview
The `probability_engine.js` module is a standalone Node.js function designed to run within n8n. It consumes a normalized match record (from `normalize_match_record.js`), calculates expected goals and corners, models match outcomes using independent Poisson distributions, and identifies value bets by comparing model probabilities against bookmaker odds.

## 2. Inputs & Data Contract
The engine expects a single JSON object (the "Normalized Match Record") and an optional `config` object.

### Required Fields
| Field Path | Type | Purpose |
|:--- |:--- |:--- |
| `match_id` | Number | Unique identifier for logging/output. |
| `teams.home.name` | String | Output readability. |
| `teams.away.name` | String | Output readability. |
| `odds.best` | Object | Dictionary of best available odds (e.g. `ft_1x2_home`). |

### Config Options (Optional)
| Option | Default | Purpose |
|:--- |:--- |:--- |
| `min_ev` | 0.0 | Minimum Expected Value to include a pick (e.g. 0.02 for 2%). |
| `min_edge` | 0.0 | Minimum Edge (Prob Diff) to include a pick. |
| `split_1h` | 0.45 | Proportion of goals occurring in 1st Half. |
| `split_2h` | 0.55 | Proportion of goals occurring in 2nd Half. |

### Signal Fields (Priority Order)
The engine looks for these fields to derive "Lambdas" (Expected Counts). If primary signals are missing, it falls back to context or heuristics.

**Goal Expectations (Home/Away):**
1. `signals.xg` (Home/Away) - *Primary Source*
2. `context.team_a_xg_prematch` / `context.team_b_xg_prematch` - *Secondary*
3. `signals.ppg` (Home/Away) - *Heuristic Source*
4. `context.home_ppg` / `context.away_ppg` - *Heuristic Fallback*

**Corner Expectations:**
1. `team_stats.home.season_stats.features.corners_for_pm_overall`
2. `team_stats.home.season_stats.features.corners_against_pm_overall`
3. (Same for Away team)

## 3. Lambda Estimation Logic

### Goals (Expected Goals - xG)
The engine determines $\lambda_{home}$ and $\lambda_{away}$ using the priority list above.

*   **xG Source**: Used directly if > 0.1.
*   **PPG Heuristic**: If xG is missing but PPG exists:
    $$ \lambda = \max(0.5, PPG \times 0.8) $$
    *Reasoning: PPG is a result metric, not a performance metric. 0.8 is a conservative conversion factor to prevent overestimating offensive strength from lucky wins.*
*   **League Average Fallback**: If no data exists:
    *   Home: 1.35
    *   Away: 1.10

**Clamping**: Final goal lambdas are clamped to $[0.1, 4.5]$.

### Corners
Corner expectations are derived using a simple "Attack vs Defense" average.

$$ \lambda_{corners\_home} = \frac{\text{Home Corners For} + \text{Away Corners Against}}{2} $$
$$ \lambda_{corners\_away} = \frac{\text{Away Corners For} + \text{Home Corners Against}}{2} $$

**Clamping**: Corner lambdas are clamped to $[1.0, 12.0]$.

## 4. Probability Model (Poisson)

The engine assumes **independent Poisson distributions** for Home and Away scores/counts.

### Matrix Construction
A probability matrix $M[h][a]$ is built where $M[h][a] = P(Home=h) \times P(Away=a)$.

**Dynamic Sizing (V9+):**
To accurately capture "Long Tail" outcomes (especially for Corners), the matrix dimensions are calculated independently:
$$ Max_H = \lceil \lambda_{home} + 5 \times \sqrt{\lambda_{home}} \rceil $$
$$ Max_A = \lceil \lambda_{away} + 5 \times \sqrt{\lambda_{away}} \rceil $$
$$ Max = \max(9, Max_H, Max_A) $$
*This ensures coverage of >99.99% of probable outcomes even for asymmetric matchups.*

**Renormalization:**
If the cumulative probability of the matrix < 1.0 (due to truncation), all cells are divided by the total sum to ensure $\sum P = 1.0$.

### Time Splits
*   **Full Time (FT)**: Uses full lambdas.
*   **1st Half (HT)**: $\lambda_{HT} = \lambda_{FT} \times 0.45$ (Configurable)
*   **2nd Half (2H)**: $\lambda_{2H} = \lambda_{FT} \times 0.55$ (Configurable)

## 5. Market Derivations

Probabilities for specific markets are derived by summing relevant cells in the score matrix.

### 1X2 (Match Result)
*   **Home Win**: Sum of all cells where $h > a$.
*   **Draw**: Sum of all cells where $h = a$.
*   **Away Win**: Sum of all cells where $h < a$.

### Over/Under (Lines $L$)
*   **Over**: Sum where $(h + a) > L$.
*   **Under**: Sum where $(h + a) \le L$. (Note: For half-lines like 2.5, `<=` is functionally identical to `<`).

### Both Teams to Score (BTTS)
*   **Yes**: Sum where $h > 0 \text{ AND } a > 0$.
*   **No**: Sum where $h = 0 \text{ OR } a = 0$.

### Clean Sheet
*   **Home CS**: Sum where $a = 0$ (Away scores 0).
*   **Away CS**: Sum where $h = 0$ (Home scores 0).

### Win to Nil
*   **Home**: Sum where $h > a \text{ AND } a = 0$.
*   **Away**: Sum where $a > h \text{ AND } h = 0$.

### Double Chance
*   **1X**: $P(Home) + P(Draw)$
*   **12**: $P(Home) + P(Away)$
*   **X2**: $P(Draw) + P(Away)$

## 6. Odds Resolution & Devigging

### Odds Resolution
The scanner looks up odds in `odds.best` using:
1.  **Strict Key**: e.g., `corners_ou_over_9.5`.
2.  **Legacy Alias**: Removes `_ou_`, e.g., `corners_over_9.5`.

### Devigging (Fair Probability Calculation)
The engine attempts to calculate "Fair Odds" (removing bookmaker margin) if **all outcomes** for a market are present in the odds (Vector Completeness).

1.  **Vector Construction**: Collects odds for all selections (e.g., Over + Under).
2.  **Completeness Check**: If any leg is missing, devigging is skipped.
3.  **Whitelist Check (V10)**: Devigging is ONLY applied to explicitly exclusive markets:
    *   1X2, Over/Under (Goals/Corners), BTTS, Clean Sheet, Win to Nil.
    *   **Double Chance is EXCLUDED** (outcomes overlap, devig invalid).
4.  **Calculation (Proportional)**:
    $$ P_{implied} = \frac{1}{Odds} $$
    $$ Margin = \sum P_{implied} $$
    $$ P_{fair} = \frac{P_{implied}}{Margin} $$

## 7. EV, Edge & Ranking

For every valid market comparison:

### Formulas
*   **Edge**: $P_{model} - P_{market}$ (where $P_{market}$ is Fair Prob if devigged, else Implied Prob).
*   **EV (Expected Value)**: $(P_{model} \times Odds) - 1$
*   **Kelly Stake**: $\frac{(b \times p - q)}{b} \times 0.25$ (Quarter Kelly).

### Scoring & Tiers
Picks are ranked by a weighted score:
$$ Score = (EV \times 100 \times 0.7) + (Edge \times 100 \times 0.3) $$

*   **Confidence Bonus**: +5 for "High", +2 for "Medium".
*   **Longshot Penalty**: -5 if $P_{model} < 30\%$.

**Tiers:**
*   **S**: EV > 10% (High Conf)
*   **A**: EV > 5% (High/Med Conf)
*   **B**: EV > 2%
*   **C**: Marginal Value

### Portfolio Diversity (Shortlist)
The `top_picks` list is generated by:
1.  Grouping all value bets by Category (`goals`, `corners`, `result`, etc.).
2.  Picking the **best** bet from each category.
3.  Filling remaining slots with the next highest-rated bets.
*This prevents the shortlist from being 5 versions of "Over 2.5/3.5/4.5".*

## 8. Output Schema

```json
{
  "match_id": 12345,
  "overview": {
    "teams": { "home": {...}, "away": {...} },
    "lambdas": { ... },
    "probs": { ... },
    "engine_warnings": ["context_team_mapping_swapped"] // V10
  },
  "top_picks": [
    {
      "market": "1X2",
      "selection": "home",
      "category": "result",
      "odds": 2.20,
      "p_model": 0.50,
      "ev": 0.10,
      "kelly": 0.02,
      "tier": "A",
      "devig_applied": true, // V10
      "p_market_source": "fair_devig", // V10
      "why": ["Model 50% > Market 45%", "EV +10%"]
    }
  ],
  "all_value_bets": [...]
}
```
