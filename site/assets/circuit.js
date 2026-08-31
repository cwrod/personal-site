(() => {
  const hash01 = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  };

  const makeRng = (seed) => {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };

  const initChaos = () => {
    const BURST = 10;
    const TRICKLE_PER_SEC = 20;
    const DECAY_PER_SEC = 12;

    const pixels = [...document.querySelectorAll(".led-grid .px")];
    const defaults = pixels.map((el) => (el.classList.contains("on") ? 1 : 0));

    const now = new Date();
    const seed = now.getTime() ^ ((now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()) >>> 0);
    const rng = makeRng(seed);
    const thresholds = pixels.map(() => rng() * 100);
    const chaosValues = pixels.map(() => (rng() < 0.5 ? 1 : 0));

    let chaos = 0;
    let applied = -1;
    let holding = false;
    let last = performance.now();
    let raf = 0;

    const applyPixels = (level) => {
      for (let i = 0; i < pixels.length; i += 1) {
        const on = level >= thresholds[i] ? chaosValues[i] : defaults[i];
        pixels[i].classList.toggle("on", on === 1);
      }
    };

    const applyChaos = () => {
      const level = Math.round(Math.min(100, Math.max(0, chaos)));
      if (level === applied) return;
      applied = level;
      applyPixels(level);
    };

    const kick = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (holding) chaos = Math.min(100, chaos + TRICKLE_PER_SEC * dt);
      else if (chaos > 0) chaos = Math.max(0, chaos - DECAY_PER_SEC * dt);
      applyChaos();
      if (chaos > 0 || holding) raf = requestAnimationFrame(frame);
      else raf = 0;
    };

    addChaos = (amount) => {
      chaos = Math.min(100, chaos + amount);
      applyChaos();
      kick();
    };

    getChaos = () => chaos;

    const onDown = (event) => {
      if (event.button != null && event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".comp, .cord-layer, .cord-ring")) return;
      holding = true;
      addChaos(BURST);
    };

    const onUp = () => {
      holding = false;
      kick();
    };

    document.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    applyChaos();
  };

  let addChaos = () => {};
  let getChaos = () => 0;
  initChaos();

  const press = (el) => {
    const down = (event) => {
      if (event.button != null && event.button !== 0) return;
      el.classList.add("pressed");
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };
    const up = () => el.classList.remove("pressed");
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  document.querySelectorAll(".comp.button").forEach(press);

  document.querySelectorAll(".comp.switch").forEach((el) => {
    el.addEventListener("click", () => {
      const on = el.classList.toggle("on");
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
  });

  document.querySelectorAll(".comp.scope").forEach((el) => {
    const wave = el.querySelector(".wave");
    if (!wave) return;

    const x0 = 1;
    const y0 = 1;
    const width = 14;
    const height = 10;
    const mid = y0 + height / 2;
    const amp = 3;
    let phase = 0;
    let holding = false;

    const down = (event) => {
      if (event.button != null && event.button !== 0) return;
      holding = true;
      el.classList.add("holding");
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };
    const up = () => {
      holding = false;
      el.classList.remove("holding");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    const frame = () => {
      phase += holding ? 0.78 : 0.16;
      const points = [];
      for (let i = 0; i <= width; i += 1) {
        const x = x0 + i;
        const y = Math.round(mid + Math.sin(i * 0.28 + phase) * amp);
        points.push(`${x},${y}`);
      }
      wave.setAttribute("d", `M${points.join("L")}`);
      requestAnimationFrame(frame);
    };
    frame();
  });

  const svgNS = "http://www.w3.org/2000/svg";

  const initWhistle = (whistle) => {
    const puffs = ["a", "b", "c", "d", "e"].map((name) =>
      whistle.querySelector(`.puff-${name}`),
    );
    if (puffs.some((el) => !el)) return;

    const SEGMENTS = 12;
    const REST = 46;
    const MAX = 92;
    const BLOW_AT = 60;
    const GRAVITY = 0.5;
    const DAMPING = 0.982;
    const ITERATIONS = 5;

    const svg = document.createElementNS(svgNS, "svg");
    svg.classList.add("cord-layer");
    svg.setAttribute("aria-hidden", "true");

    const trace = document.createElementNS(svgNS, "path");
    trace.setAttribute("fill", "none");
    trace.setAttribute("stroke", "#ffffff");
    trace.setAttribute("stroke-width", "1.5");
    trace.setAttribute("stroke-linecap", "round");
    trace.setAttribute("stroke-linejoin", "round");
    svg.appendChild(trace);

    const ring = document.createElementNS(svgNS, "g");
    ring.classList.add("cord-ring");
    const hit = document.createElementNS(svgNS, "circle");
    hit.setAttribute("r", "12");
    hit.setAttribute("fill", "transparent");
    ring.appendChild(hit);
    const hoop = document.createElementNS(svgNS, "circle");
    hoop.setAttribute("r", "5");
    hoop.setAttribute("fill", "#ffffff");
    hoop.setAttribute("stroke", "#ffffff");
    hoop.setAttribute("stroke-width", "1.25");
    ring.appendChild(hoop);
    svg.appendChild(ring);
    document.body.appendChild(svg);
    whistle.setAttribute("draggable", "false");

    const pinPos = () => {
      const box = whistle.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.bottom - 3 };
    };

    const pin0 = pinPos();
    const points = [];
    for (let i = 0; i < SEGMENTS; i += 1) {
      const t = i / (SEGMENTS - 1);
      points.push({
        x: pin0.x + t * 3,
        y: pin0.y + t * REST,
        px: pin0.x + t * 3,
        py: pin0.y + t * REST,
      });
    }

    let dragging = false;
    let pointer = { x: pin0.x + 3, y: pin0.y + REST };
    let moved = 0;
    let grabbedBody = false;
    let steam = 0;
    let phase = 0;
    let raf = 0;
    let audio = null;
    let lastTick = performance.now();

    const last = () => points[points.length - 1];
    const isFollowing = () => dragging && (!grabbedBody || moved > 4);

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const clampReach = (x, y, origin, max) => {
      const dx = x - origin.x;
      const dy = y - origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= max || dist === 0) return { x, y };
      return { x: origin.x + (dx / dist) * max, y: origin.y + (dy / dist) * max };
    };

    const ensureAudio = () => {
      if (audio) return audio;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      const tones = [392, 523.25].map((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.value = 0.22;
        osc.connect(gain);
        gain.connect(master);
        osc.start();
        return osc;
      });
      audio = { ctx, master, tones };
      return audio;
    };

    const setHorn = (on) => {
      const horn = ensureAudio();
      if (!horn) return;
      if (horn.ctx.state === "suspended") horn.ctx.resume();
      const now = horn.ctx.currentTime;
      horn.master.gain.cancelScheduledValues(now);
      horn.master.gain.setTargetAtTime(on ? 0.12 : 0, now, on ? 0.04 : 0.12);
    };

    const drawPuff = (el, x0, y0, localPhase, length, drift) => {
      const parts = [];
      for (let i = 0; i <= 9; i += 1) {
        const t = i / 9;
        const x = x0 + t * length;
        const y = y0 - t * length * 0.32 + Math.sin(localPhase + t * 3.4) * (0.7 + t * 1.6) + drift * t;
        parts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      el.setAttribute("d", `M${parts.join("L")}`);
    };

    const startDrag = (event, fromBody) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      grabbedBody = fromBody;
      moved = 0;
      svg.classList.add("dragging");
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      try {
        (fromBody ? whistle : ring).setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      kick();
    };

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      svg.classList.remove("dragging");
      kick();
    };

    whistle.addEventListener("pointerdown", (event) => startDrag(event, true));
    whistle.addEventListener("pointerup", endDrag);
    whistle.addEventListener("pointercancel", endDrag);
    ring.addEventListener("pointerdown", (event) => startDrag(event, false));
    ring.addEventListener("pointerup", endDrag);
    ring.addEventListener("pointercancel", endDrag);
    window.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const prevX = pointer.x;
      const prevY = pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      moved += Math.hypot(pointer.x - prevX, pointer.y - prevY);
    });

    const frame = (now) => {
      raf = 0;
      const t = now == null ? performance.now() : now;
      const dt = Math.min(0.05, (t - lastTick) / 1000);
      lastTick = t;
      const pin = pinPos();
      const n = points.length;
      const following = isFollowing();
      const reach = following
        ? Math.hypot(pointer.x - pin.x, pointer.y - pin.y)
        : Math.hypot(last().x - pin.x, last().y - pin.y);

      if (following) {
        const held = clampReach(pointer.x, pointer.y, pin, MAX);
        pointer.x = held.x;
        pointer.y = held.y;
      }

      const taut = following && reach > BLOW_AT;
      steam += ((taut ? 1 : 0) - steam) * (taut ? 0.28 : 0.08);
      if (steam < 0.02) steam = 0;
      whistle.classList.toggle("blowing", steam > 0.12);
      setHorn(steam > 0.18);
      if (steam > 0.12) addChaos(20 * dt);

      let energy = 0;
      for (let i = 1; i < n; i += 1) {
        const p = points[i];
        if (following && i === n - 1) {
          p.px = p.x;
          p.py = p.y;
          p.x = pointer.x;
          p.y = pointer.y;
          continue;
        }
        const vx = (p.x - p.px) * DAMPING;
        const vy = (p.y - p.py) * DAMPING;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY;
        energy += vx * vx + vy * vy;
      }

      const rest = REST / (n - 1);
      for (let iter = 0; iter < ITERATIONS; iter += 1) {
        points[0].x = pin.x;
        points[0].y = pin.y;
        if (following) {
          points[n - 1].x = pointer.x;
          points[n - 1].y = pointer.y;
        }
        for (let i = 0; i < n - 1; i += 1) {
          const a = points[i];
          const b = points[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const shift = (dist - rest) / dist;
          const aPinned = i === 0;
          const bPinned = following && i + 1 === n - 1;
          if (aPinned && !bPinned) {
            b.x -= dx * shift;
            b.y -= dy * shift;
          } else if (bPinned && !aPinned) {
            a.x += dx * shift;
            a.y += dy * shift;
          } else if (!aPinned && !bPinned) {
            a.x += dx * shift * 0.5;
            a.y += dy * shift * 0.5;
            b.x -= dx * shift * 0.5;
            b.y -= dy * shift * 0.5;
          }
        }
      }

      if (following) {
        const extra = Math.max(0, reach - REST);
        const stretch = extra / (n - 1);
        if (stretch > 0.01) {
          for (let i = 0; i < n - 1; i += 1) {
            const a = points[i];
            const b = points[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 0.0001;
            const want = rest + stretch;
            const shift = (dist - want) / dist;
            if (i === 0) {
              b.x -= dx * shift;
              b.y -= dy * shift;
            } else if (i + 1 === n - 1) {
              a.x += dx * shift;
              a.y += dy * shift;
            } else {
              a.x += dx * shift * 0.5;
              a.y += dy * shift * 0.5;
              b.x -= dx * shift * 0.5;
              b.y -= dy * shift * 0.5;
            }
          }
          points[0].x = pin.x;
          points[0].y = pin.y;
          points[n - 1].x = pointer.x;
          points[n - 1].y = pointer.y;
        }
      }

      const tip = last();
      if (!following) {
        tip.x = Math.min(window.innerWidth - 6, Math.max(6, tip.x));
        tip.y = Math.min(window.innerHeight - 10, Math.max(6, tip.y));
      }

      const parts = [];
      for (let i = 0; i < n; i += 1) {
        parts.push(`${Math.round(points[i].x)},${Math.round(points[i].y)}`);
      }
      trace.setAttribute("d", `M${parts.join("L")}`);
      ring.setAttribute("transform", `translate(${Math.round(tip.x)} ${Math.round(tip.y)})`);

      if (steam > 0) {
        phase += 0.22 + steam * 0.28;
        const reach = 7 + steam * 6;
        drawPuff(puffs[0], 11.2, 12.2, phase, reach, -0.4);
        drawPuff(puffs[1], 11.2, 11.6, phase + 1.1, reach * 0.88, -1.8);
        drawPuff(puffs[2], 11.2, 12.8, phase + 2.2, reach * 0.88, 1.2);
        drawPuff(puffs[3], 11.2, 11.1, phase + 0.6, reach * 0.7, -2.6);
        drawPuff(puffs[4], 11.2, 13.3, phase + 1.7, reach * 0.7, 2.2);
      } else {
        puffs.forEach((el) => el.removeAttribute("d"));
      }

      const moving = dragging || steam > 0 || energy > 0.035;
      if (moving) kick();
    };

    window.addEventListener("resize", kick);
    window.addEventListener("scroll", kick, true);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(kick);
    }
    frame();
  };

  document.querySelectorAll(".comp.whistle").forEach(initWhistle);

  const initMixer = (board) => {
    const svg = board.querySelector("svg");
    if (!svg) return;

    const TRACK_TOP = 6.4;
    const CAP_H = 2.4;
    const TRACK_BOTTOM = 29.2 - CAP_H;

    const toSvg = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      return point.matrixTransform(ctm.inverse());
    };

    board.querySelectorAll(".fader").forEach((fader, index) => {
      const cap = fader.querySelector(".cap");
      if (!cap) return;
      const starts = [0.45, 0.74, 0.5, 0.8];
      let value = starts[index] ?? 0.5;

      const apply = () => {
        const y = TRACK_BOTTOM - value * (TRACK_BOTTOM - TRACK_TOP);
        cap.setAttribute("y", y.toFixed(2));
        fader.setAttribute("aria-valuenow", String(Math.round(value * 100)));
      };

      fader.setAttribute("role", "slider");
      fader.setAttribute("aria-valuemin", "0");
      fader.setAttribute("aria-valuemax", "100");
      fader.setAttribute("aria-label", `Channel ${index + 1}`);
      apply();

      const setFromEvent = (event) => {
        const { y } = toSvg(event);
        const capY = y - CAP_H / 2;
        const t = (TRACK_BOTTOM - capY) / (TRACK_BOTTOM - TRACK_TOP);
        value = Math.min(1, Math.max(0, t));
        apply();
      };

      const down = (event) => {
        if (event.button != null && event.button !== 0) return;
        event.preventDefault();
        setFromEvent(event);
        try {
          board.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        const move = (moveEvent) => setFromEvent(moveEvent);
        const up = () => {
          board.removeEventListener("pointermove", move);
          board.removeEventListener("pointerup", up);
          board.removeEventListener("pointercancel", up);
        };
        board.addEventListener("pointermove", move);
        board.addEventListener("pointerup", up);
        board.addEventListener("pointercancel", up);
      };

      fader.addEventListener("pointerdown", down);
    });
  };

  document.querySelectorAll(".comp.mixer").forEach(initMixer);

  const initRgb = (board) => {
    const svg = board.querySelector("svg");
    if (!svg) return;

    const TRACK_LEFT = 12.2;
    const CAP_W = 5.2;
    const TRACK_RIGHT = 74.4 - CAP_W;
    const values = [6 / 255, 36 / 255, 6 / 255];

    const toSvg = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      return point.matrixTransform(ctm.inverse());
    };

    const paintBg = () => {
      const r = Math.round(values[0] * 255);
      const g = Math.round(values[1] * 255);
      const b = Math.round(values[2] * 255);
      document.documentElement.style.setProperty("--bg", `rgb(${r}, ${g}, ${b})`);
    };

    board.querySelectorAll(".fader").forEach((fader, index) => {
      const cap = fader.querySelector(".cap");
      if (!cap) return;
      const names = ["Red", "Green", "Blue"];

      const apply = () => {
        const x = TRACK_LEFT + values[index] * (TRACK_RIGHT - TRACK_LEFT);
        cap.setAttribute("x", x.toFixed(2));
        fader.setAttribute("aria-valuenow", String(Math.round(values[index] * 255)));
        paintBg();
      };

      fader.setAttribute("role", "slider");
      fader.setAttribute("aria-valuemin", "0");
      fader.setAttribute("aria-valuemax", "255");
      fader.setAttribute("aria-label", names[index] || "Channel");
      apply();

      const setFromEvent = (event) => {
        const { x } = toSvg(event);
        const capX = x - CAP_W / 2;
        const t = (capX - TRACK_LEFT) / (TRACK_RIGHT - TRACK_LEFT);
        values[index] = Math.min(1, Math.max(0, t));
        apply();
      };

      const down = (event) => {
        if (event.button != null && event.button !== 0) return;
        event.preventDefault();
        setFromEvent(event);
        try {
          board.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        const move = (moveEvent) => setFromEvent(moveEvent);
        const up = () => {
          board.removeEventListener("pointermove", move);
          board.removeEventListener("pointerup", up);
          board.removeEventListener("pointercancel", up);
        };
        board.addEventListener("pointermove", move);
        board.addEventListener("pointerup", up);
        board.addEventListener("pointercancel", up);
      };

      fader.addEventListener("pointerdown", down);
    });
  };

  document.querySelectorAll(".comp.rgb").forEach(initRgb);

  const initGalton = (board) => {
    const svg = board.querySelector("svg");
    const ballEl = board.querySelector(".ball");
    const binEls = [...board.querySelectorAll(".bin")];
    const pegEls = [...board.querySelectorAll(".peg")];
    if (!svg || !ballEl || !binEls.length) return;

    const R = 1.45;
    const PEG_R = 0.7;
    const LEFT = 2.2;
    const RIGHT = 37.8;
    const TOP = 2.2;
    const BOTTOM = 52.15;
    const BIN_Y = 42.6;
    const G = 0.14;
    const DAMP = 0.991;
    const WALL = 0.28;
    const PEG_BOUNCE = 0.52;
    const FLOOR = 0.18;

    const pegs = pegEls.map((el) => ({
      x: Number(el.getAttribute("cx")),
      y: Number(el.getAttribute("cy")),
    }));
    const walls = [8.27, 14.13, 20, 25.87, 31.73];

    const toSvg = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 20, y: 4.6 };
      return point.matrixTransform(ctm.inverse());
    };

    const ball = {
      x: Number(ballEl.getAttribute("cx")),
      y: Number(ballEl.getAttribute("cy")),
      vx: 0,
      vy: 0,
    };

    let dragging = false;
    let settled = false;
    let raf = 0;

    const place = () => {
      ballEl.setAttribute("cx", ball.x.toFixed(2));
      ballEl.setAttribute("cy", ball.y.toFixed(2));
    };

    const confine = (bounce) => {
      const minX = LEFT + R;
      const maxX = RIGHT - R;
      const minY = TOP + R;
      const maxY = BOTTOM - R;
      if (ball.x < minX) {
        ball.x = minX;
        if (bounce) ball.vx = Math.abs(ball.vx) * WALL;
      } else if (ball.x > maxX) {
        ball.x = maxX;
        if (bounce) ball.vx = -Math.abs(ball.vx) * WALL;
      }
      if (ball.y < minY) {
        ball.y = minY;
        if (bounce) ball.vy = Math.abs(ball.vy) * WALL;
      } else if (ball.y > maxY) {
        ball.y = maxY;
        if (bounce) {
          ball.vy = -Math.abs(ball.vy) * FLOOR;
          ball.vx *= 0.82;
        }
      }
    };

    const lightBin = () => {
      const width = (RIGHT - LEFT) / binEls.length;
      const index = Math.min(
        binEls.length - 1,
        Math.max(0, Math.floor((ball.x - LEFT) / width)),
      );
      binEls.forEach((el, i) => el.classList.toggle("lit", i === index));
    };

    const clearBins = () => {
      binEls.forEach((el) => el.classList.remove("lit"));
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const collidePegs = () => {
      for (const peg of pegs) {
        const dx = ball.x - peg.x;
        const dy = ball.y - peg.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const min = R + PEG_R;
        if (dist >= min) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = min - dist;
        ball.x += nx * overlap;
        ball.y += ny * overlap;
        const along = ball.vx * nx + ball.vy * ny;
        if (along < 0) {
          ball.vx -= (1 + PEG_BOUNCE) * along * nx;
          ball.vy -= (1 + PEG_BOUNCE) * along * ny;
          ball.vx += (Math.random() - 0.5) * 0.22;
        }
      }
    };

    const collideBins = () => {
      if (ball.y + R < BIN_Y) return;
      for (const x of walls) {
        const dx = ball.x - x;
        if (Math.abs(dx) >= R) continue;
        if (dx < 0) {
          ball.x = x - R;
          ball.vx = -Math.abs(ball.vx) * WALL;
        } else {
          ball.x = x + R;
          ball.vx = Math.abs(ball.vx) * WALL;
        }
      }
    };

    const frame = () => {
      raf = 0;
      if (dragging) return;

      ball.vy += G;
      ball.vx *= DAMP;
      ball.vy *= DAMP;
      ball.x += ball.vx;
      ball.y += ball.vy;
      collidePegs();
      collideBins();
      confine(true);
      place();

      const speed = Math.hypot(ball.vx, ball.vy);
      const inBins = ball.y + R >= BIN_Y + 1.2;
      if (inBins && speed < 0.055) {
        ball.vx = 0;
        ball.vy = 0;
        if (!settled) {
          settled = true;
          lightBin();
        }
        return;
      }

      settled = false;
      kick();
    };

    const down = (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      const grab = toSvg(event);
      if (Math.hypot(grab.x - ball.x, grab.y - ball.y) > R + 3.2) return;
      dragging = true;
      settled = false;
      clearBins();
      board.classList.add("dragging");
      const point = grab;
      ball.x = point.x;
      ball.y = point.y;
      ball.vx = 0;
      ball.vy = 0;
      confine(false);
      place();
      try {
        board.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    const move = (event) => {
      if (!dragging) return;
      const point = toSvg(event);
      ball.x = point.x;
      ball.y = point.y;
      confine(false);
      place();
    };

    const up = () => {
      if (!dragging) return;
      dragging = false;
      board.classList.remove("dragging");
      ball.vx = 0;
      ball.vy = 0.18;
      kick();
    };

    board.addEventListener("pointerdown", down);
    board.addEventListener("pointermove", move);
    board.addEventListener("pointerup", up);
    board.addEventListener("pointercancel", up);

    kick();
  };

  document.querySelectorAll(".comp.galton").forEach(initGalton);

  const initKeyboard = (board) => {
    const keys = [...board.querySelectorAll(".key")];
    if (!keys.length) return;

    let ctx = null;
    const voices = new Map();
    let held = null;

    const ensureCtx = () => {
      if (ctx) return ctx;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      return ctx;
    };

    const freqFor = (midi) => 440 * 2 ** ((midi - 69) / 12);

    const noteOn = (midi) => {
      if (voices.has(midi)) return;
      const audio = ensureCtx();
      if (!audio) return;
      if (audio.state === "suspended") audio.resume();
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const osc2 = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "triangle";
      osc2.type = "sine";
      osc.frequency.value = freqFor(midi);
      osc2.frequency.value = freqFor(midi) * 2;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.015);
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(audio.destination);
      osc.start(now);
      osc2.start(now);
      voices.set(midi, { osc, osc2, gain });
    };

    const noteOff = (midi) => {
      const voice = voices.get(midi);
      if (!voice || !ctx) return;
      const now = ctx.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.045);
      voice.osc.stop(now + 0.18);
      voice.osc2.stop(now + 0.18);
      voices.delete(midi);
    };

    const keyFromEvent = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || typeof el.closest !== "function") return null;
      return el.closest(".key");
    };

    const pressKey = (key) => {
      if (!key) return;
      const midi = Number(key.getAttribute("data-midi"));
      if (held && held !== midi) {
        const prev = board.querySelector(`.key[data-midi="${held}"]`);
        if (prev) prev.classList.remove("down");
        noteOff(held);
      }
      if (held === midi) return;
      held = midi;
      key.classList.add("down");
      noteOn(midi);
    };

    const release = () => {
      if (held == null) return;
      const key = board.querySelector(`.key[data-midi="${held}"]`);
      if (key) key.classList.remove("down");
      noteOff(held);
      held = null;
    };

    board.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      pressKey(keyFromEvent(event));
      try {
        board.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });
    board.addEventListener("pointermove", (event) => {
      if (held == null) return;
      const key = keyFromEvent(event);
      if (key) pressKey(key);
    });
    board.addEventListener("pointerup", release);
    board.addEventListener("pointercancel", release);
  };

  document.querySelectorAll(".comp.keyboard").forEach(initKeyboard);

  const initPlasma = (ball) => {
    const svg = ball.querySelector("svg");
    const bolts = [...ball.querySelectorAll(".bolt:not(.main)")];
    const main = ball.querySelector(".bolt.main");
    const glass = ball.querySelector(".glass");
    if (!svg || !main || !glass || bolts.length < 4) return;

    const CX = 14;
    const CY = 13.5;
    const R = 11.05;
    const VIEW_W = 28;
    const VIEW_H = 38;

    const filaments = bolts.map((_, i) => ({
      angle: (i / bolts.length) * Math.PI * 2,
      spin: (0.012 + (i % 3) * 0.006) * (i % 2 === 0 ? 1 : -1),
      reach: 0.32 + (i % 4) * 0.05,
    }));

    let touching = false;
    let finger = { x: CX, y: CY - 6 };

    const toLocal = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: CX, y: CY };
      return {
        x: ((clientX - rect.left) / rect.width) * VIEW_W,
        y: ((clientY - rect.top) / rect.height) * VIEW_H,
      };
    };

    const inside = (x, y) => Math.hypot(x - CX, y - CY) <= R + 0.35;

    const clampIn = (x, y, pad = 0.35) => {
      const dx = x - CX;
      const dy = y - CY;
      const dist = Math.hypot(dx, dy);
      const max = R - pad;
      if (dist <= max || dist === 0) return { x, y };
      return { x: CX + (dx / dist) * max, y: CY + (dy / dist) * max };
    };

    const subdivide = (a, b, displace, depth) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (depth <= 0 || dist < 1.1) return [a, b];
      const nx = -dy / (dist || 1);
      const ny = dx / (dist || 1);
      const offset = (Math.random() < 0.35 ? 0.35 : 1) * (Math.random() * 2 - 1) * displace;
      const mid = clampIn((a.x + b.x) * 0.5 + nx * offset, (a.y + b.y) * 0.5 + ny * offset);
      const next = displace * 0.55;
      const left = subdivide(a, mid, next, depth - 1);
      const right = subdivide(mid, b, next, depth - 1);
      return left.slice(0, -1).concat(right);
    };

    const asPath = (pts) =>
      pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("L");

    const drawBolt = (path, angle, reach, jagged, forks) => {
      const dest = clampIn(
        CX + Math.cos(angle) * R * reach,
        CY + Math.sin(angle) * R * reach,
        0.2,
      );
      const start = { x: CX, y: CY };
      const depth = jagged > 1.6 ? 4 : 3;
      const trunk = subdivide(start, dest, jagged, depth);
      let d = `M${asPath(trunk)}`;
      for (let f = 0; f < forks; f += 1) {
        if (trunk.length < 5) break;
        const idx = 2 + Math.floor(Math.random() * (trunk.length - 4));
        const origin = trunk[idx];
        const t = idx / (trunk.length - 1);
        const forkReach = (1 - t) * reach * (0.28 + Math.random() * 0.4);
        const side = f % 2 === 0 ? -1 : 1;
        const forkAngle = angle + side * (0.7 + Math.random() * 1.05);
        const forkDest = clampIn(
          origin.x + Math.cos(forkAngle) * R * forkReach,
          origin.y + Math.sin(forkAngle) * R * forkReach,
        );
        d += `M${asPath(subdivide(origin, forkDest, jagged * 0.65, 3))}`;
      }
      path.setAttribute("d", d);
    };

    const point = (event) => {
      const local = toLocal(event.clientX, event.clientY);
      if (!inside(local.x, local.y)) return false;
      finger = local;
      return true;
    };

    const down = (event) => {
      if (event.button != null && event.button !== 0) return;
      if (!point(event)) return;
      event.preventDefault();
      touching = true;
      ball.classList.add("touching");
      try {
        ball.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    const move = (event) => {
      if (!touching) return;
      if (!point(event)) {
        touching = false;
        ball.classList.remove("touching");
      }
    };

    const up = () => {
      touching = false;
      ball.classList.remove("touching");
    };

    ball.addEventListener("pointerdown", down);
    ball.addEventListener("pointermove", move);
    ball.addEventListener("pointerup", up);
    ball.addEventListener("pointercancel", up);

    const frame = () => {
      let attract = null;
      let reachTo = 0;
      if (touching) {
        const dx = finger.x - CX;
        const dy = finger.y - CY;
        const dist = Math.hypot(dx, dy);
        attract = Math.atan2(dy, dx);
        reachTo = Math.min(0.96, Math.max(0.42, dist / R));
        drawBolt(main, attract, reachTo, 3.1, 3);
      } else {
        main.setAttribute("d", "");
      }

      filaments.forEach((f, i) => {
        f.angle += f.spin;
        const idle = attract == null;
        if (idle && (i >= 6 || Math.random() < 0.14)) {
          bolts[i].setAttribute("d", "");
          return;
        }
        if (!idle && Math.random() < 0.04) {
          bolts[i].setAttribute("d", "");
          return;
        }
        let angle = f.angle;
        let reach = f.reach * (0.88 + Math.random() * 0.22);
        let jagged = 1.35;
        let forks = Math.random() < 0.22 ? 2 : Math.random() < 0.7 ? 1 : 0;
        if (!idle) {
          let diff = attract - angle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const face = Math.max(0, Math.cos(diff));
          angle += diff * (0.18 + 0.5 * face);
          reach = f.reach + (reachTo - f.reach) * (0.45 + 0.55 * face);
          jagged = 2.7;
          forks = 2 + (Math.random() < 0.55 ? 1 : 0);
        }
        drawBolt(bolts[i], angle, reach, jagged, forks);
      });
      requestAnimationFrame(frame);
    };
    frame();
  };

  document.querySelectorAll(".comp.plasma").forEach(initPlasma);

  const initTank = (tank) => {
    const fish = tank.querySelector(".fish");
    if (!fish) return;

    const MIN_X = 8.4;
    const MAX_X = 31.6;
    const MIN_Y = 9.2;
    const MAX_Y = 20.6;
    let x = 20;
    let y = 14;
    let vx = 0.085;
    let vy = 0.012;
    let phase = 0;
    let retarget = 90;

    const frame = () => {
      phase += 0.08;
      retarget -= 1;
      if (retarget <= 0) {
        vx += (Math.random() - 0.5) * 0.04;
        vy += (Math.random() - 0.5) * 0.03;
        const speed = Math.hypot(vx, vy);
        if (speed < 0.05) {
          vx += 0.04;
        }
        if (speed > 0.16) {
          vx *= 0.7;
          vy *= 0.7;
        }
        retarget = 70 + Math.floor(Math.random() * 90);
      }
      x += vx;
      y += vy + Math.sin(phase) * 0.012;
      if (x < MIN_X) {
        x = MIN_X;
        vx = Math.abs(vx);
      } else if (x > MAX_X) {
        x = MAX_X;
        vx = -Math.abs(vx);
      }
      if (y < MIN_Y) {
        y = MIN_Y;
        vy = Math.abs(vy);
      } else if (y > MAX_Y) {
        y = MAX_Y;
        vy = -Math.abs(vy);
      }
      const flip = vx < 0 ? -1 : 1;
      fish.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${flip} 1)`);
      requestAnimationFrame(frame);
    };
    frame();

    tank.addEventListener("click", () => {
      window.alert("Please don't tap the glass");
    });
  };

  document.querySelectorAll(".comp.tank").forEach(initTank);

  const initDial = (dial) => {
    const needle = dial.querySelector(".needle");
    if (!needle) return;
    const cx = Number(needle.getAttribute("data-cx") || 12);
    const cy = Number(needle.getAttribute("data-cy") || 12);
    const start = Number(needle.getAttribute("data-start") || 135);
    const sweep = Number(needle.getAttribute("data-sweep") || 270);
    const rest = Number(needle.getAttribute("data-rest") || 0.38);
    const rate = Number(needle.getAttribute("data-rate") || 0.012);
    const wander = rest < 0.3 ? 0.05 : rest > 0.45 ? 0.12 : 0.07;
    const jitter = rest < 0.3 ? 0.015 : rest > 0.45 ? 0.04 : 0.025;
    const idle = Math.min(0.08, rest * 0.18);
    let t = hash01(dial.getAttribute("data-cid") || "dial") * 40;
    let shown = idle;
    const frame = () => {
      const c = Math.min(1, Math.max(0, getChaos() / 100));
      const drive = c * c;
      t += rate * (0.25 + drive * 7);
      const target = idle + (0.94 - idle) * drive;
      const wiggle =
        Math.sin(t) * wander * (0.08 + drive * 2.4) +
        Math.sin(t * 2.4) * jitter * drive * 5 +
        Math.sin(t * 13) * 0.09 * drive * drive;
      const goal = Math.min(1, Math.max(0, target + wiggle));
      shown += (goal - shown) * (0.045 + drive * 0.22);
      const angle = start + shown * sweep;
      needle.setAttribute("transform", `rotate(${angle.toFixed(2)} ${cx} ${cy})`);
      requestAnimationFrame(frame);
    };
    frame();
  };

  document.querySelectorAll(".comp.dial").forEach(initDial);

  const initHanoi = (board) => {
    const svg = board.querySelector("svg");
    const disks = [0, 1, 2].map((size) => board.querySelector(`.disk[data-size="${size}"]`));
    const lamp = board.querySelector(".lamp");
    if (!svg || disks.some((el) => !el) || !lamp) return;

    const PEGS = [8.5, 24, 39.5];
    const BASE = 28.4;
    const DISK_H = 2.3;
    const WIDTHS = [7.2, 10, 12.8];
    const stacks = [[2, 1, 0], [], []];

    const toSvg = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: PEGS[0], y: BASE };
      return point.matrixTransform(ctm.inverse());
    };

    const placeDisk = (size, peg, height, x, y) => {
      const w = WIDTHS[size];
      const el = disks[size];
      const left = (x ?? PEGS[peg]) - w / 2;
      const top = (y ?? BASE - DISK_H * (height + 1));
      el.setAttribute("x", left.toFixed(2));
      el.setAttribute("y", top.toFixed(2));
      el.setAttribute("width", String(w));
    };

    const layout = () => {
      stacks.forEach((stack, peg) => {
        stack.forEach((size, height) => placeDisk(size, peg, height));
      });
    };

    const pegOf = (size) => stacks.findIndex((stack) => stack.includes(size));

    const isTop = (size) => {
      const peg = pegOf(size);
      if (peg < 0) return false;
      const stack = stacks[peg];
      return stack[stack.length - 1] === size;
    };

    const nearestPeg = (x) => {
      let best = 0;
      let dist = Infinity;
      PEGS.forEach((px, i) => {
        const d = Math.abs(x - px);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      return best;
    };

    const canMove = (size, to) => {
      const stack = stacks[to];
      if (!stack.length) return true;
      return stack[stack.length - 1] > size;
    };

    const solved = () => {
      const right = stacks[2];
      return right.length === 3 && right[0] === 2 && right[1] === 1 && right[2] === 0;
    };

    const updateLamp = () => {
      board.classList.toggle("solved", solved());
    };

    let held = null;
    let fromPeg = -1;

    const down = (event) => {
      if (event.button != null && event.button !== 0) return;
      const size = Number(event.currentTarget.getAttribute("data-size"));
      if (!isTop(size)) return;
      event.preventDefault();
      held = size;
      fromPeg = pegOf(size);
      stacks[fromPeg].pop();
      board.classList.add("dragging");
      const local = toSvg(event);
      placeDisk(size, fromPeg, stacks[fromPeg].length, local.x, local.y - DISK_H / 2);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    const move = (event) => {
      if (held == null) return;
      const local = toSvg(event);
      placeDisk(held, fromPeg, 0, local.x, local.y - DISK_H / 2);
    };

    const up = (event) => {
      if (held == null) return;
      const local = toSvg(event);
      const to = nearestPeg(local.x);
      if (canMove(held, to)) {
        stacks[to].push(held);
      } else {
        stacks[fromPeg].push(held);
      }
      held = null;
      fromPeg = -1;
      board.classList.remove("dragging");
      layout();
      updateLamp();
    };

    disks.forEach((el) => {
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });

    layout();
    updateLamp();
  };

  document.querySelectorAll(".comp.hanoi").forEach(initHanoi);

  const initSeismo = (box) => {
    const trace = box.querySelector(".trace");
    if (!trace) return;

    const X0 = 3.7;
    const X1 = 22.3;
    const MID = 9.4;
    const TOP = 5.6;
    const BOTTOM = 13.2;
    const COUNT = 46;
    const samples = Array.from({ length: COUNT }, () => MID);
    let quake = 0;
    let shake = 0;

    const down = (event) => {
      if (event.button != null && event.button !== 0) return;
      quake = 1;
      box.classList.remove("shaking");
      void box.offsetWidth;
      box.classList.add("shaking");
      window.clearTimeout(shake);
      shake = window.setTimeout(() => box.classList.remove("shaking"), 700);
    };

    box.addEventListener("pointerdown", down);

    const frame = () => {
      quake *= 0.935;
      if (quake < 0.02) quake = 0;
      const jitter = (Math.random() * 2 - 1) * (0.12 + quake * 3.6);
      const spike = Math.sin(performance.now() / 18) * quake * 1.8;
      const y = Math.min(BOTTOM, Math.max(TOP, MID + jitter + spike));
      samples.push(y);
      samples.shift();
      const step = (X1 - X0) / (COUNT - 1);
      const parts = samples.map((sample, i) => `${(X0 + i * step).toFixed(2)},${sample.toFixed(2)}`);
      trace.setAttribute("d", `M${parts.join("L")}`);
      requestAnimationFrame(frame);
    };
    frame();
  };

  document.querySelectorAll(".comp.seismo").forEach(initSeismo);

  const initSimon = (box) => {
    const pads = [0, 1, 2, 3].map((i) => box.querySelector(`.pad[data-pad="${i}"]`));
    const play = box.querySelector(".play");
    const hiEl = box.querySelector(".hi");
    if (pads.some((el) => !el) || !play || !hiEl) return;

    const TONES = [220, 277, 330, 392];
    let hi = 0;

    const format = (n) => String(Math.min(99, Math.max(0, n))).padStart(2, "0");
    hiEl.textContent = format(hi);

    let ctx = null;
    let sequence = [];
    let step = 0;
    let listening = false;
    let busy = false;

    const ensureCtx = () => {
      if (ctx) return ctx;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      return ctx;
    };

    const beep = (index, ms) => {
      const audio = ensureCtx();
      if (!audio) return;
      if (audio.state === "suspended") audio.resume();
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "square";
      osc.frequency.value = TONES[index];
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
      gain.gain.setTargetAtTime(0, now + ms / 1000 - 0.04, 0.03);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now);
      osc.stop(now + ms / 1000);
    };

    const light = (index, on) => {
      pads[index].classList.toggle("on", on);
    };

    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const flash = async (index, ms) => {
      light(index, true);
      beep(index, ms);
      await wait(ms);
      light(index, false);
    };

    const saveHi = (score) => {
      if (score <= hi) return;
      hi = score;
      hiEl.textContent = format(hi);
    };

    const playback = async (pause = 1000) => {
      listening = false;
      busy = true;
      const tempo = Math.max(220, 480 - sequence.length * 28);
      if (pause) await wait(pause);
      for (let i = 0; i < sequence.length; i += 1) {
        await flash(sequence[i], tempo);
        await wait(90);
      }
      step = 0;
      listening = true;
      busy = false;
    };

    const fail = async () => {
      listening = false;
      busy = true;
      for (let i = 0; i < 2; i += 1) {
        pads.forEach((el) => el.classList.add("on"));
        await wait(140);
        pads.forEach((el) => el.classList.remove("on"));
        await wait(110);
      }
      sequence = [];
      busy = false;
    };

    const start = () => {
      if (busy) return;
      sequence = [Math.floor(Math.random() * 4)];
      playback(0);
    };

    play.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      play.classList.add("on");
      start();
    });
    play.addEventListener("pointerup", () => play.classList.remove("on"));
    play.addEventListener("pointercancel", () => play.classList.remove("on"));

    pads.forEach((el, index) => {
      el.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        if (!listening || busy) return;
        event.preventDefault();
        const expected = sequence[step];
        flash(index, 220);
        if (index !== expected) {
          fail();
          return;
        }
        step += 1;
        if (step >= sequence.length) {
          saveHi(sequence.length);
          listening = false;
          sequence.push(Math.floor(Math.random() * 4));
          playback();
        }
      });
    });
  };

  document.querySelectorAll(".comp.simon").forEach(initSimon);

  const initAlarm = (box) => {
    const svg = box.querySelector("svg");
    const pane = box.querySelector(".pane");
    const lever = box.querySelector(".lever");
    const hook = box.querySelector(".hook");
    const rotor = box.querySelector(".rotor");
    if (!svg || !pane || !lever || !hook || !rotor) return;

    const SEGMENTS = 10;
    const LENGTH = 38;
    const GRAVITY = 0.48;
    const DAMPING = 0.982;
    const ITERATIONS = 5;

    const layer = document.createElementNS(svgNS, "svg");
    layer.classList.add("cord-layer");
    layer.setAttribute("aria-hidden", "true");

    const rope = document.createElementNS(svgNS, "path");
    rope.setAttribute("fill", "none");
    rope.setAttribute("stroke", "#ffffff");
    rope.setAttribute("stroke-width", "1.4");
    rope.setAttribute("stroke-linecap", "round");
    rope.setAttribute("stroke-linejoin", "round");
    layer.appendChild(rope);

    const hammer = document.createElementNS(svgNS, "g");
    hammer.classList.add("cord-hammer");
    const hit = document.createElementNS(svgNS, "circle");
    hit.setAttribute("r", "16");
    hit.setAttribute("fill", "transparent");
    hammer.appendChild(hit);
    const handle = document.createElementNS(svgNS, "rect");
    handle.setAttribute("x", "-1.2");
    handle.setAttribute("y", "-4");
    handle.setAttribute("width", "2.4");
    handle.setAttribute("height", "18");
    handle.setAttribute("fill", "transparent");
    handle.setAttribute("stroke", "#ffffff");
    handle.setAttribute("stroke-width", "1.1");
    hammer.appendChild(handle);
    const head = document.createElementNS(svgNS, "rect");
    head.classList.add("head");
    head.setAttribute("x", "-8");
    head.setAttribute("y", "-8");
    head.setAttribute("width", "16");
    head.setAttribute("height", "7");
    head.setAttribute("fill", "transparent");
    head.setAttribute("stroke", "#ffffff");
    head.setAttribute("stroke-width", "1.15");
    hammer.appendChild(head);
    const peen = document.createElementNS(svgNS, "rect");
    peen.setAttribute("x", "5");
    peen.setAttribute("y", "-6.2");
    peen.setAttribute("width", "5");
    peen.setAttribute("height", "3.4");
    peen.setAttribute("fill", "transparent");
    peen.setAttribute("stroke", "#ffffff");
    peen.setAttribute("stroke-width", "1");
    hammer.appendChild(peen);
    layer.appendChild(hammer);

    const shardGroup = document.createElementNS(svgNS, "g");
    shardGroup.setAttribute("pointer-events", "none");
    layer.appendChild(shardGroup);
    document.body.appendChild(layer);
    box.setAttribute("draggable", "false");

    const syncLayer = () => {
      layer.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
      layer.setAttribute("width", String(window.innerWidth));
      layer.setAttribute("height", String(window.innerHeight));
    };
    syncLayer();

    const pinPos = () => {
      const rect = hook.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    const pin0 = pinPos();
    const points = [];
    for (let i = 0; i < SEGMENTS; i += 1) {
      const t = i / (SEGMENTS - 1);
      points.push({
        x: pin0.x + t * 10,
        y: pin0.y + t * LENGTH,
        px: pin0.x + t * 10,
        py: pin0.y + t * LENGTH,
      });
    }

    let dragging = false;
    let pointer = { x: pin0.x + 10, y: pin0.y + LENGTH };
    let moved = 0;
    let broken = false;
    let latched = false;
    let shards = [];
    let raf = 0;

    const last = () => points[points.length - 1];

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const clampReach = (x, y, origin, max) => {
      const dx = x - origin.x;
      const dy = y - origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= max || dist === 0) return { x, y };
      return { x: origin.x + (dx / dist) * max, y: origin.y + (dy / dist) * max };
    };

    const overlaps = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const placeShard = (shard) => {
      shard.el.setAttribute(
        "transform",
        `translate(${shard.x.toFixed(1)} ${shard.y.toFixed(1)}) rotate(${shard.rot.toFixed(1)})`,
      );
    };

    const addShard = (cx, cy, d, vx, vy) => {
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#ffffff");
      path.setAttribute("stroke-width", "1.05");
      path.setAttribute("d", d);
      shardGroup.appendChild(path);
      const shard = {
        el: path,
        x: cx,
        y: cy,
        vx,
        vy,
        rot: (Math.random() - 0.5) * 14,
        vr: (Math.random() - 0.5) * 28,
      };
      placeShard(shard);
      shards.push(shard);
    };

    const shatter = () => {
      if (broken) return;
      const rect = pane.getBoundingClientRect();
      broken = true;
      box.classList.add("broken");
      const cols = 3;
      const rows = 3;
      const cw = rect.width / cols;
      const ch = rect.height / rows;
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const left = rect.left + col * cw;
          const top = rect.top + row * ch;
          const right = left + cw;
          const bottom = top + ch;
          const cx = left + cw / 2;
          const cy = top + ch / 2;
          const jag = (Math.random() - 0.5) * Math.min(cw, ch) * 0.28;
          const mid = { x: cx + jag, y: cy - jag };
          const kickX = (cx - midX) * 0.28 + (Math.random() - 0.5) * 7;
          const kickY = (cy - midY) * 0.18 - 6.5 - Math.random() * 5.5;
          addShard(
            cx,
            cy,
            `M${(left - cx).toFixed(1)},${(top - cy).toFixed(1)} L${(right - cx).toFixed(1)},${(top - cy).toFixed(1)} L${(mid.x - cx).toFixed(1)},${(mid.y - cy).toFixed(1)} Z`,
            kickX,
            kickY,
          );
          addShard(
            cx,
            cy,
            `M${(left - cx).toFixed(1)},${(top - cy).toFixed(1)} L${(mid.x - cx).toFixed(1)},${(mid.y - cy).toFixed(1)} L${(left - cx).toFixed(1)},${(bottom - cy).toFixed(1)} Z`,
            kickX + (Math.random() - 0.5) * 2,
            kickY + Math.random(),
          );
          addShard(
            cx,
            cy,
            `M${(right - cx).toFixed(1)},${(top - cy).toFixed(1)} L${(right - cx).toFixed(1)},${(bottom - cy).toFixed(1)} L${(mid.x - cx).toFixed(1)},${(mid.y - cy).toFixed(1)} Z`,
            kickX + (Math.random() - 0.5) * 2,
            kickY + Math.random(),
          );
        }
      }
    };

    const startDrag = (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      moved = 0;
      layer.classList.add("dragging");
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      try {
        hammer.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      kick();
    };

    const endDrag = () => {
      dragging = false;
      layer.classList.remove("dragging");
      kick();
    };

    hammer.addEventListener("pointerdown", startDrag);
    hammer.addEventListener("pointerup", endDrag);
    hammer.addEventListener("pointercancel", endDrag);
    window.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const prevX = pointer.x;
      const prevY = pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      moved += Math.hypot(pointer.x - prevX, pointer.y - prevY);
    });

    const VIEW_W = 32;
    const VIEW_H = 49;
    const PULL_MAX = 11.4;
    const ROTOR_X = 14.9;
    const ROTOR_Y = 5.1;
    let pull = 0;
    let pulling = false;
    let spin = 0;

    const toLocal = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: 14.9, y: 12 };
      return {
        x: ((clientX - rect.left) / rect.width) * VIEW_W,
        y: ((clientY - rect.top) / rect.height) * VIEW_H,
      };
    };

    const setPull = (value) => {
      pull = Math.min(PULL_MAX, Math.max(0, value));
      lever.setAttribute("transform", `translate(0 ${pull.toFixed(2)})`);
    };

    const latch = () => {
      if (latched) return;
      latched = true;
      setPull(PULL_MAX);
      box.classList.add("latched");
      kick();
    };

    lever.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      if (!broken || latched) return;
      event.preventDefault();
      pulling = true;
      const local = toLocal(event.clientX, event.clientY);
      setPull(local.y - 14.4);
      try {
        lever.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });
    lever.addEventListener("pointermove", (event) => {
      if (!pulling || latched) return;
      const local = toLocal(event.clientX, event.clientY);
      setPull(local.y - 14.4);
    });
    const endPull = () => {
      if (!pulling) return;
      pulling = false;
      if (pull > PULL_MAX * 0.62) latch();
      else setPull(0);
    };
    lever.addEventListener("pointerup", endPull);
    lever.addEventListener("pointercancel", endPull);

    const frame = () => {
      raf = 0;
      syncLayer();
      const pin = pinPos();
      const n = points.length;
      if (dragging) {
        const held = clampReach(pointer.x, pointer.y, pin, LENGTH);
        pointer.x = held.x;
        pointer.y = held.y;
      }

      let energy = 0;
      for (let i = 1; i < n; i += 1) {
        const p = points[i];
        if (dragging && i === n - 1) {
          p.px = p.x;
          p.py = p.y;
          p.x = pointer.x;
          p.y = pointer.y;
          continue;
        }
        const vx = (p.x - p.px) * DAMPING;
        const vy = (p.y - p.py) * DAMPING;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY;
        energy += vx * vx + vy * vy;
      }

      const rest = LENGTH / (n - 1);
      for (let iter = 0; iter < ITERATIONS; iter += 1) {
        points[0].x = pin.x;
        points[0].y = pin.y;
        if (dragging) {
          points[n - 1].x = pointer.x;
          points[n - 1].y = pointer.y;
        }
        for (let i = 0; i < n - 1; i += 1) {
          const a = points[i];
          const b = points[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const shift = (dist - rest) / dist;
          const aPinned = i === 0;
          const bPinned = dragging && i + 1 === n - 1;
          if (aPinned && !bPinned) {
            b.x -= dx * shift;
            b.y -= dy * shift;
          } else if (bPinned && !aPinned) {
            a.x += dx * shift;
            a.y += dy * shift;
          } else if (!aPinned && !bPinned) {
            a.x += dx * shift * 0.5;
            a.y += dy * shift * 0.5;
            b.x -= dx * shift * 0.5;
            b.y -= dy * shift * 0.5;
          }
        }
      }

      const tip = last();
      const parts = points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`);
      rope.setAttribute("d", `M${parts.join("L")}`);

      const prev = points[n - 2];
      const angle = (Math.atan2(prev.y - tip.y, prev.x - tip.x) * 180) / Math.PI + 90;
      hammer.setAttribute(
        "transform",
        `translate(${Math.round(tip.x)} ${Math.round(tip.y)}) rotate(${angle.toFixed(1)})`,
      );

      if (!broken && dragging && moved > 10) {
        const headBox = head.getBoundingClientRect();
        const paneBox = pane.getBoundingClientRect();
        if (overlaps(headBox, paneBox)) shatter();
      }

      shards = shards.filter((shard) => {
        shard.vy += 1.15;
        shard.vx *= 0.992;
        shard.x += shard.vx;
        shard.y += shard.vy;
        shard.rot += shard.vr;
        shard.el.setAttribute(
          "transform",
          `translate(${shard.x.toFixed(1)} ${shard.y.toFixed(1)}) rotate(${shard.rot.toFixed(1)})`,
        );
        if (shard.y > window.innerHeight + 40) {
          shard.el.remove();
          return false;
        }
        return true;
      });

      if (latched) {
        spin = (spin + 6.5) % 360;
        rotor.setAttribute("transform", `rotate(${spin.toFixed(1)} ${ROTOR_X} ${ROTOR_Y})`);
      }

      if (dragging || pulling || latched || energy > 0.035 || shards.length) kick();
    };

    window.addEventListener("resize", kick);
    window.addEventListener("scroll", kick, true);
    frame();
  };

  document.querySelectorAll(".comp.alarm").forEach(initAlarm);

  const initRadar = (radar) => {
    const sweep = radar.querySelector(".sweep");
    const blips = [...radar.querySelectorAll(".blip")];
    if (!sweep || blips.length < 8) return;

    const CX = 12;
    const CY = 12;
    const R_MIN = 2.35;
    const R_MAX = 7.4;
    const MIN_SEP = 2.2;
    const REST_R = 0.48;
    const POP_R = 1.28;
    const seed = (hash01(radar.getAttribute("data-cid") || "radar") * 4294967296) >>> 0;
    const rng = makeRng(seed ^ 0x5ad17e);

    const bearing = (x, y) => {
      let deg = (Math.atan2(y - CY, x - CX) * 180) / Math.PI + 90;
      if (deg < 0) deg += 360;
      if (deg >= 360) deg -= 360;
      return deg;
    };

    const spots = blips.map(() => ({ x: CX, y: CY }));
    const angles = spots.map(() => 0);
    const glow = blips.map(() => 0);
    const punch = blips.map(() => 0);

    const place = (index) => {
      const others = spots.filter((p, i) => i !== index && Math.hypot(p.x - CX, p.y - CY) > 0.2);
      for (let tryNo = 0; tryNo < 50; tryNo += 1) {
        const theta = rng() * Math.PI * 2;
        const u = rng();
        const r = Math.sqrt(R_MIN * R_MIN + u * (R_MAX * R_MAX - R_MIN * R_MIN));
        const x = CX + Math.cos(theta) * r;
        const y = CY + Math.sin(theta) * r;
        if (others.every((p) => Math.hypot(p.x - x, p.y - y) >= MIN_SEP)) {
          spots[index] = { x, y };
          angles[index] = bearing(x, y);
          blips[index].setAttribute("cx", x.toFixed(2));
          blips[index].setAttribute("cy", y.toFixed(2));
          return;
        }
      }
      const fallback = rng() * Math.PI * 2;
      const fr = R_MIN + rng() * (R_MAX - R_MIN);
      spots[index] = { x: CX + Math.cos(fallback) * fr, y: CY + Math.sin(fallback) * fr };
      angles[index] = bearing(spots[index].x, spots[index].y);
      blips[index].setAttribute("cx", spots[index].x.toFixed(2));
      blips[index].setAttribute("cy", spots[index].y.toFixed(2));
    };

    for (let i = 0; i < 8; i += 1) place(i);

    let beam = rng() * 360;
    let prev = beam;
    let last = performance.now();

    const crossed = (from, to, target) => {
      if (to >= from) return target >= from && target < to;
      return target >= from || target < to;
    };

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const c = Math.min(1, Math.max(0, getChaos() / 100));
      const count = 1 + Math.round(7 * c);
      beam = (beam + (102 + c * 465) * dt) % 360;

      for (let i = 0; i < 8; i += 1) {
        if (i < count && crossed(prev, beam, angles[i])) {
          glow[i] = 1;
          punch[i] = 1;
        }
        const fade = i < count ? 0.42 + (1 - c) * 0.2 : 1.5;
        glow[i] = Math.max(0, glow[i] - dt * fade);
        punch[i] = Math.max(0, punch[i] - dt * 7.5);
        const radius = REST_R + (POP_R - REST_R) * punch[i] * punch[i];
        blips[i].setAttribute("r", radius.toFixed(3));
        blips[i].setAttribute("opacity", glow[i].toFixed(3));
      }

      sweep.setAttribute("transform", `rotate(${beam.toFixed(2)} ${CX} ${CY})`);
      prev = beam;
      requestAnimationFrame(frame);
    };
    frame(performance.now());
  };

  document.querySelectorAll(".comp.radar").forEach(initRadar);

  const initDnp = (btn) => {
    const svg = btn.querySelector("svg");
    const plate = btn.querySelector(".plate");
    const face = btn.querySelector(".face");
    if (!svg || !plate || !face) return;

    const layer = document.createElementNS(svgNS, "svg");
    layer.classList.add("dnp-sparks");
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);

    const syncLayer = () => {
      layer.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
      layer.setAttribute("width", String(window.innerWidth));
      layer.setAttribute("height", String(window.innerHeight));
    };
    syncLayer();
    window.addEventListener("resize", syncLayer);

    let stage = 0;
    let sparks = [];
    let flyer = null;
    let fire = null;
    let raf = 0;
    let arcing = false;
    let edgeCool = 0;
    let last = performance.now();

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const faceCenter = () => {
      const rect = face.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    const addBolt = (origin, angle, spec) => {
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#ffffff");
      path.setAttribute("stroke-width", spec.width);
      path.setAttribute("stroke-linecap", "square");
      path.setAttribute("stroke-linejoin", "miter");
      layer.appendChild(path);
      sparks.push({
        el: path,
        origin,
        angle,
        reach: spec.reach,
        maxReach: spec.maxReach,
        jagged: spec.jagged,
        forks: spec.forks,
        life: spec.life,
        fade: spec.fade,
      });
    };

    const asPath = (pts) => pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("L");

    const subdivide = (a, b, displace, depth) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (depth <= 0 || dist < 6) return [a, b];
      const nx = -dy / (dist || 1);
      const ny = dx / (dist || 1);
      const offset = (Math.random() < 0.35 ? 0.35 : 1) * (Math.random() * 2 - 1) * displace;
      const mid = {
        x: (a.x + b.x) * 0.5 + nx * offset,
        y: (a.y + b.y) * 0.5 + ny * offset,
      };
      const next = displace * 0.55;
      const left = subdivide(a, mid, next, depth - 1);
      const right = subdivide(mid, b, next, depth - 1);
      return left.slice(0, -1).concat(right);
    };

    const drawBolt = (origin, angle, reach, jagged, forks) => {
      const dest = {
        x: origin.x + Math.cos(angle) * reach,
        y: origin.y + Math.sin(angle) * reach,
      };
      const depth = jagged > 12 ? 4 : 3;
      const trunk = subdivide(origin, dest, jagged, depth);
      let d = `M${asPath(trunk)}`;
      for (let f = 0; f < forks; f += 1) {
        if (trunk.length < 5) break;
        const idx = 2 + Math.floor(Math.random() * (trunk.length - 4));
        const from = trunk[idx];
        const t = idx / (trunk.length - 1);
        const forkReach = (1 - t) * reach * (0.28 + Math.random() * 0.4);
        const side = f % 2 === 0 ? -1 : 1;
        const forkAngle = angle + side * (0.7 + Math.random() * 1.05);
        const forkDest = {
          x: from.x + Math.cos(forkAngle) * forkReach,
          y: from.y + Math.sin(forkAngle) * forkReach,
        };
        d += `M${asPath(subdivide(from, forkDest, jagged * 0.65, 3))}`;
      }
      return d;
    };

    const burstSparks = () => {
      const origin = faceCenter();
      for (let i = 0; i < 10; i += 1) {
        addBolt(origin, (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.4, {
          width: i === 0 ? "1.55" : (0.85 + Math.random() * 0.4).toFixed(2),
          reach: 10,
          maxReach: 52 + Math.random() * 58,
          jagged: 9 + Math.random() * 7,
          forks: 1 + (Math.random() < 0.6 ? 1 : 0) + (Math.random() < 0.35 ? 1 : 0),
          life: 1,
          fade: 0.032,
        });
      }
      arcing = true;
      edgeCool = 0.42;
      kick();
    };

    const spawnEdgeSpark = () => {
      const rect = face.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const r = Math.max(rect.width, rect.height) * 0.5;
      const angle = Math.random() * Math.PI * 2;
      addBolt(
        { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r },
        angle + (Math.random() - 0.5) * 0.55,
        {
          width: (0.7 + Math.random() * 0.28).toFixed(2),
          reach: 3,
          maxReach: 12 + Math.random() * 14,
          jagged: 3.2 + Math.random() * 2.6,
          forks: Math.random() < 0.4 ? 1 : 0,
          life: 0.62,
          fade: 0.055,
        },
      );
    };

    const placePlate = (item) => {
      item.el.setAttribute(
        "transform",
        `translate(${item.x.toFixed(1)} ${item.y.toFixed(1)}) rotate(${item.rot.toFixed(1)}) ` +
          `scale(${item.sx.toFixed(3)} ${item.sy.toFixed(3)}) ` +
          `translate(${(-item.pcx).toFixed(2)} ${(-item.pcy).toFixed(2)})`,
      );
    };

    const dropPlate = () => {
      const box = plate.getBBox();
      const screen = plate.getBoundingClientRect();
      const g = document.createElementNS(svgNS, "g");
      g.classList.add("dnp-plate");
      g.appendChild(plate.cloneNode(true));
      layer.appendChild(g);
      plate.setAttribute("visibility", "hidden");
      flyer = {
        el: g,
        x: screen.left + screen.width / 2,
        y: screen.top + screen.height / 2,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 0.4,
        rot: (Math.random() - 0.5) * 4,
        vr: (Math.random() - 0.5) * 6,
        sx: screen.width / box.width,
        sy: screen.height / box.height,
        pcx: box.x + box.width / 2,
        pcy: box.y + box.height / 2,
      };
      placePlate(flyer);
      kick();
    };

    const startFire = () => {
      if (fire) return;
      const canvas = document.createElement("canvas");
      canvas.classList.add("site-fire");
      canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      const parts = [];
      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = window.innerWidth;
        const h = 220;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      window.addEventListener("resize", resize);
      fire = { canvas, ctx, parts, resize };
      kick();
    };

    const boom500 = () => {
      const host = location.hostname || "localhost";
      const port = location.port || (location.protocol === "https:" ? "443" : "80");
      const html = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">
<html><head>
<title>500 Internal Server Error</title>
</head><body>
<h1>Internal Server Error</h1>
<p>The server encountered an internal error or
misconfiguration and was unable to complete
your request.</p>
<p>Please contact the server administrator at 
 webmaster@${host} to inform them of the time this error occurred,
 and the actions you performed just before this error.</p>
<p>More information about this error may be available
in the server error log.</p>
<hr>
<address>Apache/2.4.58 (Unix) Server at ${host} Port ${port}</address>
</body></html>`;
      document.open();
      document.write(html);
      document.close();
    };

    const stepFire = () => {
      if (!fire) return;
      const { ctx, parts } = fire;
      const w = window.innerWidth;
      const h = 220;
      const need = Math.floor(w * 0.22);
      while (parts.length < need) {
        parts.push({
          x: Math.random() * w,
          y: h + Math.random() * 12,
          vx: (Math.random() - 0.5) * 0.7,
          vy: -1.1 - Math.random() * 2.8,
          life: 0.55 + Math.random() * 0.45,
          decay: 0.012 + Math.random() * 0.02,
          size: 4 + Math.random() * 10,
          hot: Math.random(),
        });
      }
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.018;
        p.life -= p.decay;
        if (p.life <= 0 || p.y < -20) {
          parts.splice(i, 1);
          continue;
        }
        const alpha = Math.max(0, p.life);
        const r = p.size * (0.45 + alpha);
        const g = p.hot > 0.62 ? 230 : p.hot > 0.3 ? 140 : 70;
        const b = p.hot > 0.75 ? 160 : 20;
        ctx.fillStyle = `rgba(255,${g},${b},${(0.22 + alpha * 0.55).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const frame = (now) => {
      raf = 0;
      const t = now || performance.now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (arcing) {
        edgeCool -= dt;
        if (edgeCool <= 0) {
          const n = Math.random() < 0.28 ? 2 : 1;
          for (let i = 0; i < n; i += 1) spawnEdgeSpark();
          edgeCool = 0.14 + Math.random() * 0.38;
        }
      }
      sparks = sparks.filter((spark) => {
        spark.reach += (spark.maxReach - spark.reach) * 0.32;
        spark.life -= spark.fade || 0.032;
        if (spark.life <= 0) {
          spark.el.remove();
          return false;
        }
        if (Math.random() < 0.12) spark.el.setAttribute("d", "");
        else {
          spark.el.setAttribute(
            "d",
            drawBolt(spark.origin, spark.angle, spark.reach, spark.jagged, spark.forks),
          );
        }
        spark.el.setAttribute("opacity", Math.min(1, spark.life).toFixed(3));
        return true;
      });

      if (flyer) {
        flyer.vy += 1.15;
        flyer.vx *= 0.992;
        flyer.x += flyer.vx;
        flyer.y += flyer.vy;
        flyer.rot += flyer.vr;
        placePlate(flyer);
        if (flyer.y > window.innerHeight + 80) {
          flyer.el.remove();
          flyer = null;
        }
      }

      stepFire();
      if (sparks.length || flyer || fire || arcing) kick();
    };

    const down = (event) => {
      if (event.button != null && event.button !== 0) return;
      btn.classList.add("pressed");
      try {
        btn.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };
    const up = () => btn.classList.remove("pressed");

    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("click", () => {
      stage += 1;
      if (stage === 1) burstSparks();
      else if (stage === 2) dropPlate();
      else if (stage === 3) startFire();
      else if (stage === 4) boom500();
    });
  };

  document.querySelectorAll(".comp.dnp").forEach(initDnp);

  const initTraces = (board) => {
    const circuit = board.querySelector(".circuit");
    const svg = board.querySelector(".traces");
    const specEl = board.querySelector(".wire-spec");
    if (!circuit || !svg) return;

    const PITCH = 2.9;
    const LEAD = 12;
    const wires = specEl ? JSON.parse(specEl.textContent) : [];

    const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
    const len = (a) => Math.hypot(a.x, a.y) || 1;
    const snapAxis = (n) =>
      Math.abs(n.x) >= Math.abs(n.y) ? { x: Math.sign(n.x) || 1, y: 0 } : { x: 0, y: Math.sign(n.y) || 1 };

    const mapSvg = (el, x, y) => {
      const m = el.getScreenCTM();
      if (!m) return { x, y };
      return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    };

    const portBox = (el) => {
      const face = el.querySelector("svg");
      const fallback = () => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      if (!face || !face.viewBox) return fallback();
      const vb = face.viewBox.baseVal;
      const raw = (el.getAttribute("data-port") || "").trim().split(/[\s,]+/).map(Number);
      const box = raw.length === 4 && raw.every(Number.isFinite)
        ? { x: raw[0], y: raw[1], w: raw[2], h: raw[3] }
        : { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
      const a = mapSvg(face, box.x, box.y);
      const b = mapSvg(face, box.x + box.w, box.y + box.h);
      return {
        left: Math.min(a.x, b.x),
        right: Math.max(a.x, b.x),
        top: Math.min(a.y, b.y),
        bottom: Math.max(a.y, b.y),
      };
    };

    const attach = (el, face, t) => {
      const box = portBox(el);
      const u = Math.min(1, Math.max(0, t == null ? 0.5 : t));
      if (face === "left") return { point: { x: box.left, y: box.top + (box.bottom - box.top) * u }, normal: { x: -1, y: 0 } };
      if (face === "right") return { point: { x: box.right, y: box.top + (box.bottom - box.top) * u }, normal: { x: 1, y: 0 } };
      if (face === "top") return { point: { x: box.left + (box.right - box.left) * u, y: box.top }, normal: { x: 0, y: -1 } };
      return { point: { x: box.left + (box.right - box.left) * u, y: box.bottom }, normal: { x: 0, y: 1 } };
    };

    const collapse = (pts) => {
      const out = [];
      pts.forEach((raw) => {
        const p = { x: raw.x, y: raw.y };
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.05 && Math.abs(last.y - p.y) < 0.05) return;
        const prev = out[out.length - 2];
        if (prev && last) {
          if (Math.abs(prev.x - last.x) < 0.05 && Math.abs(last.x - p.x) < 0.05) {
            out[out.length - 1] = { x: prev.x, y: p.y };
            return;
          }
          if (Math.abs(prev.y - last.y) < 0.05 && Math.abs(last.y - p.y) < 0.05) {
            out[out.length - 1] = { x: p.x, y: prev.y };
            return;
          }
        }
        out.push(p);
      });
      return out;
    };

    const lockOrtho = (pts, heading) => {
      if (!pts.length) return [];
      const out = [{ x: pts[0].x, y: pts[0].y }];
      let dir = heading;
      for (let i = 1; i < pts.length; i += 1) {
        const a = out[out.length - 1];
        const b = { x: pts[i].x, y: pts[i].y };
        if (Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05) continue;
        if (Math.abs(a.x - b.x) < 0.05) {
          out.push({ x: a.x, y: b.y });
          dir = { x: 0, y: Math.sign(b.y - a.y) || 1 };
          continue;
        }
        if (Math.abs(a.y - b.y) < 0.05) {
          out.push({ x: b.x, y: a.y });
          dir = { x: Math.sign(b.x - a.x) || 1, y: 0 };
          continue;
        }
        const horiz = dir && Math.abs(dir.x) > 0.5;
        const corner = horiz ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
        out.push(corner);
        out.push({ x: b.x, y: b.y });
        dir = snapAxis(sub(b, corner));
      }
      return collapse(out);
    };

    const leftNormal = (dir) => ({ x: -dir.y, y: dir.x });

    const offsetOrtho = (pts, dist) =>
      pts.map((p, i) => {
        if (i === 0) {
          const dir = snapAxis(sub(pts[1], p));
          return add(p, mul(leftNormal(dir), dist));
        }
        if (i === pts.length - 1) {
          const dir = snapAxis(sub(p, pts[i - 1]));
          return add(p, mul(leftNormal(dir), dist));
        }
        const din = snapAxis(sub(p, pts[i - 1]));
        const dout = snapAxis(sub(pts[i + 1], p));
        if (din.x === -dout.x && din.y === -dout.y) {
          return add(p, mul(leftNormal(din), dist));
        }
        return add(p, add(mul(leftNormal(din), dist), mul(leftNormal(dout), dist)));
      });

    const stroke = (pts) => {
      if (pts.length < 2) return;
      const el = document.createElementNS(svgNS, "path");
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
      el.setAttribute("d", d);
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", "#ffffff");
      el.setAttribute("stroke-width", "1");
      el.setAttribute("stroke-linecap", "square");
      el.setAttribute("stroke-linejoin", "miter");
      el.setAttribute("stroke-miterlimit", "2");
      el.setAttribute("shape-rendering", "crispEdges");
      svg.appendChild(el);
    };

    const draw = () => {
      const box = board.getBoundingClientRect();
      const circuitBox = circuit.getBoundingClientRect();
      const pad = 48;
      svg.setAttribute("viewBox", `${-pad} ${-pad} ${Math.max(box.width, 1) + pad * 2} ${Math.max(box.height, 1) + pad * 2}`);
      svg.style.left = `${-pad}px`;
      svg.style.top = `${-pad}px`;
      svg.style.width = `${box.width + pad * 2}px`;
      svg.style.height = `${box.height + pad * 2}px`;
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const toLocal = (p) => ({ x: p.x - box.left, y: p.y - box.top });
      const viaPoint = (xy) => ({
        x: box.left + xy[0],
        y: circuitBox.top + (circuitBox.height * xy[1]) / 100,
      });

      wires.forEach((wire) => {
        const a = circuit.querySelector(`[data-cid="${CSS.escape(wire.a)}"]`);
        const b = circuit.querySelector(`[data-cid="${CSS.escape(wire.b)}"]`);
        if (!a || !b) return;
        const from = attach(a, wire.fa, wire.ta);
        const to = attach(b, wire.fb, wire.tb);
        const vias = (wire.via || []).map(viaPoint);
        const pts = lockOrtho(
          [from.point, add(from.point, mul(from.normal, LEAD)), ...vias, add(to.point, mul(to.normal, LEAD)), to.point],
          from.normal,
        ).map((p) => {
          const q = toLocal(p);
          return { x: Math.round(q.x), y: Math.round(q.y) };
        });
        const local = lockOrtho(pts, from.normal);
        for (const dist of [-PITCH, 0, PITCH]) stroke(lockOrtho(offsetOrtho(local, dist), from.normal));
      });
    };

    draw();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(draw);
      ro.observe(board);
      ro.observe(circuit);
      const cabinet = document.querySelector(".cabinet");
      if (cabinet) ro.observe(cabinet);
    }
    window.addEventListener("resize", draw);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(draw);
    }
  };

  document.querySelectorAll(".circuit-board").forEach(initTraces);

  const initGridFeeds = () => {
    const page = document.querySelector(".page");
    const grid = document.querySelector(".led-grid");
    const left = document.querySelector('[data-cid="l-bq"]');
    const right = document.querySelector('[data-cid="r-dp"]');
    if (!page || !grid || !left || !right) return;

    const PITCH = 2.9;
    const LEAD = 12;
    let svg = page.querySelector(".page-feeds");
    if (!svg) {
      svg = document.createElementNS(svgNS, "svg");
      svg.classList.add("page-feeds");
      svg.setAttribute("aria-hidden", "true");
      page.appendChild(svg);
    }

    const mapSvg = (el, x, y) => {
      const m = el.getScreenCTM();
      if (!m) return { x, y };
      return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    };

    const portBox = (el) => {
      const face = el.querySelector("svg");
      const fallback = () => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      if (!face || !face.viewBox) return fallback();
      const vb = face.viewBox.baseVal;
      const raw = (el.getAttribute("data-port") || "").trim().split(/[\s,]+/).map(Number);
      const box = raw.length === 4 && raw.every(Number.isFinite)
        ? { x: raw[0], y: raw[1], w: raw[2], h: raw[3] }
        : { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
      const a = mapSvg(face, box.x, box.y);
      const b = mapSvg(face, box.x + box.w, box.y + box.h);
      return {
        left: Math.min(a.x, b.x),
        right: Math.max(a.x, b.x),
        top: Math.min(a.y, b.y),
        bottom: Math.max(a.y, b.y),
      };
    };

    const attach = (el, face, t) => {
      const box = portBox(el);
      const u = Math.min(1, Math.max(0, t == null ? 0.5 : t));
      if (face === "left") {
        return { point: { x: box.left, y: box.top + (box.bottom - box.top) * u }, normal: { x: -1, y: 0 } };
      }
      return { point: { x: box.right, y: box.top + (box.bottom - box.top) * u }, normal: { x: 1, y: 0 } };
    };

    const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
    const mul = (a, s) => ({ x: a.x * s, y: a.y * s });

    const stroke = (pts) => {
      if (pts.length < 2) return;
      const el = document.createElementNS(svgNS, "path");
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
      el.setAttribute("d", d);
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", "#ffffff");
      el.setAttribute("stroke-width", "1");
      el.setAttribute("stroke-linecap", "square");
      el.setAttribute("stroke-linejoin", "miter");
      el.setAttribute("shape-rendering", "crispEdges");
      svg.appendChild(el);
    };

    const drawRun = (from, toX) => {
      const y = Math.round(from.point.y);
      const startX = Math.round(from.point.x);
      const leadX = Math.round(from.point.x + from.normal.x * LEAD);
      const endX = Math.round(toX);
      const pts = [
        { x: startX, y },
        { x: leadX, y },
        { x: endX, y },
      ];
      for (const dist of [-PITCH, 0, PITCH]) {
        stroke(pts.map((p) => add(p, mul({ x: 0, y: 1 }, dist))));
      }
    };

    const draw = () => {
      const pageBox = page.getBoundingClientRect();
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("viewBox", `0 0 ${Math.max(pageBox.width, 1)} ${Math.max(pageBox.height, 1)}`);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const toLocal = (p) => ({ x: p.x - pageBox.left, y: p.y - pageBox.top });
      const gridBox = grid.getBoundingClientRect();
      const leftPort = attach(left, "right", 0.5);
      const rightPort = attach(right, "left", 0.5);
      drawRun(
        { point: toLocal(leftPort.point), normal: leftPort.normal },
        gridBox.left - pageBox.left + 8,
      );
      drawRun(
        { point: toLocal(rightPort.point), normal: rightPort.normal },
        gridBox.right - pageBox.left - 8,
      );
    };

    draw();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(draw);
      ro.observe(page);
      ro.observe(grid);
      ro.observe(left);
      ro.observe(right);
    }
    window.addEventListener("resize", draw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  };

  initGridFeeds();
})();
