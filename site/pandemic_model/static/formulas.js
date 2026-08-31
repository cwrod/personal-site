/** Safe year-dependent formulas for model parameter textboxes. */

class FormulaError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaError";
  }
}

const VAR_RE = /\[([A-Za-z_]+)\]/g;

const INPUT_VARS = ["time", "population", "prior_attack", "ai_lag", "gdp_prev"];
const OUTPUT_VARS = ["ai", "gdp_growth", "gdp", "percent_spend", "ppe_price", "defense", "attempt", "success"];
const KNOWN_VARS = new Set([...INPUT_VARS, ...OUTPUT_VARS]);
const GDP_MONTHLY_BASE = 125e12 / 12;

const VARIABLE_DEFINITIONS = [
  ["[time]", "Month index starting at 1."],
  ["[prior_attack]", "1 after a successful attack has already occurred in this simulation, otherwise 0."],
  ["[population]", "Starting population entered in the form."],
  ["[ai]", "AI capabilities this month, from the AI capabilities formula. Trends also shows this as a METR time horizon: 8 hours when capability is 1, 16 hours when capability is 2."],
  ["[ai_lag]", "AI capabilities lagged by the AI lag amount (months). Usable in formulas. Trends also shows the lagged METR time horizon."],
  [
    "[ai_lag_amount]",
    "How many months to lag AI capabilities. Set by the AI lag amount box. Shown on Trends; not usable in formulas yet.",
  ],
  ["[gdp_growth]", "Annual GDP growth this month, in percent, from the GDP growth formula."],
  ["[gdp_prev]", "Previous month's monthly GDP. Starts at 125e12/12."],
  ["[gdp]", "Monthly GDP this month. Compounds [gdp_prev] by this month's annual growth rate."],
  ["[percent_spend]", "Share of GDP spent on defense this month, in percent. Trends also shows defense spend as monthly GDP times this share."],
  ["[ppe_price]", "Price of one unit of PPE."],
  ["[defense]", "Defense coverage this month, in percent."],
  ["[attempt]", "Chance an attack is attempted this month, in percent."],
  ["[success]", "Chance a given attempt succeeds, in percent."],
];

const FUNCTION_DEFINITIONS = [
  ["min(a, b, …)", "Smallest argument."],
  ["max(a, b, …)", "Largest argument."],
  ["abs(x)", "Absolute value."],
  ["exp(x)", "e raised to x."],
  ["log(x)", "Natural logarithm."],
  ["sqrt(x)", "Square root."],
  [
    "sigmoid(x, low, high, midpoint, steepness)",
    "Logistic curve from low to high. Equals (high+low)/2 at x=midpoint. Larger steepness is a sharper rise.",
  ],
  ["asym(x, scale, speed)", "Asymptotic curve scale * (1 - exp(-x / speed)). Approaches scale as x grows."],
];

function sigmoid(x, low, high, midpoint, steepness) {
  const z = Number(steepness) * (Number(x) - Number(midpoint));
  let frac;
  if (z >= 0) {
    frac = 1 / (1 + Math.exp(-z));
  } else {
    const expZ = Math.exp(z);
    frac = expZ / (1 + expZ);
  }
  return Number(low) + (Number(high) - Number(low)) * frac;
}

function asym(x, scale, speed) {
  const ratio = Number(x) / Number(speed);
  if (ratio >= 700) return Number(scale);
  if (ratio <= -700) throw new Error("asym overflow");
  return Number(scale) * (1 - Math.exp(-ratio));
}

const ALLOWED_FUNCS = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  sigmoid,
  asym,
};

