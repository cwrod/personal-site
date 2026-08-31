const INK = "#1c1917";
const MUTED = "#6b6358";
const LINE = "#4C72B0";
const MEAN = "#C44E52";
const PAPER = "#fffdf8";
const MIX_COLORS = ["#4C72B0", "#C44E52", "#55A868", "#8172B3", "#CCB974", "#64B5CD"];

function layout(extra = {}) {
  return {
    paper_bgcolor: PAPER,
    plot_bgcolor: PAPER,
    font: { family: "Palatino, Times New Roman, serif", color: INK, size: 14 },
    margin: { l: 64, r: 28, t: 56, b: 52 },
    hovermode: "closest",
    legend: { orientation: "h", yanchor: "bottom", y: 1.02, x: 0 },
    ...extra,
  };
}

function countAxis() {
  return { separatethousands: true, gridcolor: "#eadfce", zerolinecolor: "#d6cbb8" };
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatCount(value) {
  return Math.round(value).toLocaleString();
}

function cumulativeDistributionFigure(cumulativeDeaths, nYears) {
  const deaths = cumulativeDeaths.map(Number);
  const nBins = !deaths.length || Math.max(...deaths) === 0 ? 1 : Math.min(20, Math.max(8, Math.trunc(Math.sqrt(deaths.length))));
  const meanDeaths = mean(deaths);
  const nZero = deaths.filter((value) => value === 0).length;

  return {
    data: [
      {
        type: "histogram",
        x: deaths,
        nbinsx: nBins,
        marker: { color: LINE, line: { color: "white", width: 0.8 } },
        name: "Simulations",
        hovertemplate: "Cumulative deaths: %{x:,.0f}<br>Simulations: %{y}<extra></extra>",
      },
    ],
    layout: layout({
      title: `Distribution of cumulative deaths (${deaths.length} simulations)`,
      xaxis: { title: `Cumulative deaths over ${nYears} months`, ...countAxis() },
      yaxis: { title: "Number of simulations", gridcolor: "#eadfce", zerolinecolor: "#d6cbb8" },
      bargap: 0.05,
      shapes: [
        {
          type: "line",
          x0: meanDeaths,
          x1: meanDeaths,
          y0: 0,
          y1: 1,
          yref: "paper",
          line: { color: MEAN, width: 2, dash: "dash" },
        },
      ],
      annotations: [
        {
          x: meanDeaths,
          y: 1,
          yref: "paper",
          text: `Mean (${formatCount(meanDeaths)})`,
          showarrow: false,
          font: { color: MEAN },
          yanchor: "bottom",
        },
        {
          text: `${nZero}/${deaths.length} runs with 0 deaths`,
          x: 0.99,
          y: 0.97,
          xref: "paper",
          yref: "paper",
          showarrow: false,
          font: { size: 12, color: MUTED },
          xanchor: "right",
        },
      ],
    }),
  };
}

function averageDeathsPerYearFigure(yearLabels, averageDeaths, nRuns) {
  const xmax = yearLabels.length ? Math.max(...yearLabels) : 1;
  return {
    data: [
      {
        type: "scatter",
        x: yearLabels,
        y: averageDeaths.map(Number),
        mode: "lines",
        line: { color: LINE, width: 2.2 },
        name: "Average",
        hovertemplate: "Month %{x}<br>Average deaths: %{y:,.0f}<extra></extra>",
      },
    ],
    layout: layout({
      title: `Average deaths per month (${nRuns} simulations)`,
      xaxis: { title: "Month", range: [1, xmax], gridcolor: "#eadfce", zerolinecolor: "#d6cbb8" },
      yaxis: { title: "Average deaths", rangemode: "tozero", ...countAxis() },
      showlegend: false,
    }),
  };
}

function attackTable(yearlyDeaths, yearLabels, attackR0, attackLethality, attackFlag) {
  const r0 = [];
  const lethality = [];
  const year = [];
  const deaths = [];
  const runId = [];
  for (let i = 0; i < attackFlag.length; i += 1) {
    for (let j = 0; j < attackFlag[i].length; j += 1) {
      if (attackFlag[i][j] !== 1) continue;
      r0.push(attackR0[i][j]);
      lethality.push(attackLethality[i][j] * 100);
      year.push(Number(yearLabels[j]));
      deaths.push(yearlyDeaths[i][j]);
      runId.push(i);
    }
  }
  return { r0, lethality, year, deaths, runId };
}

function attackScatterFigure(yearlyDeaths, yearLabels, attackR0, attackLethality, attackFlag) {
  const table =
    !attackFlag || !attackR0 || !attackLethality
      ? { r0: [], lethality: [], year: [], deaths: [], runId: [] }
      : attackTable(yearlyDeaths, yearLabels, attackR0, attackLethality, attackFlag);

  const traces = [];
  if (table.year.length) {
    const pairs = [];
    const seen = new Set();
    for (let i = 0; i < table.r0.length; i += 1) {
      const key = `${table.r0[i]}\0${table.lethality[i]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([table.r0[i], table.lethality[i]]);
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    pairs.forEach(([r0, lethality], index) => {
      const xs = [];
      const ys = [];
      const hover = [];
      for (let i = 0; i < table.r0.length; i += 1) {
        if (table.r0[i] !== r0 || table.lethality[i] !== lethality) continue;
        xs.push(table.year[i]);
        ys.push(table.deaths[i]);
        hover.push([table.runId[i], table.year[i], table.r0[i], table.lethality[i], table.deaths[i]]);
      }
      traces.push({
        type: "scatter",
        x: xs,
        y: ys,
        mode: "markers",
        marker: { size: 10, color: MIX_COLORS[index % MIX_COLORS.length], opacity: 0.75, line: { width: 0.6, color: "white" } },
        name: `R0 ${formatG(r0)}, lethality ${formatG(lethality)}%`,
        customdata: hover,
        hovertemplate:
          "Simulation %{customdata[0]:.0f}<br>" +
          "Month %{customdata[1]:.0f}<br>" +
          "R0: %{customdata[2]:g}<br>" +
          "Lethality: %{customdata[3]:g}%<br>" +
          "Deaths: %{customdata[4]:,.0f}" +
          "<extra></extra>",
      });
    });
  }

  const ymax = table.deaths.length ? Math.max(...table.deaths) : 0;
  const figure = {
    data: traces,
    layout: layout({
      title: "Attacks",
      hovermode: "closest",
      xaxis: { title: "Month", ...countAxis() },
      yaxis: {
        title: "Deaths",
        range: [ymax > 0 ? -0.05 * ymax : -1, ymax > 0 ? ymax * 1.05 : 1],
        ...countAxis(),
      },
      legend: { orientation: "v", yanchor: "top", y: 1, xanchor: "left", x: 1.02 },
      margin: { l: 64, r: 210, t: 56, b: 52 },
      showlegend: Boolean(table.year.length),
    }),
  };
  if (!table.year.length) {
    figure.layout.annotations = [
      {
        text: "No successful attacks in this ensemble",
        x: 0.5,
        y: 0.5,
        xref: "paper",
        yref: "paper",
        showarrow: false,
        font: { size: 14, color: MUTED },
      },
    ];
  }
  return figure;
}

const TREND_AXES = [
  "time",
  "deaths",
  "attempt_chance",
  "success_chance",
  "defense_coverage",
  "ai",
  "ai_metr",
  "ai_lag",
  "ai_lag_metr",
  "ai_lag_amount",
  "gdp_growth",
  "gdp",
  "percent_spend",
  "defense_spend",
  "ppe_price",
];
const TREND_TITLES = {
  time: "Time (month)",
  deaths: "Deaths",
  attempt_chance: "Attempt chance (%)",
  success_chance: "Success chance (%)",
  defense_coverage: "Defense coverage (%)",
  ai: "AI capabilities",
  ai_metr: "AI capabilities — METR (hours)",
  ai_lag: "AI lagged capabilities",
  ai_lag_metr: "AI lagged capabilities — METR (hours)",
  ai_lag_amount: "AI lag amount (months)",
  gdp_growth: "GDP growth (%)",
  gdp: "GDP monthly",
  percent_spend: "Defense spend (%)",
  defense_spend: "Defense spend",
  ppe_price: "PPE price",
};
const TREND_LOG = new Set(["ai", "ai_metr", "ai_lag", "ai_lag_metr", "gdp", "defense_spend"]);
const METR_HOURS_AT_ONE = 8;

function toMetrHours(values) {
  return values.map((value) => Number(value) * METR_HOURS_AT_ONE);
}

function formatMetrHours(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0 hours";
  const abs = Math.abs(value);
  let amount = value;
  let unit = "hours";
  if (abs >= 24 * 365.25) {
    amount = value / (24 * 365.25);
    unit = "years";
  } else if (abs >= 24 * 14) {
    amount = value / (24 * 30.4375);
    unit = "months";
  } else if (abs >= 48) {
    amount = value / 24;
    unit = "days";
  }
  return `${Number.parseFloat(Number(amount).toPrecision(4))} ${unit}`;
}

function pctLabel(value) {
  if (value === 0) return "0%";
  if (value >= 1) return `${value.toFixed(2)}%`;
  return `${value.toPrecision(4).replace(/\.?0+$/, "")}%`.replace(/%$/, "") + "%";
}

function seriesOrZero(values, n, scale = 1) {
  if (!values) return Array(n).fill(0);
  let arr = values;
  if (Array.isArray(arr[0])) arr = arr.flat().slice(0, n);
  if (arr.length !== n) {
    const out = Array(n).fill(0);
    for (let i = 0; i < Math.min(n, arr.length); i += 1) out[i] = Number(arr[i]) * scale;
    return out;
  }
  return arr.map((value) => Number(value) * scale);
}

function formatTrend(name, value) {
  if (name === "attempt_chance" || name === "success_chance" || name === "defense_coverage" || name === "percent_spend" || name === "gdp_growth") {
    return pctLabel(value);
  }
  if (name === "gdp" || name === "defense_spend" || name === "deaths") return formatCount(value);
  if (name === "ppe_price") return Number(value).toPrecision(4).replace(/\.?0+$/, "");
  if (name === "ai_metr" || name === "ai_lag_metr") return formatMetrHours(value);
  if (name === "ai" || name === "ai_lag") return Number(value).toPrecision(4).replace(/\.?0+$/, "");
  return String(value);
}

function trendsFigure({
  yearLabels,
  attemptChance,
  successChance,
  defenseCoverage,
  aiCapabilities = null,
  aiLag = null,
  aiLagAmount = null,
  gdpGrowth = null,
  gdp = null,
  percentSpend = null,
  ppePrice = null,
  deaths = null,
  runId = 0,
  attackR0 = null,
  attackLethality = null,
  attackFlag = null,
  xAxis = "time",
  yAxis = "deaths",
}) {
  if (!TREND_AXES.includes(xAxis) || !TREND_AXES.includes(yAxis)) {
    throw new Error("Unknown trend axis");
  }
  const years = yearLabels.map(Number);
  const n = years.length;
  const ai = seriesOrZero(aiCapabilities, n);
  const aiLagSeries = seriesOrZero(aiLag, n);
  const gdpSeries = seriesOrZero(gdp, n);
  const percentSpendSeries = seriesOrZero(percentSpend, n);
  const table = {
    time: years,
    deaths: seriesOrZero(deaths, n),
    attempt_chance: seriesOrZero(attemptChance, n, 100),
    success_chance: seriesOrZero(successChance, n, 100),
    defense_coverage: seriesOrZero(defenseCoverage, n, 100),
    ai,
    ai_metr: toMetrHours(ai),
    ai_lag: aiLagSeries,
    ai_lag_metr: toMetrHours(aiLagSeries),
    ai_lag_amount: seriesOrZero(aiLagAmount, n),
    gdp_growth: seriesOrZero(gdpGrowth, n),
    gdp: gdpSeries,
    percent_spend: percentSpendSeries,
    defense_spend: gdpSeries.map((value, i) => (value * percentSpendSeries[i]) / 100),
    ppe_price: seriesOrZero(ppePrice, n),
  };
  const flags = attackFlag ? attackFlag.map(Number) : Array(n).fill(0);
  const r0s = attackR0 ? attackR0.map(Number) : Array(n).fill(NaN);
  const lethality = attackLethality ? attackLethality.map(Number) : Array(n).fill(NaN);
  const hovertext = [];
  for (let i = 0; i < n; i += 1) {
    const flag = i < flags.length ? Number(flags[i]) : 0;
    let attackText = "No attack";
    if (flag === 1 && Number.isFinite(r0s[i]) && Number.isFinite(lethality[i])) {
      attackText = `R0: ${formatG(r0s[i])}<br>Lethality: ${formatG(lethality[i] * 100)}%`;
    } else if (flag === 2) {
      attackText = "Attempt failed";
    }
    hovertext.push(
      `Month ${Math.trunc(table.time[i])}<br>` +
        `Deaths: ${formatTrend("deaths", table.deaths[i])}<br>` +
        `${attackText}<br>` +
        `AI capabilities: ${formatTrend("ai", table.ai[i])}<br>` +
        `AI capabilities — METR: ${formatTrend("ai_metr", table.ai_metr[i])}<br>` +
        `AI lagged capabilities: ${formatTrend("ai_lag", table.ai_lag[i])}<br>` +
        `AI lagged capabilities — METR: ${formatTrend("ai_lag_metr", table.ai_lag_metr[i])}<br>` +
        `AI lag amount: ${formatTrend("ai_lag_amount", table.ai_lag_amount[i])}<br>` +
        `GDP growth: ${formatTrend("gdp_growth", table.gdp_growth[i])}<br>` +
        `GDP monthly: ${formatTrend("gdp", table.gdp[i])}<br>` +
        `Percent spend: ${formatTrend("percent_spend", table.percent_spend[i])}<br>` +
        `Defense spend: ${formatTrend("defense_spend", table.defense_spend[i])}<br>` +
        `PPE price: ${formatTrend("ppe_price", table.ppe_price[i])}<br>` +
        `Defense coverage: ${formatTrend("defense_coverage", table.defense_coverage[i])}<br>` +
        `Attempt chance: ${formatTrend("attempt_chance", table.attempt_chance[i])}<br>` +
        `Success chance: ${formatTrend("success_chance", table.success_chance[i])}`,
    );
  }

  const highlight = yAxis === "deaths" || xAxis === "deaths";
  const markerColors = highlight ? flags.map((flag) => (flag ? MEAN : LINE)) : LINE;
  const markerSizes = highlight ? flags.map((flag) => (flag ? 9 : 6)) : 6;

  function axis(name, values) {
    const spec = { title: TREND_TITLES[name], gridcolor: "#eadfce", zerolinecolor: "#d6cbb8" };
    if (name === "time") {
      const xmax = values.length ? Math.max(...values) : 1;
      return { ...spec, range: [1, xmax], ...countAxis() };
    }
    const positive = values.filter((value) => value > 0);
    if (TREND_LOG.has(name) && positive.length) {
      const ratio = Math.max(...positive) / Math.max(Math.min(...positive), 1e-300);
      if (ratio >= 100) return { ...spec, type: "log" };
    }
    const ymax = values.length ? Math.max(...values) : 0;
    const ranged = { ...spec, range: [ymax > 0 ? -0.05 * ymax : -1, ymax > 0 ? ymax * 1.05 : 1] };
    if (name === "gdp" || name === "defense_spend" || name === "deaths") return { ...ranged, ...countAxis() };
    return ranged;
  }

  return {
    data: [
      {
        type: "scatter",
        x: table[xAxis],
        y: table[yAxis],
        mode: "lines+markers",
        line: { color: LINE, width: 2 },
        marker: { size: markerSizes, color: markerColors },
        name: `Simulation ${runId}`,
        hovertext,
        hoverinfo: "text",
        hovertemplate: null,
      },
    ],
    layout: layout({
      title: `Trends: ${TREND_TITLES[yAxis]} vs ${TREND_TITLES[xAxis]} — simulation ${runId}`,
      xaxis: axis(xAxis, table[xAxis]),
      yaxis: axis(yAxis, table[yAxis]),
      showlegend: false,
    }),
  };
}

function pathogenMixFigure(yearLabels, pathogenMix, pathogenLabels = null) {
  const years = yearLabels.map(Number);
  if (!pathogenMix || !pathogenMix.length) throw new Error("This run has no pathogen mix series");
  const shares = pathogenMix;
  if (!Array.isArray(shares[0])) throw new Error("pathogen mix series is invalid");
  const nYears = shares.length;
  const nScenarios = shares[0].length;
  const labels = [...(pathogenLabels || [])];
  while (labels.length < nScenarios) labels.push(`Scenario ${labels.length + 1}`);
  const traces = [];
  for (let index = 0; index < nScenarios; index += 1) {
    const color = MIX_COLORS[index % MIX_COLORS.length];
    const ys = shares.map((row) => row[index]);
    traces.push({
      type: "scatter",
      x: years,
      y: ys,
      name: labels[index],
      mode: "lines",
      line: { width: 0.5, color },
      stackgroup: "one",
      fillcolor: color,
      hoveron: "points+fills",
      customdata: ys,
      hovertemplate: "%{customdata:.1%}<extra>%{fullData.name}</extra>",
    });
  }
  const xmax = nYears ? Math.max(...years) : 1;
  return {
    data: traces,
    layout: layout({
      title: "Pathogen mix over time",
      hovermode: "x unified",
      xaxis: {
        title: "Month",
        range: [1, xmax],
        showspikes: true,
        spikemode: "across",
        spikesnap: "cursor",
        spikecolor: MUTED,
        spikethickness: 1,
        spikedash: "solid",
        ...countAxis(),
      },
      yaxis: {
        title: "Share of mix",
        range: [0, 1],
        tickformat: ".0%",
        gridcolor: "#eadfce",
        zerolinecolor: "#d6cbb8",
      },
      legend: { orientation: "v", yanchor: "top", y: 1, xanchor: "left", x: 1.02 },
      margin: { l: 64, r: 210, t: 56, b: 52 },
    }),
  };
}

function figureFor(plotType, data, { runId = 0, xAxis = "r0", yAxis = "lethality" } = {}) {
  const nRuns = data.yearlyDeaths.length;
  if (plotType === "cumulative_distribution") {
    return cumulativeDistributionFigure(data.cumulativeDeaths, data.nYears);
  }
  if (plotType === "average_deaths_per_year") {
    return averageDeathsPerYearFigure(data.yearLabels, data.averageDeaths, nRuns);
  }
  if (plotType === "attack_scatter") {
    return attackScatterFigure(data.yearlyDeaths, data.yearLabels, data.attackR0, data.attackLethality, data.attackFlag);
  }
  if (plotType === "trends") {
    if (runId < 0 || runId >= nRuns) {
      throw new Error(`Simulation ${runId} is out of range (0–${nRuns - 1})`);
    }
    const series = {};
    for (const name of MONTHLY_SERIES) {
      series[name] = trendSeriesForRun(data, name, runId);
    }
    return trendsFigure({
      yearLabels: data.yearLabels,
      attemptChance: series.attempt_chance,
      successChance: series.success_chance,
      defenseCoverage: series.defense_coverage,
      aiCapabilities: series.ai_capabilities,
      aiLag: series.ai_lag,
      aiLagAmount: data.ai_lag_amount,
      gdpGrowth: series.gdp_growth,
      gdp: series.gdp,
      percentSpend: series.percent_spend,
      ppePrice: series.ppe_price,
      deaths: data.yearlyDeaths[runId],
      runId,
      attackR0: data.attackR0[runId],
      attackLethality: data.attackLethality[runId],
      attackFlag: data.attackFlag[runId],
      xAxis,
      yAxis,
    });
  }
  if (plotType === "pathogen_mix") {
    return pathogenMixFigure(data.yearLabels, data.pathogenMix, data.pathogenLabels);
  }
  throw new Error("Unknown plot type");
}
