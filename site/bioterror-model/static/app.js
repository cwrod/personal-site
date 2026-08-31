(function () {
const statusEl = document.getElementById("status");
const formDefaults = self.SITE_CLIENT;
if (!formDefaults) {
  statusEl.classList.add("error");
  statusEl.textContent = "Missing static/defaults.js. Run: .venv/bin/python site_client/build.py";
  return;
}
const form = document.getElementById("run-form");
const rows = document.getElementById("scenario-rows");
const addButton = document.getElementById("add-scenario");
const runButton = document.getElementById("run-button");
const resultsPanel = document.getElementById("results");
const plotType = document.getElementById("plot-type");
const simSelect = document.getElementById("sim-select");
const simWrap = document.getElementById("sim-wrap");
const xAxisWrap = document.getElementById("x-axis-wrap");
const yAxisWrap = document.getElementById("y-axis-wrap");
const xAxis = document.getElementById("x-axis");
const yAxis = document.getElementById("y-axis");

let currentResult = null;
let plotRequest = 0;
let worker = null;
let runId = 0;

function createLocalRunner() {
  const messageListeners = new Set();
  return {
    addEventListener(type, fn) {
      if (type === "message") messageListeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === "message") messageListeners.delete(fn);
    },
    postMessage(data) {
      const { id, payload } = data;
      setTimeout(() => {
        try {
          const result = exportEnsemble(payload, (done, total) => {
            for (const fn of messageListeners) fn({ data: { id, type: "progress", done, total } });
          });
          for (const fn of messageListeners) fn({ data: { id, type: "done", result } });
        } catch (error) {
          for (const fn of messageListeners) fn({ data: { id, type: "error", error: error.message || String(error) } });
        }
      }, 0);
    },
  };
}

function getWorker() {
  if (worker) return worker;
  if (location.protocol === "file:") {
    worker = createLocalRunner();
    return worker;
  }
  try {
    worker = new Worker("static/worker.js");
  } catch (error) {
    worker = createLocalRunner();
  }
  return worker;
}

function scenarioRow(r0 = "", lethalityPct = "", weight = "1") {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="r0" type="number" min="0" step="0.01" required /></td>
    <td><input class="lethality" type="number" min="0" max="100" step="0.01" required /></td>
    <td class="weight"><input class="weight" type="text" required /></td>
    <td><button type="button" class="remove" aria-label="Remove scenario">×</button></td>
  `;
  tr.querySelector(".r0").value = r0;
  tr.querySelector(".lethality").value = lethalityPct;
  tr.querySelector("input.weight").value = weight || "1";
  tr.querySelector(".remove").addEventListener("click", () => {
    if (rows.children.length === 1) return;
    tr.remove();
  });
  return tr;
}

function pctToProb(value) {
  return Number(value) / 100;
}

function formatCount(value) {
  return Math.round(value).toLocaleString();
}

function fillSimSelect(nRuns, cumulativeDeaths, nAttacks, selected) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < nRuns; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    const deaths = cumulativeDeaths[i] || 0;
    const attacks = nAttacks[i] || 0;
    const attackLabel = attacks === 1 ? "1 attack" : `${attacks} attacks`;
    const deathLabel = deaths > 0 ? `, ${formatCount(deaths)} deaths` : "";
    option.textContent = `${i} — ${attackLabel}${deathLabel}`;
    frag.appendChild(option);
  }
  simSelect.innerHTML = "";
  simSelect.appendChild(frag);
  simSelect.value = String(selected);
}

const TREND_AXES = [
  { value: "time", label: "Time" },
  { value: "deaths", label: "Deaths" },
  { value: "attempt_chance", label: "Attempt chance" },
  { value: "success_chance", label: "Success chance" },
  { value: "defense_coverage", label: "Defense coverage" },
  { value: "ai", label: "AI capabilities" },
  { value: "ai_metr", label: "AI capabilities - METR" },
  { value: "ai_lag", label: "AI lagged capabilities" },
  { value: "ai_lag_metr", label: "AI lagged capabilities - METR" },
  { value: "ai_lag_amount", label: "AI lag amount" },
  { value: "gdp_growth", label: "GDP growth" },
  { value: "gdp", label: "GDP monthly" },
  { value: "percent_spend", label: "Percent spend" },
  { value: "defense_spend", label: "Defense spend" },
  { value: "ppe_price", label: "PPE price" },
];

let axisMode = "";

function fillAxisSelect(select, axes, selected) {
  const frag = document.createDocumentFragment();
  for (const axis of axes) {
    const option = document.createElement("option");
    option.value = axis.value;
    option.textContent = axis.label;
    frag.appendChild(option);
  }
  select.innerHTML = "";
  select.appendChild(frag);
  select.value = selected;
}

function syncControlVisibility() {
  const trends = plotType.value === "trends";
  simWrap.hidden = !trends;
  xAxisWrap.hidden = !trends;
  yAxisWrap.hidden = !trends;
  const mode = trends ? "trends" : "";
  if (mode && mode !== axisMode) {
    fillAxisSelect(xAxis, TREND_AXES, "time");
    fillAxisSelect(yAxis, TREND_AXES, "deaths");
  }
  axisMode = mode;
}

async function renderPlot() {
  if (!currentResult) return;
  const requestId = ++plotRequest;
  const figure = figureFor(plotType.value, currentResult, {
    runId: Number(simSelect.value || 0),
    xAxis: xAxis.value,
    yAxis: yAxis.value,
  });
  if (requestId !== plotRequest) return;
  await window.Plotly.newPlot("plot", figure.data, figure.layout, { responsive: true, displaylogo: false });
}

const COPYCATS_ATTEMPT = formDefaults.presets.copycats;
const SPEND_PRESETS = formDefaults.presets.spend;
const AI_UPLIFT_SUCCESS = formDefaults.presets.ai_uplift;
const AI_PACE = formDefaults.presets.ai_pace;
const DIFFUSION_AI_LAG = formDefaults.presets.diffusion;
const BASE_PATHOGENS = formDefaults.presets.base_pathogens;
const SUPERVIRUS_EXTRA = formDefaults.presets.supervirus;

function applyFormDefaults() {
  const fields = [
    ["n_years", "n_years"],
    ["n_runs", "n_runs"],
    ["population", "population"],
    ["seed", "seed"],
    ["attempt_prob_pct", "attempt_prob_pct"],
    ["success_prob_pct", "success_prob_pct"],
    ["ai_capabilities", "ai_capabilities"],
    ["ai_lag_amount", "ai_lag_amount"],
    ["gdp_growth", "gdp_growth"],
    ["percent_spend", "percent_spend"],
    ["annual_defense_increase_pct", "annual_defense_increase_pct"],
    ["ppe_price", "ppe_price"],
  ];
  for (const [id, key] of fields) {
    const el = document.getElementById(id);
    if (el && formDefaults[key] != null) el.value = formDefaults[key];
  }
  const nYears = document.getElementById("n_years");
  const nRuns = document.getElementById("n_runs");
  if (nYears && formDefaults.max_years != null) nYears.max = String(formDefaults.max_years);
  if (nRuns && formDefaults.max_runs != null) nRuns.max = String(formDefaults.max_runs);
}

function selectedPreset(name) {
  const input = form.querySelector(`input[name="${name}"]:checked`);
  return input ? input.value : "";
}

function applyCopycatsPreset() {
  const formula = COPYCATS_ATTEMPT[selectedPreset("preset_copycats")];
  if (!formula) return;
  document.getElementById("attempt_prob_pct").value = formula;
}

function applySpendPresets() {
  const key = `${selectedPreset("preset_rush")}|${selectedPreset("preset_biodefense")}`;
  const formula = SPEND_PRESETS[key];
  if (!formula) return;
  document.getElementById("percent_spend").value = formula;
}

function applyAiUpliftPreset() {
  const formula = AI_UPLIFT_SUCCESS[selectedPreset("preset_ai_uplift")];
  if (!formula) return;
  document.getElementById("success_prob_pct").value = formula;
}

function applyAiPacePreset() {
  const formula = AI_PACE[selectedPreset("preset_ai_pace")];
  if (!formula) return;
  document.getElementById("ai_capabilities").value = formula;
}

function applyDiffusionPreset() {
  const lag = DIFFUSION_AI_LAG[selectedPreset("preset_diffusion")];
  if (lag == null) return;
  document.getElementById("ai_lag_amount").value = String(lag);
}

function applySupervirusPreset() {
  const extra = SUPERVIRUS_EXTRA[selectedPreset("preset_supervirus")];
  if (extra == null) return;
  rows.replaceChildren();
  [...BASE_PATHOGENS, ...extra].forEach((item) => {
    rows.appendChild(scenarioRow(item.r0, item.lethality_pct, item.weight));
  });
}

applyFormDefaults();
formDefaults.pathogen_scenarios.forEach((item) => {
  rows.appendChild(scenarioRow(item.r0, item.lethality_pct, item.weight));
});

addButton.addEventListener("click", () => {
  rows.appendChild(scenarioRow());
});

form.querySelectorAll('input[name="preset_copycats"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) applyCopycatsPreset();
  });
});

form.querySelectorAll('input[name="preset_rush"], input[name="preset_biodefense"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) applySpendPresets();
  });
});

form.querySelectorAll('input[name="preset_ai_uplift"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) applyAiUpliftPreset();
  });
});

form.querySelectorAll('input[name="preset_ai_pace"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) applyAiPacePreset();
  });
});

form.querySelectorAll('input[name="preset_diffusion"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) applyDiffusionPreset();
  });
});

form.querySelectorAll('input[name="preset_supervirus"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) applySupervirusPreset();
  });
});

plotType.addEventListener("change", () => {
  syncControlVisibility();
  renderPlot().catch((error) => {
    statusEl.classList.add("error");
    statusEl.textContent = error.message;
  });
});

simSelect.addEventListener("change", () => {
  renderPlot().catch((error) => {
    statusEl.classList.add("error");
    statusEl.textContent = error.message;
  });
});

xAxis.addEventListener("change", () => {
  renderPlot().catch((error) => {
    statusEl.classList.add("error");
    statusEl.textContent = error.message;
  });
});

yAxis.addEventListener("change", () => {
  renderPlot().catch((error) => {
    statusEl.classList.add("error");
    statusEl.textContent = error.message;
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.classList.remove("error");
  statusEl.textContent = "Running ensemble…";
  runButton.disabled = true;

  const pathogenScenarios = [...rows.querySelectorAll("tr")].map((row) => ({
    r0: Number(row.querySelector(".r0").value),
    lethality: pctToProb(row.querySelector(".lethality").value),
    weight: row.querySelector("input.weight").value.trim(),
  }));

  const raw = {
    n_years: Number(document.getElementById("n_years").value),
    n_runs: Number(document.getElementById("n_runs").value),
    population: Number(document.getElementById("population").value),
    seed: Number(document.getElementById("seed").value),
    attempt_prob_per_year: document.getElementById("attempt_prob_pct").value.trim(),
    success_prob: document.getElementById("success_prob_pct").value.trim(),
    annual_defense_increase: document.getElementById("annual_defense_increase_pct").value.trim(),
    ai_capabilities: document.getElementById("ai_capabilities").value.trim(),
    ai_lag_amount: Number(document.getElementById("ai_lag_amount").value),
    gdp_growth: document.getElementById("gdp_growth").value.trim(),
    percent_spend: document.getElementById("percent_spend").value.trim(),
    ppe_price: document.getElementById("ppe_price").value.trim(),
    pathogen_scenarios: pathogenScenarios,
    max_runs: formDefaults.max_runs,
    max_years: formDefaults.max_years,
  };

  let payload;
  try {
    payload = validatePayload(raw);
  } catch (error) {
    statusEl.classList.add("error");
    statusEl.textContent = error.message;
    runButton.disabled = false;
    return;
  }

  const id = ++runId;
  const started = performance.now();
  try {
    const data = await new Promise((resolve, reject) => {
      const handle = (event) => {
        if (event.data.id !== id) return;
        if (event.data.type === "progress") {
          statusEl.textContent = `Running ensemble… ${event.data.done.toLocaleString()} / ${event.data.total.toLocaleString()}`;
          return;
        }
        getWorker().removeEventListener("message", handle);
        if (event.data.type === "error") reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      getWorker().addEventListener("message", handle);
      getWorker().addEventListener(
        "error",
        (error) => {
          getWorker().removeEventListener("message", handle);
          reject(error);
        },
        { once: true },
      );
      getWorker().postMessage({ id, payload });
    });

    currentResult = data;
    plotType.value = "cumulative_distribution";
    fillSimSelect(data.nRuns, data.cumulativeDeaths, data.nAttacks || [], data.exampleRun);
    syncControlVisibility();

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    document.getElementById("output-path").textContent =
      `Finished ${data.nRuns.toLocaleString()} simulations over ${data.nYears.toLocaleString()} months in ${seconds}s`;
    document.getElementById("stats").innerHTML = `
      <div><dt>Mean deaths</dt><dd>${formatCount(data.meanCumulativeDeaths)}</dd></div>
      <div><dt>Median deaths</dt><dd>${formatCount(data.medianCumulativeDeaths)}</dd></div>
      <div><dt>Worst run</dt><dd>${formatCount(data.maxCumulativeDeaths)}</dd></div>
      <div><dt>Zero-death runs</dt><dd>${data.zeroRuns.toLocaleString()} / ${data.nRuns.toLocaleString()}</dd></div>
    `;

    resultsPanel.hidden = false;
    await renderPlot();
    statusEl.textContent = "Finished";
    resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    statusEl.classList.add("error");
    statusEl.textContent = error.message || "Run failed";
  } finally {
    runButton.disabled = false;
  }
});
})();