function tokenize(source, name) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "*" && source[i + 1] === "*") {
      tokens.push({ type: "pow" });
      i += 2;
      continue;
    }
    if (ch === "^") {
      tokens.push({ type: "pow" });
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "(" || ch === ")" || ch === ",") {
      tokens.push({ type: ch });
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      const start = i;
      let sawDigit = false;
      while (i < source.length && source[i] >= "0" && source[i] <= "9") {
        sawDigit = true;
        i += 1;
      }
      if (source[i] === ".") {
        i += 1;
        while (i < source.length && source[i] >= "0" && source[i] <= "9") {
          sawDigit = true;
          i += 1;
        }
      }
      if (!sawDigit) throw new FormulaError(`${name} is not a valid formula`);
      if (source[i] === "e" || source[i] === "E") {
        i += 1;
        if (source[i] === "+" || source[i] === "-") i += 1;
        const expStart = i;
        while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1;
        if (i === expStart) throw new FormulaError(`${name} is not a valid formula`);
      }
      const raw = source.slice(start, i);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new FormulaError(`${name} is not a valid formula`);
      tokens.push({ type: "num", value });
      continue;
    }
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      const start = i;
      i += 1;
      while (i < source.length) {
        const next = source[i];
        if (
          (next >= "A" && next <= "Z") ||
          (next >= "a" && next <= "z") ||
          (next >= "0" && next <= "9") ||
          next === "_"
        ) {
          i += 1;
        } else {
          break;
        }
      }
      tokens.push({ type: "id", value: source.slice(start, i).toLowerCase() });
      continue;
    }
    throw new FormulaError(`${name} is not a valid formula`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

function parseFormula(source, name, referenced) {
  const tokens = tokenize(source, name);
  let pos = 0;

  const peek = () => tokens[pos];
  const take = (type) => {
    if (peek().type !== type) throw new FormulaError(`${name} is not a valid formula`);
    const token = peek();
    pos += 1;
    return token;
  };

  function parseExpr() {
    return parseAdd();
  }

  function parseAdd() {
    let node = parseMul();
    while (peek().type === "+" || peek().type === "-") {
      const op = peek().type;
      pos += 1;
      node = { type: "bin", op, left: node, right: parseMul() };
    }
    return node;
  }

  function parseMul() {
    let node = parseUnary();
    while (peek().type === "*" || peek().type === "/") {
      const op = peek().type;
      pos += 1;
      node = { type: "bin", op, left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary() {
    if (peek().type === "+" || peek().type === "-") {
      const op = peek().type;
      pos += 1;
      return { type: "unary", op, arg: parseUnary() };
    }
    return parsePower();
  }

  function parsePower() {
    const left = parseAtom();
    if (peek().type === "pow") {
      pos += 1;
      return { type: "bin", op: "**", left, right: parseUnary() };
    }
    return left;
  }

  function parseAtom() {
    const token = peek();
    if (token.type === "num") {
      pos += 1;
      return { type: "num", value: token.value };
    }
    if (token.type === "id") {
      pos += 1;
      if (peek().type === "(") {
        if (!(token.value in ALLOWED_FUNCS)) {
          throw new FormulaError(`${name} uses an unsupported expression`);
        }
        pos += 1;
        const args = [];
        if (peek().type === ")") throw new FormulaError(`${name} uses an unsupported expression`);
        args.push(parseExpr());
        while (peek().type === ",") {
          pos += 1;
          args.push(parseExpr());
        }
        take(")");
        return { type: "call", name: token.value, args };
      }
      if (!KNOWN_VARS.has(token.value)) {
        throw new FormulaError(`${name} uses an unsupported expression`);
      }
      referenced.add(token.value);
      return { type: "var", name: token.value };
    }
    if (token.type === "(") {
      pos += 1;
      const node = parseExpr();
      take(")");
      return node;
    }
    throw new FormulaError(`${name} is not a valid formula`);
  }

  const ast = parseExpr();
  if (peek().type !== "eof") throw new FormulaError(`${name} is not a valid formula`);
  return ast;
}

function evalAst(node, env) {
  switch (node.type) {
    case "num":
      return node.value;
    case "var":
      return env[node.name];
    case "unary": {
      const value = evalAst(node.arg, env);
      return node.op === "-" ? -value : value;
    }
    case "bin": {
      const left = evalAst(node.left, env);
      const right = evalAst(node.right, env);
      switch (node.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "**":
          return left ** right;
        default:
          throw new Error("unknown operator");
      }
    }
    case "call": {
      const args = node.args.map((arg) => evalAst(arg, env));
      return ALLOWED_FUNCS[node.name](...args);
    }
    default:
      throw new Error("unknown node");
  }
}

class CompiledFormula {
  constructor(name, source, referenced, ast) {
    this.name = name;
    this.source = source;
    this.referenced = referenced;
    this.ast = ast;
  }

  evaluate(env) {
    const local = {};
    for (const key of this.referenced) {
      local[key] = Number(env[key]);
    }
    let value;
    try {
      value = evalAst(this.ast, local);
    } catch (exc) {
      throw new FormulaError(`${this.name} could not be evaluated`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
      if (Number.isNaN(number) && (value === undefined || value === null || typeof value === "number")) {
        throw new FormulaError(`${this.name} evaluated to a non-finite number`);
      }
      if (!Number.isFinite(number)) {
        if (typeof value !== "number" && value !== undefined) {
          throw new FormulaError(`${this.name} must evaluate to a number`);
        }
        throw new FormulaError(`${this.name} evaluated to a non-finite number`);
      }
    }
    return number;
  }
}

function compileFormula(expr, name = "formula") {
  const text = String(expr ?? "").trim();
  if (!text) throw new FormulaError(`${name} is empty`);
  const referenced = new Set();
  const normalized = text.replace(VAR_RE, (_, raw) => {
    const variable = raw.toLowerCase();
    if (!KNOWN_VARS.has(variable)) {
      throw new FormulaError(`${name} uses unknown variable [${raw}]`);
    }
    referenced.add(variable);
    return variable;
  });
  let ast;
  try {
    ast = parseFormula(normalized, name, referenced);
  } catch (exc) {
    if (exc instanceof FormulaError) throw exc;
    throw new FormulaError(`${name} is not a valid formula`);
  }
  return new CompiledFormula(name, text, referenced, ast);
}

function topoOrder(compiled, resolved) {
  const remaining = new Set(Object.keys(compiled));
  const done = new Set(resolved);
  const order = [];
  while (remaining.size) {
    const ready = [...remaining].filter((name) => {
      for (const ref of compiled[name].referenced) {
        if (!done.has(ref)) return false;
      }
      return true;
    });
    if (!ready.length) {
      throw new FormulaError(`Formulas depend on each other in a cycle: ${[...remaining].sort().join(", ")}`);
    }
    ready.sort();
    for (const name of ready) {
      remaining.delete(name);
      done.add(name);
      order.push(name);
    }
  }
  return order;
}

class FormulaSystem {
  constructor(formulas, { population, percentFields = [] } = {}) {
    this.population = Number(population);
    this.percentFields = new Set(percentFields);
    this.compiled = {};
    this.constants = {};
    this.kinds = {};
    for (const [name, value] of Object.entries(formulas)) {
      if (!OUTPUT_VARS.includes(name)) {
        throw new FormulaError(`Unknown formula field ${name}`);
      }
      if (typeof value === "string") {
        this.compiled[name] = compileFormula(value, name);
        this.kinds[name] = "formula";
      } else {
        this.constants[name] = Number(value);
        this.kinds[name] = "constant";
      }
    }
    this.order = topoOrder(this.compiled, new Set([...INPUT_VARS, ...Object.keys(this.constants)]));
  }

  evaluateYear(year, extra = null) {
    const env = {
      time: Number(year) + 1,
      population: this.population,
      prior_attack: 0,
      ai_lag: 0,
      gdp_prev: GDP_MONTHLY_BASE,
    };
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        env[key] = Number(value);
      }
    }
    for (const [name, value] of Object.entries(this.constants)) {
      env[name] = this.percentFields.has(name) ? value * 100 : value;
    }
    for (const name of this.order) {
      env[name] = this.compiled[name].evaluate(env);
    }
    return env;
  }

  modelValue(name, year, env = null) {
    const raw = (env || this.evaluateYear(year))[name];
    if (this.percentFields.has(name) && this.kinds[name] === "formula") return raw * 0.01;
    if (this.percentFields.has(name) && this.kinds[name] === "constant") return this.constants[name];
    return raw;
  }

  series(nYears, { aiLagAmount = 0, extra = null } = {}) {
    const delay = Math.max(Number(aiLagAmount) || 0, 0);
    const extraEnv = { ...(extra || {}) };
    const ais = [];
    let gdpPrev = extraEnv.gdp_prev == null ? GDP_MONTHLY_BASE : Number(extraEnv.gdp_prev);
    const out = { time: [], population: [], ai_lag: [] };
    for (const name of OUTPUT_VARS) out[name] = [];
    for (let year = 0; year < nYears; year += 1) {
      const monthExtra = { ...extraEnv, gdp_prev: gdpPrev };
      let env;
      if (year === 0) {
        env = this.evaluateYear(year, { ...monthExtra, ai_lag: 0 });
        env = this.evaluateYear(year, { ...monthExtra, ai_lag: Number(env.ai) });
      } else {
        env = this.evaluateYear(year, { ...monthExtra, ai_lag: ais[Math.max(0, year - delay)] });
      }
      ais.push(Number(env.ai));
      gdpPrev = Number(env.gdp || gdpPrev);
      for (const name of Object.keys(out)) {
        out[name].push(Number(env[name]));
      }
    }
    return out;
  }
}
