/** Bioterror risk model: monthly attempts, SIR outbreak size, and defense coverage. */

const SITE = self.SITE_CLIENT || {};
const ATTEMPT_PROB_FORMULA = SITE.attempt_prob_pct || "0.5";
const SUCCESS_PROB_FORMULA = SITE.success_prob_pct || "5";
const DEFENSE_COVERAGE_FORMULA = SITE.annual_defense_increase_pct || "(([percent_spend]/100)*[gdp]/[ppe_price])/[population]*100";
const AI_CAPABILITIES_FORMULA = SITE.ai_capabilities || "1";
const AI_LAG_AMOUNT = SITE.ai_lag_amount ?? 1;
const GDP_GROWTH_FORMULA = SITE.gdp_growth || "2.5+87.5*(([ai]/720)^1.5)";
const GDP_FORMULA = "[gdp_prev]*exp([gdp_growth]/100/12)";
const PERCENT_SPEND_FORMULA = SITE.percent_spend || "0.01";
const PPE_PRICE_FORMULA = SITE.ppe_price || "100";
const POPULATION = SITE.population || 8_000_000_000;
const PERCENT_FORMULA_FIELDS = new Set(["defense", "attempt", "success"]);
const DEFAULT_PATHOGEN_WEIGHT = "1";
const MONTHLY_SERIES = [
  "attempt_chance",
  "success_chance",
  "defense_coverage",
  "ai_capabilities",
  "ai_lag",
  "gdp_growth",
  "gdp",
  "percent_spend",
  "ppe_price",
];

const PATHOGEN_SCENARIOS = (SITE.pathogen_scenarios && SITE.pathogen_scenarios.length
  ? SITE.pathogen_scenarios
  : [
      { r0: 1.5, lethality_pct: 10, weight: "1" },
      { r0: 2.5, lethality_pct: 0.5, weight: "1" },
    ]
).map((item) => ({
  r0: item.r0,
  lethality: item.lethality != null ? item.lethality : item.lethality_pct / 100,
  weight: item.weight || DEFAULT_PATHOGEN_WEIGHT,
}));

function clipUnit(value) {
  return Math.min(Math.max(value, 0), 1);
}

function makeFormulaSystem(
  population,
  {
    annualDefenseIncrease,
    attemptProbPerYear,
    successProb,
    aiCapabilities = null,
    gdpGrowth = null,
    percentSpend = null,
    ppePrice = null,
  },
) {
  const values = [annualDefenseIncrease, attemptProbPerYear, successProb, aiCapabilities, gdpGrowth, percentSpend, ppePrice];
  if (!values.some((value) => typeof value === "string")) return null;
  return new FormulaSystem(
    {
      ai: aiCapabilities == null ? AI_CAPABILITIES_FORMULA : aiCapabilities,
      gdp_growth: gdpGrowth == null ? GDP_GROWTH_FORMULA : gdpGrowth,
      gdp: GDP_FORMULA,
      percent_spend: percentSpend == null ? PERCENT_SPEND_FORMULA : percentSpend,
      ppe_price: ppePrice == null ? PPE_PRICE_FORMULA : ppePrice,
      defense: annualDefenseIncrease,
      attempt: attemptProbPerYear,
      success: successProb,
    },
    { population, percentFields: PERCENT_FORMULA_FIELDS },
  );
}

function formulaModelSeries(system, nYears, { aiLagAmount = 0 } = {}) {
  const raw = system.series(nYears, { aiLagAmount });
  const modeled = {};
  for (const [name, values] of Object.entries(raw)) {
    if (PERCENT_FORMULA_FIELDS.has(name)) {
      modeled[name] = values.map((value) => clipUnit(value * 0.01));
    } else {
      modeled[name] = values.slice();
    }
  }
  return modeled;
}

function mixSharesFromWeights(weights) {
  const clipped = weights.map((weight) => Math.max(Number(weight), 0));
  const total = clipped.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new FormulaError("pathogen weights must sum to a positive number");
  return clipped.map((value) => value / total);
}

