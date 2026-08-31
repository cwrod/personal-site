const INK = "#1c1917";
const MUTED = "#6b6358";
const PAPER = "#fffdf8";
const LINE_MUTED = "#8a8176";

const defaults = window.PRESET_SWEEP || {};
const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("preset-rows");
const categoryNames = (defaults.categories || []).map((category) => category.name);
const comboCache = [];
const plotOptions = { responsive: true, displaylogo: false };

let plotRequest = 0;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCount(value) {
  if (value >= 1e9) return `${Number(value / 1e9)}B`;
  if (value >= 1e6) return `${Number(value / 1e6)}M`;
  if (value >= 1e3) return `${Number(value / 1e3)}K`;
  return `${Number(value)}`;
}

function formatDeaths(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPct(value) {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const magnitude = abs >= 100 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return `${sign}${magnitude}%`;
}

function comboAt(index) {
  const cached = comboCache[index];
  if (cached) return cached;
  const keys = defaults.combos[index];
  const combo = {};
  defaults.categories.forEach((category, offset) => {
    combo[category.name] = category.levels[keys[offset]];
  });
  comboCache[index] = combo;
  return combo;
}

function deathsAt(index) {
  return defaults.deaths[index];
}

function selectedLevels(selected) {
  const chosen = {};
  (defaults.categories || []).forEach((category) => {
    const allowed = new Set(category.levels);
    const values = selected[category.name];
    if (!Array.isArray(values)) return;
    chosen[category.name] = values.filter((level) => allowed.has(level));
  });
  return chosen;
}

function hasAnySelection(selected) {
  return Object.values(selected).some((levels) => levels.length);
}

function comboMatches(combo, selected) {
  if (!hasAnySelection(selected)) return false;
  return Object.entries(selected).every(([name, levels]) => !levels.length || levels.includes(combo[name]));
}

function familyMatchCombo(combo, selected, category, left, right) {
  let next = selected;
  if (category in selected) {
    if (selected[category].length && !(selected[category].includes(left) && selected[category].includes(right))) {
      return false;
    }
    next = Object.fromEntries(Object.entries(selected).filter(([name]) => name !== category));
  }
  return comboMatches(combo, next);
}

function pointHover(combo, deaths) {
  return [...categoryNames.map((name) => `${name}: ${combo[name]}`), `${defaults.metric}: ${formatDeaths(deaths)}`].join("<br>");
}

function deltaHover(pair, item) {
  return [
    `${pair.left} to ${pair.right}`,
    ...pair.family_keys.map((name) => `${name}: ${comboAt(item.row)[name]}`),
    `${defaults.metric} (${pair.left}): ${formatDeaths(item.before)}`,
    `${defaults.metric} (${pair.right}): ${formatDeaths(item.after)}`,
    `Relative change: ${formatPct(item.value)}`,
  ].join("<br>");
}

function layout(extra) {
  return {
    paper_bgcolor: PAPER,
    plot_bgcolor: PAPER,
    font: { family: "Palatino, Times New Roman, serif", color: INK, size: 14 },
    margin: { l: 72, r: 28, t: 56, b: 72 },
    hovermode: "closest",
    hoverdistance: 40,
    hoverlabel: { align: "left", namelength: -1 },
    legend: { orientation: "h", yanchor: "bottom", y: 1.02, x: 0 },
    ...extra,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function violinFigure(category, selected) {
  const pack = defaults.plots[category];
  if (!pack) throw new Error(`No plot data for ${category}`);
  const geom = pack.violin;
  const levels = geom.levels;
  const colors = geom.colors;
  const positions = geom.positions;
  const chosen = selectedLevels(selected);
  const otherSelected = Object.fromEntries(Object.entries(chosen).filter(([name]) => name !== category));
  const traces = [];

  levels.forEach((level) => {
    const ys = geom.points[level].y;
    if (!ys.length) return;
    const color = colors[level];
    traces.push({
      type: "violin",
      x: ys.map(() => positions[level]),
      y: ys,
      name: level,
      width: 0.72,
      spanmode: "hard",
      line: { color, width: 1.1 },
      fillcolor: color,
      opacity: 0.28,
      points: false,
      box: { visible: false },
      meanline: { visible: false },
      hoverinfo: "skip",
      hoveron: "violins",
      showlegend: false,
    });
  });

  const lineX = [];
  const lineY = [];
  geom.families.forEach((family) => {
    if (family.x.length < 2) return;
    lineX.push(...family.x, null);
    lineY.push(...family.y, null);
  });
  if (lineX.length) {
    traces.push({
      type: "scatter",
      x: lineX,
      y: lineY,
      mode: "lines",
      line: { color: LINE_MUTED, width: 0.55 },
      opacity: 0.18,
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  levels.forEach((level) => {
    const color = colors[level];
    const bucket = geom.points[level];
    if (bucket.x.length) {
      traces.push({
        type: "scatter",
        x: bucket.x,
        y: bucket.y,
        mode: "markers",
        marker: { size: 7, color, opacity: 0.55, line: { width: 0.25, color: "white" } },
        hovertext: bucket.row.map((row) => pointHover(comboAt(row), deathsAt(row))),
        hoverinfo: "text",
        hovertemplate: "%{hovertext}<extra></extra>",
        customdata: bucket.row,
        showlegend: false,
        name: level,
      });
    }
    if (bucket.y.length) {
      const mid = median(bucket.y);
      const x = positions[level];
      traces.push({
        type: "scatter",
        x: [x - 0.18, x + 0.18],
        y: [mid, mid],
        mode: "lines",
        line: { color, width: 2.2 },
        hoverinfo: "skip",
        showlegend: false,
      });
    }
  });

  const boldLineX = [];
  const boldLineY = [];
  geom.families.forEach((family) => {
    const combo = comboAt(family.row);
    const familyOther = Object.fromEntries(Object.entries(combo).filter(([name]) => name !== category));
    if (!comboMatches(familyOther, otherSelected) || family.x.length < 2) return;
    boldLineX.push(...family.x, null);
    boldLineY.push(...family.y, null);
  });
  if (boldLineX.length) {
    traces.push({
      type: "scatter",
      x: boldLineX,
      y: boldLineY,
      mode: "lines",
      line: { color: INK, width: 2.2 },
      opacity: 0.85,
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  levels.forEach((level) => {
    const color = colors[level];
    const bucket = geom.points[level];
    const boldX = [];
    const boldY = [];
    const boldHover = [];
    const boldCombo = [];
    bucket.x.forEach((x, index) => {
      const row = bucket.row[index];
      const combo = comboAt(row);
      if (!comboMatches(combo, chosen)) return;
      boldX.push(x);
      boldY.push(bucket.y[index]);
      boldHover.push(pointHover(combo, deathsAt(row)));
      boldCombo.push(row);
    });
    if (!boldX.length) return;
    traces.push({
      type: "scatter",
      x: boldX,
      y: boldY,
      mode: "markers",
      marker: { size: 12, color, opacity: 1, line: { width: 1.6, color: INK } },
      hovertext: boldHover,
      hoverinfo: "text",
      hovertemplate: "%{hovertext}<extra></extra>",
      customdata: boldCombo,
      showlegend: false,
      name: `${level} (selected)`,
    });
  });

  const lo = Math.floor(geom.ymin);
  const hi = Math.ceil(geom.ymax);
  const ticks = [];
  for (let tick = lo; tick <= hi; tick += 1) ticks.push(tick);
  const rotate = Math.max(...levels.map((level) => level.length)) > 14 ? 15 : 0;
  return {
    data: traces,
    layout: layout({
      title: `${defaults.metric} by ${category}`,
      xaxis: {
        title: "",
        type: "linear",
        tickmode: "array",
        tickvals: levels.map((level) => positions[level]),
        ticktext: levels,
        tickangle: rotate,
        gridcolor: "#eadfce",
        zeroline: false,
        range: [-0.7, levels.length - 0.3],
      },
      yaxis: {
        title: defaults.metric,
        tickmode: "array",
        tickvals: ticks,
        ticktext: ticks.map((tick) => formatCount(10 ** tick)),
        range: [geom.ymin - 0.08, geom.ymax + 0.12],
        gridcolor: "#eadfce",
        zerolinecolor: "#d6cbb8",
      },
      annotations: [
        {
          text: `Each point is one preset. Lines connect presets that differ only in ${category.toLowerCase()}.`,
          x: 0.5,
          y: rotate ? -0.18 : -0.14,
          xref: "paper",
          yref: "paper",
          showarrow: false,
          font: { size: 12, color: MUTED },
        },
      ],
    }),
  };
}

function deltaFigures(category, selected) {
  const pack = defaults.plots[category];
  if (!pack) throw new Error(`No plot data for ${category}`);
  const chosen = selectedLevels(selected);
  return pack.deltas.map((pair) => {
    const traces = [
      {
        type: "scatter",
        x: pair.grid,
        y: pair.kde_y,
        mode: "lines",
        fill: "tozeroy",
        line: { color: pair.color, width: 1.2 },
        fillcolor: pair.color,
        opacity: 0.22,
        hoverinfo: "skip",
        showlegend: false,
      },
    ];
    traces.push({
        type: "scatter",
        x: pair.xs,
        y: pair.ys,
        mode: "markers",
        marker: { size: 8, color: pair.color, opacity: 0.7, line: { width: 0.3, color: "white" } },
        hovertext: pair.records.map((item) => deltaHover(pair, item)),
        hoverinfo: "text",
        hovertemplate: "%{hovertext}<extra></extra>",
        customdata: pair.records.map((item) => item.row),
        showlegend: false,
        name: `${pair.left} to ${pair.right}`,
      });
    const boldX = [];
    const boldY = [];
    const boldHover = [];
    const boldCombo = [];
    pair.xs.forEach((x, index) => {
      const item = pair.records[index];
      const combo = comboAt(item.row);
      if (!familyMatchCombo(combo, chosen, category, pair.left, pair.right)) return;
      boldX.push(x);
      boldY.push(pair.ys[index]);
      boldHover.push(deltaHover(pair, item));
      boldCombo.push(item.row);
    });
    if (boldX.length) {
      traces.push({
        type: "scatter",
        x: boldX,
        y: boldY,
        mode: "markers",
        marker: { size: 12, color: pair.color, opacity: 1, line: { width: 1.6, color: INK } },
        hovertext: boldHover,
        hoverinfo: "text",
        hovertemplate: "%{hovertext}<extra></extra>",
        customdata: boldCombo,
        showlegend: false,
        name: `${pair.left} to ${pair.right} (selected)`,
      });
    }
    const kdeMax = pair.kde_y.length ? Math.max(...pair.kde_y) : 1;
    const ymax = Math.max(pair.peak * 1.08, kdeMax || 1, 1);
    const values = pair.records.map((item) => item.value);
    const meanValue = values.length ? mean(values) : 0;
    return {
      data: traces,
      layout: layout({
        title: `${pair.left} to ${pair.right}`,
        margin: { l: 72, r: 28, t: 56, b: 72 },
        xaxis: {
          title: "Relative change in mean deaths",
          ticksuffix: "%",
          zeroline: false,
          gridcolor: "#eadfce",
          range: [pair.xmin - pair.pad, pair.xmax + pair.pad],
        },
        yaxis: {
          title: "",
          showticklabels: false,
          rangemode: "tozero",
          range: [-0.04, ymax],
          gridcolor: "#eadfce",
          zerolinecolor: "#d6cbb8",
        },
        shapes: [
          {
            type: "line",
            xref: "x",
            yref: "paper",
            x0: 0,
            x1: 0,
            y0: 0,
            y1: 1,
            layer: "below",
            line: { dash: "dot", color: LINE_MUTED, width: 1 },
          },
          ...(values.length
            ? [
                {
                  type: "line",
                  xref: "x",
                  yref: "paper",
                  x0: meanValue,
                  x1: meanValue,
                  y0: 0,
                  y1: 1,
                  layer: "below",
                  line: { dash: "dash", color: pair.color, width: 1.4 },
                },
              ]
            : []),
        ],
        annotations: values.length
          ? [
              {
                x: meanValue,
                y: 1,
                xref: "x",
                yref: "paper",
                text: formatPct(meanValue),
                showarrow: false,
                xanchor: meanValue >= 0 ? "left" : "right",
                yanchor: "top",
                xshift: meanValue >= 0 ? 6 : -6,
                yshift: -4,
                font: { size: 12, color: pair.color },
              },
            ]
          : [],
      }),
    };
  });
}

function selectedCategory() {
  const input = document.querySelector('input[name="plot_category"]:checked');
  return input ? input.value : defaults.categories[0].name;
}

function applyRowSelection(category) {
  document.querySelectorAll(".preset-row-wrap").forEach((wrap) => {
    const name = wrap.dataset.category;
    const selected = name === category;
    wrap.classList.toggle("selected", selected);
    wrap.querySelectorAll('input[type="checkbox"]').forEach((input, index) => {
      input.disabled = selected;
      input.checked = selected;
    });
  });
}

function selectedPresets() {
  const plotted = selectedCategory();
  const selected = {};
  defaults.categories.forEach((category) => {
    if (category.name === plotted) return;
    selected[category.name] = [...document.querySelectorAll(`input[type="checkbox"][name="${category.name}"]:checked`)].map(
      (input) => input.value
    );
  });
  return selected;
}

function applyCombo(combo) {
  const category = selectedCategory();
  document.querySelectorAll(".preset-row-wrap").forEach((wrap) => {
    const name = wrap.dataset.category;
    const locked = name === category;
    wrap.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.disabled = locked;
      input.checked = locked || input.value === combo[name];
    });
  });
}

function comboFromClick(data) {
  const point = data.points && data.points[0];
  if (!point) return null;
  const row = Array.isArray(point.customdata) ? point.customdata[0] : point.customdata;
  if (typeof row === "number" && Number.isFinite(row)) return comboAt(Math.trunc(row));
  if (row && typeof row === "object") return row;
  return null;
}

function bindPlotClicks(el) {
  if (el.dataset.clickBound) return;
  el.dataset.clickBound = "1";
  el.on("plotly_click", (data) => {
    const combo = comboFromClick(data);
    if (!combo) return;
    applyCombo(combo);
    renderPlot().catch((error) => {
      statusEl.classList.add("error");
      statusEl.textContent = error.message;
    });
  });
}

async function drawFigure(el, figure) {
  if (el.data) {
    await Plotly.react(el, figure.data, figure.layout, plotOptions);
  } else {
    await Plotly.newPlot(el, figure.data, figure.layout, plotOptions);
    bindPlotClicks(el);
  }
}

function deltaSlots(count) {
  const host = document.getElementById("delta-plots");
  while (host.children.length > count) {
    const last = host.lastElementChild;
    Plotly.purge(last);
    last.remove();
  }
  while (host.children.length < count) {
    const el = document.createElement("div");
    el.className = "delta-plot";
    el.id = `delta-plot-${host.children.length}`;
    host.appendChild(el);
  }
  return [...host.children];
}

async function renderPlot() {
  const requestId = ++plotRequest;
  statusEl.classList.remove("error");
  statusEl.textContent = "";
  const category = selectedCategory();
  const selected = selectedPresets();
  const violin = violinFigure(category, selected);
  const deltas = deltaFigures(category, selected);
  if (requestId !== plotRequest) return;
  await drawFigure(document.getElementById("plot"), violin);
  const slots = deltaSlots(deltas.length);
  for (let index = 0; index < deltas.length; index += 1) {
    await drawFigure(slots[index], deltas[index]);
  }
}

function renderRows() {
  rowsEl.innerHTML = defaults.categories
    .map((category, index) => {
      const selected = index === 0;
      const chips = category.levels
        .map(
          (level, levelIndex) => `
            <label class="preset-chip">
              <input
                type="checkbox"
                name="${escapeHtml(category.name)}"
                value="${escapeHtml(level)}"
                ${selected ? "checked" : ""}
              />
              ${escapeHtml(level)}
            </label>`
        )
        .join("");
      return `
        <div class="preset-row-wrap${selected ? " selected" : ""}" data-category="${escapeHtml(category.name)}">
          <label class="row-pick">
            <input
              type="radio"
              name="plot_category"
              value="${escapeHtml(category.name)}"
              aria-label="Plot ${escapeHtml(category.name)}"
              ${selected ? "checked" : ""}
            />
          </label>
          <fieldset class="preset-row" aria-label="${escapeHtml(category.name)}">${chips}</fieldset>
        </div>`;
    })
    .join("");
}

function clearAllSelections() {
  document.querySelectorAll(".preset-row-wrap:not(.selected) input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
}

function bindControls() {
  document.getElementById("clear-all").addEventListener("click", () => {
    clearAllSelections();
    renderPlot().catch((error) => {
      statusEl.classList.add("error");
      statusEl.textContent = error.message;
    });
  });
  document.querySelectorAll('input[name="plot_category"]').forEach((input) => {
    input.addEventListener("click", () => {
      applyRowSelection(input.value);
      renderPlot().catch((error) => {
        statusEl.classList.add("error");
        statusEl.textContent = error.message;
      });
    });
  });
  rowsEl.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== "checkbox") return;
    renderPlot().catch((error) => {
      statusEl.classList.add("error");
      statusEl.textContent = error.message;
    });
  });
}

const comboCountEl = document.getElementById("combo-count");
if (comboCountEl && Array.isArray(defaults.combos) && defaults.combos.length) {
  comboCountEl.textContent = defaults.combos.length.toLocaleString("en-US");
}

if (!defaults.has_sweep || !defaults.plots) {
  statusEl.classList.add("error");
  statusEl.textContent = "Run python site_preset_sweep_client/build.py after scripts/preset_sweep.py.";
} else {
  renderRows();
  bindControls();
  applyRowSelection(selectedCategory());
  renderPlot().catch((error) => {
    statusEl.classList.add("error");
    statusEl.textContent = error.message;
  });
}