function compactMonthlySeries(results, nYears) {
  const nRuns = results.length;
  const hasSuccess = results.map((result) => result.nSuccesses > 0);
  const compactIds = [];
  for (let i = 0; i < nRuns; i += 1) {
    if (hasSuccess[i]) compactIds.push(i);
  }
  const runIndex = Array(nRuns).fill(-1);
  compactIds.forEach((runId, row) => {
    runIndex[runId] = row;
  });
  const firstMix = results[0]?.pathogenMix;
  const nPath = firstMix && firstMix[0] ? firstMix[0].length : 0;
  const byRun = {};
  for (const name of MONTHLY_SERIES) {
    byRun[name] = compactIds.map(() => Array(nYears).fill(0));
  }
  const mixByRun = compactIds.map(() => Array.from({ length: nYears }, () => Array(nPath).fill(0)));
  compactIds.forEach((runId, row) => {
    const result = results[runId];
    for (const name of MONTHLY_SERIES) {
      const series = result.monthly[name];
      if (series) byRun[name][row] = series.slice();
    }
    if (result.pathogenMix && nPath) mixByRun[row] = result.pathogenMix.map((rowShares) => rowShares.slice());
  });
  return { runIndex, byRun, mixByRun };
}

function monthlyRowForRun(baseline, runId, { byRun = null, runIndex = null } = {}) {
  if (runIndex && byRun) {
    const row = runIndex[runId];
    if (row >= 0) return byRun[row];
    return baseline;
  }
  if (Array.isArray(baseline?.[0])) return baseline[runId];
  return baseline;
}

function pathogenScenarioLabel(scenario) {
  return `R0 ${formatG(scenario.r0)}, lethality ${formatG(scenario.lethality * 100)}%`;
}

function formatG(value) {
  if (!Number.isFinite(value)) return String(value);
  return Number.parseFloat(Number(value).toPrecision(6)).toString();
}

function normalizePathogenScenarios(scenarios) {
  const items = scenarios && scenarios.length ? scenarios : PATHOGEN_SCENARIOS;
  if (!items.length) throw new Error("pathogen_scenarios must not be empty");
  return items.map((item) => {
    if (item.r0 == null || item.lethality == null) {
      throw new Error("each pathogen scenario needs R0 and lethality");
    }
    return {
      r0: Number(item.r0),
      lethality: Number(item.lethality),
      weight: item.weight ?? DEFAULT_PATHOGEN_WEIGHT,
    };
  });
}

function compileWeightFn(value, name) {
  if (typeof value === "string") {
    const compiled = compileFormula(value, name);
    return (env) => {
      const missing = [...compiled.referenced].filter((key) => !(key in env));
      if (missing.length) {
        throw new FormulaError(`${name} depends on ${JSON.stringify(missing.slice().sort())}`);
      }
      const weight = compiled.evaluate(env);
      if (weight < 0) throw new FormulaError(`${name} evaluated to a negative weight`);
      return weight;
    };
  }
  const number = Number(value);
  if (number < 0) throw new Error(`${name} must be non-negative`);
  return () => number;
}

function pathogenEnv(year, population, formulaSystem = null) {
  if (formulaSystem) return formulaSystem.evaluateYear(year);
  return {
    time: Number(year) + 1,
    population: Number(population),
    prior_attack: 0,
    ai_lag: 0,
  };
}

function pathogenMixShares(scenarios, nYears, { population = POPULATION, formulaSystem = null, aiLagAmount = 0 } = {}) {
  const normalized = normalizePathogenScenarios(scenarios);
  const weightFns = normalized.map((scenario, i) => compileWeightFn(scenario.weight, `weight (scenario ${i + 1})`));
  const lagged = formulaSystem ? formulaSystem.series(nYears, { aiLagAmount }).ai_lag : null;
  const shares = [];
  for (let year = 0; year < nYears; year += 1) {
    const env = formulaSystem
      ? formulaSystem.evaluateYear(year, { ai_lag: lagged[year] })
      : pathogenEnv(year, population);
    const weights = weightFns.map((fn) => Number(fn(env)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (total <= 0) throw new FormulaError("pathogen weights must sum to a positive number");
    shares.push(weights.map((value) => value / total));
  }
  return { shares, labels: normalized.map(pathogenScenarioLabel) };
}

function samplePathogen(rng, scenarios, weights) {
  const clipped = weights.map((weight) => Math.max(Number(weight), 0));
  const total = clipped.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error("pathogen weights must sum to a positive number");
  const index = rng.choice(clipped.map((value) => value / total));
  const scenario = scenarios[index];
  return { r0: Number(scenario.r0), lethality: Number(scenario.lethality) };
}

function sirFinalAttackRate(r0, susceptibleFraction) {
  const s0 = Number(susceptibleFraction);
  if (s0 <= 0 || r0 <= 0 || r0 * s0 <= 1) return 0;
  let z = Math.min(Math.max(1 - 1 / r0, 1e-8), s0);
  for (let i = 0; i < 100; i += 1) {
    const next = s0 * (1 - Math.exp(-r0 * z));
    if (Math.abs(next - z) < 1e-14) {
      z = next;
      break;
    }
    z = next;
  }
  return Math.min(Math.max(z, 0), s0);
}

function sirDeaths(r0, lethality, coverage, population = POPULATION) {
  const living = Math.max(Number(population), 0);
  if (living <= 0) return 0;
  const infections = sirFinalAttackRate(r0, 1 - coverage) * living;
  return Math.min(infections * lethality, living);
}

/** Mulberry32: fast seeded [0, 1) generator. Seeds will not match NumPy. */
function createRng(seed) {
  let state = Number(seed) >>> 0;
  const random = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random,
    integers(low, high, n) {
      const span = high - low;
      const out = Array(n);
      for (let i = 0; i < n; i += 1) {
        out[i] = low + Math.floor(random() * span);
      }
      return out;
    },
    choice(probs) {
      let u = random();
      for (let i = 0; i < probs.length; i += 1) {
        u -= probs[i];
        if (u <= 0) return i;
      }
      return probs.length - 1;
    },
  };
}

function runOne({
  nYears,
  population,
  formulaSystem,
  pathogenScenarios,
  weightFns,
  aiLagAmount,
  seed,
}) {
  const rng = createRng(seed);
  const yearlyDeaths = Array(nYears).fill(0);
  const monthly = {};
  for (const name of MONTHLY_SERIES) monthly[name] = Array(nYears).fill(0);
  const mix = Array.from({ length: nYears }, () => Array(pathogenScenarios.length).fill(0));
  const events = [];
  let priorAttack = 0;
  let living = population;
  let gdpPrev = GDP_MONTHLY_BASE;

  const monthState = (year, prior, aiLag) => {
    const extra = { prior_attack: prior, ai_lag: aiLag, gdp_prev: gdpPrev };
    const env = formulaSystem.evaluateYear(year, extra);
    return {
      coverage: clipUnit(formulaSystem.modelValue("defense", year, env)),
      attemptProb: clipUnit(formulaSystem.modelValue("attempt", year, env)),
      successProb: clipUnit(formulaSystem.modelValue("success", year, env)),
      env,
    };
  };

  for (let year = 0; year < nYears; year += 1) {
    let coverage;
    let attemptProb;
    let successProb;
    let env;
    let aiLag;
    if (year === 0) {
      ({ coverage, attemptProb, successProb, env } = monthState(year, priorAttack, 0));
      aiLag = Number(env.ai || 0);
      ({ coverage, attemptProb, successProb, env } = monthState(year, priorAttack, aiLag));
    } else {
      aiLag = Number(monthly.ai_capabilities[Math.max(0, year - aiLagAmount)]);
      ({ coverage, attemptProb, successProb, env } = monthState(year, priorAttack, aiLag));
    }
    monthly.attempt_chance[year] = attemptProb;
    monthly.success_chance[year] = successProb;
    monthly.defense_coverage[year] = coverage;
    monthly.ai_capabilities[year] = Number(env.ai || 0);
    monthly.ai_lag[year] = Number(env.ai_lag ?? aiLag);
    monthly.gdp_growth[year] = Number(env.gdp_growth || 0);
    monthly.gdp[year] = Number(env.gdp || 0);
    gdpPrev = monthly.gdp[year] || gdpPrev;
    monthly.percent_spend[year] = Number(env.percent_spend || 0);
    monthly.ppe_price[year] = Number(env.ppe_price || 0);
    const weights = weightFns.map((fn) => Number(fn(env)));
    mix[year] = mixSharesFromWeights(weights);
    if (rng.random() >= attemptProb) continue;

    const succeeded = rng.random() < successProb;
    if (!succeeded) {
      events.push({ year, r0: NaN, lethality: NaN, coverage, deaths: 0, succeeded: false });
      continue;
    }

    const { r0, lethality } = samplePathogen(rng, pathogenScenarios, weights);
    const deaths = sirDeaths(r0, lethality, coverage, living);
    living -= deaths;
    yearlyDeaths[year] = deaths;
    events.push({ year, r0, lethality, coverage, deaths, succeeded: true });
    priorAttack = 1;
  }

  return {
    yearlyDeaths,
    events,
    seed,
    monthly,
    pathogenMix: mix,
    nAttempts: events.length,
    nSuccesses: events.filter((event) => event.succeeded).length,
  };
}

function runEnsemble(payload, onProgress = null) {
  const nRuns = payload.nRuns;
  const nYears = payload.nYears;
  const population = payload.population;
  const scenarios = normalizePathogenScenarios(payload.pathogenScenarios);
  const system = makeFormulaSystem(population, {
    annualDefenseIncrease: payload.annualDefenseIncrease,
    attemptProbPerYear: payload.attemptProbPerYear,
    successProb: payload.successProb,
    aiCapabilities: payload.aiCapabilities,
    gdpGrowth: payload.gdpGrowth,
    percentSpend: payload.percentSpend,
    ppePrice: payload.ppePrice,
  });
  const weightFns = scenarios.map((scenario, i) => compileWeightFn(scenario.weight, `weight (scenario ${i + 1})`));
  const parent = createRng(payload.seed);
  const childSeeds = parent.integers(0, 2 ** 31 - 1, nRuns);
  const results = [];
  for (let i = 0; i < nRuns; i += 1) {
    results.push(
      runOne({
        nYears,
        population,
        formulaSystem: system,
        pathogenScenarios: scenarios,
        weightFns,
        aiLagAmount: payload.aiLagAmount,
        seed: childSeeds[i],
      }),
    );
    if (onProgress && ((i + 1) % 25 === 0 || i + 1 === nRuns)) onProgress(i + 1, nRuns);
  }
  return { results, system, scenarios };
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function chooseExampleRun(cumulativeDeaths) {
  const index = cumulativeDeaths.findIndex((value) => value > 0);
  return index >= 0 ? index : 0;
}

function exportEnsemble(payload, onProgress = null) {
  const { results, system, scenarios } = runEnsemble(payload, onProgress);
  const nRuns = results.length;
  const nYears = payload.nYears;
  const yearlyDeaths = results.map((result) => result.yearlyDeaths);
  const cumulativeDeaths = yearlyDeaths.map((row) => row.reduce((sum, value) => sum + value, 0));
  const yearLabels = Array.from({ length: nYears }, (_, i) => i + 1);
  const averageDeaths = Array.from({ length: nYears }, (_, year) => mean(yearlyDeaths.map((row) => row[year])));

  let mixShares;
  let mixLabels;
  ({ shares: mixShares, labels: mixLabels } = pathogenMixShares(scenarios, nYears, {
    population: payload.population,
    formulaSystem: system,
    aiLagAmount: payload.aiLagAmount,
  }));

  let modeled = formulaModelSeries(system, nYears, { aiLagAmount: payload.aiLagAmount });
  const raw = system.series(nYears, { aiLagAmount: payload.aiLagAmount });
  let attemptChance = modeled.attempt;
  let successChance = modeled.success;
  let coverage = modeled.defense;
  let aiSeries = raw.ai;
  let gdpGrowthSeries = raw.gdp_growth;
  let gdpSeries = raw.gdp;
  let spendSeries = raw.percent_spend;
  let ppeSeries = raw.ppe_price;
  let aiLagSeries = raw.ai_lag;

  const zero = results.find((result) => result.nSuccesses === 0 && result.monthly);
  if (zero) {
    attemptChance = zero.monthly.attempt_chance;
    successChance = zero.monthly.success_chance;
    coverage = zero.monthly.defense_coverage;
    aiSeries = zero.monthly.ai_capabilities;
    aiLagSeries = zero.monthly.ai_lag;
    gdpGrowthSeries = zero.monthly.gdp_growth;
    gdpSeries = zero.monthly.gdp;
    spendSeries = zero.monthly.percent_spend;
    ppeSeries = zero.monthly.ppe_price;
    if (zero.pathogenMix) mixShares = zero.pathogenMix;
  }

  const nAttacks = results.map((result) => result.nAttempts);
  const attackR0 = Array.from({ length: nRuns }, () => Array(nYears).fill(NaN));
  const attackLethality = Array.from({ length: nRuns }, () => Array(nYears).fill(NaN));
  const attackFlag = Array.from({ length: nRuns }, () => Array(nYears).fill(0));
  results.forEach((result, runId) => {
    for (const event of result.events) {
      attackFlag[runId][event.year] = event.succeeded ? 1 : 2;
      if (event.succeeded) {
        attackR0[runId][event.year] = event.r0;
        attackLethality[runId][event.year] = event.lethality;
      }
    }
  });

  const { runIndex, byRun } = compactMonthlySeries(results, nYears);
  const exampleRun = chooseExampleRun(cumulativeDeaths);

  return {
    nRuns,
    nYears,
    exampleRun,
    meanCumulativeDeaths: mean(cumulativeDeaths),
    medianCumulativeDeaths: median(cumulativeDeaths),
    maxCumulativeDeaths: cumulativeDeaths.length ? Math.max(...cumulativeDeaths) : 0,
    zeroRuns: cumulativeDeaths.filter((value) => value === 0).length,
    yearlyDeaths,
    cumulativeDeaths,
    averageDeaths,
    yearLabels,
    nAttacks,
    attackR0,
    attackLethality,
    attackFlag,
    seriesRunIndex: runIndex,
    attempt_chance: attemptChance,
    success_chance: successChance,
    defense_coverage: coverage,
    ai_capabilities: aiSeries,
    ai_lag: aiLagSeries,
    ai_lag_amount: Array(nYears).fill(Number(payload.aiLagAmount)),
    gdp_growth: gdpGrowthSeries,
    gdp: gdpSeries,
    percent_spend: spendSeries,
    ppe_price: ppeSeries,
    attempt_chance_by_run: byRun.attempt_chance,
    success_chance_by_run: byRun.success_chance,
    defense_coverage_by_run: byRun.defense_coverage,
    ai_capabilities_by_run: byRun.ai_capabilities,
    ai_lag_by_run: byRun.ai_lag,
    gdp_growth_by_run: byRun.gdp_growth,
    gdp_by_run: byRun.gdp,
    percent_spend_by_run: byRun.percent_spend,
    ppe_price_by_run: byRun.ppe_price,
    population: payload.population,
    pathogenMix: mixShares,
    pathogenLabels: mixLabels,
  };
}

function trendSeriesForRun(data, name, runId) {
  return monthlyRowForRun(data[name], runId, {
    byRun: data[`${name}_by_run`],
    runIndex: data.seriesRunIndex,
  });
}

function validatePayload(data) {
  const scenariosRaw = data.pathogen_scenarios || [];
  if (!Array.isArray(scenariosRaw) || !scenariosRaw.length) {
    throw new Error("Add at least one pathogen scenario");
  }
  const scenarios = scenariosRaw.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`Pathogen scenario ${i + 1} is invalid`);
    const r0 = asFloat(item.r0, `R0 (scenario ${i + 1})`, { minimum: 0 });
    const lethality = asFloat(item.lethality, `lethality (scenario ${i + 1})`, { minimum: 0, maximum: 1 });
    const weight = asWeightFormula(item.weight ?? DEFAULT_PATHOGEN_WEIGHT, `weight (scenario ${i + 1})`);
    return { r0, lethality, weight };
  });

  const payload = {
    nRuns: asInt(data.n_runs, "simulations", { minimum: 1, maximum: data.max_runs ?? 20_000 }),
    nYears: asInt(data.n_years, "months", { minimum: 1, maximum: data.max_years ?? 500 }),
    population: asFloat(data.population, "population", { minimum: 1 }),
    seed: asInt(data.seed, "seed", { minimum: 0 }),
    annualDefenseIncrease: asFormula(data.annual_defense_increase, "defense coverage"),
    attemptProbPerYear: asFormula(data.attempt_prob_per_year, "attempt chance"),
    successProb: asFormula(data.success_prob, "success chance"),
    aiCapabilities: asFormula(data.ai_capabilities ?? AI_CAPABILITIES_FORMULA, "AI capabilities"),
    aiLagAmount: asInt(data.ai_lag_amount ?? AI_LAG_AMOUNT, "AI lag amount", {
      minimum: 0,
      maximum: data.max_years ?? 500,
    }),
    gdpGrowth: asFormula(data.gdp_growth ?? GDP_GROWTH_FORMULA, "GDP growth"),
    percentSpend: asFormula(data.percent_spend ?? PERCENT_SPEND_FORMULA, "percent spend"),
    ppePrice: asFormula(data.ppe_price ?? PPE_PRICE_FORMULA, "PPE price"),
    pathogenScenarios: scenarios,
  };

  try {
    const system = makeFormulaSystem(payload.population, {
      annualDefenseIncrease: payload.annualDefenseIncrease,
      attemptProbPerYear: payload.attemptProbPerYear,
      successProb: payload.successProb,
      aiCapabilities: payload.aiCapabilities,
      gdpGrowth: payload.gdpGrowth,
      percentSpend: payload.percentSpend,
      ppePrice: payload.ppePrice,
    });
    if (system) {
      system.evaluateYear(0, { prior_attack: 0, ai_lag: 1 });
      system.evaluateYear(0, { prior_attack: 1, ai_lag: 1 });
      system.evaluateYear(payload.nYears - 1, { prior_attack: 1, ai_lag: 1 });
    }
    pathogenMixShares(payload.pathogenScenarios, payload.nYears, {
      population: payload.population,
      formulaSystem: system,
      aiLagAmount: payload.aiLagAmount,
    });
  } catch (exc) {
    if (exc instanceof FormulaError) throw new Error(exc.message);
    throw exc;
  }
  return payload;
}

function asFloat(value, name, { minimum = null, maximum = null } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  if (minimum != null && number < minimum) throw new Error(`${name} must be at least ${minimum}`);
  if (maximum != null && number > maximum) throw new Error(`${name} must be at most ${maximum}`);
  return number;
}

function asInt(value, name, bounds) {
  return Math.trunc(asFloat(value, name, bounds));
}

function asFormula(value, name) {
  if (typeof value === "boolean" || value == null) throw new Error(`${name} must be a number or formula`);
  if (typeof value === "number") return asFloat(value, name, { minimum: 0, maximum: 1 });
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a number or formula`);
  const text = value.trim();
  try {
    compileFormula(text, name);
  } catch (exc) {
    throw new Error(exc.message);
  }
  return text;
}

function asWeightFormula(value, name) {
  if (typeof value === "boolean" || value == null) throw new Error(`${name} must be a number or formula`);
  if (typeof value === "number") return asFloat(value, name, { minimum: 0 });
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a number or formula`);
  const text = value.trim();
  try {
    compileFormula(text, name);
  } catch (exc) {
    throw new Error(exc.message);
  }
  return text;
}
