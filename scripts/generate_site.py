#!/usr/bin/env python3
"""Generate a pixel-retro personal site under site/."""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "stub.txt"
ASSETS_DIR = ROOT / "assets"
SITE_DIR = ROOT / "site"

DISPLAY_NAME = "CHRISTOPHER RODRIGUEZ"

# Classic 5x7 scoreboard glyphs. 1 = on (white), 0 = off (gray).
FONT_5X7: dict[str, tuple[str, ...]] = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "C": ("01110", "10001", "10000", "10000", "10000", "10001", "01110"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "G": ("01110", "10001", "10000", "10111", "10001", "10001", "01110"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "J": ("00111", "00010", "00010", "00010", "00010", "10010", "01100"),
    "K": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "Q": ("01110", "10001", "10001", "10001", "10101", "10010", "01101"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "11011", "10001"),
    "X": ("10001", "10001", "01010", "00100", "01010", "10001", "10001"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "Z": ("11111", "00001", "00010", "00100", "01000", "10000", "11111"),
}

GLYPH_COLS = 5
GLYPH_ROWS = 7
LETTER_GAP = 1
ROW_GAP = 3
PAD_X = 2
PAD_Y = 2


def glyph(char: str) -> tuple[str, ...]:
    blank = ("0" * GLYPH_COLS,) * GLYPH_ROWS
    return FONT_5X7.get(char.upper(), blank)


def word_width(word: str) -> int:
    if not word:
        return 0
    return len(word) * GLYPH_COLS + (len(word) - 1) * LETTER_GAP


def paint_word(word: str, width: int) -> list[str]:
    rows = ["0" * width for _ in range(GLYPH_ROWS)]
    x = (width - word_width(word)) // 2
    for index, char in enumerate(word):
        for row, bits in enumerate(glyph(char)):
            rows[row] = rows[row][:x] + bits + rows[row][x + GLYPH_COLS :]
        x += GLYPH_COLS
        if index < len(word) - 1:
            x += LETTER_GAP
    return rows


def build_board(name: str) -> list[str]:
    words = name.split()
    width = max(word_width(word) for word in words) + PAD_X * 2
    board = ["0" * width] * PAD_Y
    for index, word in enumerate(words):
        board.extend(paint_word(word, width))
        if index < len(words) - 1:
            board.extend(["0" * width] * ROW_GAP)
    board.extend(["0" * width] * PAD_Y)
    return board


STUB_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def stub_to_html(text: str) -> str:
    paragraphs = [block.strip() for block in text.strip().split("\n\n") if block.strip()]
    rendered: list[str] = []
    for block in paragraphs:
        escaped = html.escape(block).replace("\n", "<br>\n")
        escaped = STUB_LINK_RE.sub(
            lambda m: (
                f'<a href="{m.group(2)}" target="_blank" rel="noopener noreferrer">'
                f"{m.group(1)}</a>"
            ),
            escaped,
        )
        rendered.append(f"        <p>{escaped}</p>")
    return "\n".join(rendered)


def inline_svg(name: str) -> str:
    text = (ASSETS_DIR / name).read_text(encoding="utf-8").strip()
    if text.startswith("<?xml"):
        text = text.split("?>", 1)[1].strip()
    return text


def _inject_attrs(html: str, extra: str) -> str:
    i = html.find(">")
    if i < 0:
        return html
    return f"{html[:i]}{extra}{html[i:]}"


def render_circuit(name: str, width: int, parts: list[tuple], wires: list[dict]) -> str:
    links: dict[str, list[str]] = {}
    for wire in wires:
        links.setdefault(wire["a"], []).append(wire["b"])
        links.setdefault(wire["b"], []).append(wire["a"])

    cells: list[str] = []
    for cid, x, y, html in parts:
        extra = (
            f' data-cid="{cid}" data-links="{" ".join(links.get(cid, []))}"'
            f' style="left:{x}px;top:{y}%"'
        )
        cells.append(f"        {_inject_attrs(html, extra)}")

    body = "\n".join(cells)
    spec = json.dumps(wires, separators=(",", ":"))
    return f"""      <div class="circuit-board">
        <svg class="traces" aria-hidden="true"></svg>
        <script type="application/json" class="wire-spec">{spec}</script>
        <div class="circuit circuit-{name}" style="width:{width}px">
{body}
        </div>
      </div>"""


def render_ribbons() -> tuple[str, str]:
    button = inline_svg("button.svg")
    button_square = inline_svg("button-square.svg")
    button_rect = inline_svg("button-rect.svg")
    switch = inline_svg("switch.svg")
    switch_slide = inline_svg("switch-slide.svg")
    switch_rocker = inline_svg("switch-rocker.svg")
    scope = inline_svg("oscilloscope.svg")
    whistle = inline_svg("whistle.svg")
    mixer = inline_svg("mixer.svg")
    rgb = inline_svg("rgb.svg")
    galton = inline_svg("galton.svg")
    keyboard = inline_svg("keyboard.svg")
    plasma = inline_svg("plasma.svg")
    tank = inline_svg("tank.svg")
    dial = inline_svg("dial.svg")
    dial_vu = inline_svg("dial-vu.svg")
    dial_temp = inline_svg("dial-temp.svg")
    hanoi = inline_svg("hanoi.svg")
    seismo = inline_svg("seismo.svg")
    simon = inline_svg("simon.svg")
    alarm = inline_svg("alarm.svg")
    radar = inline_svg("radar.svg")
    dnp = inline_svg("dnp.svg")

    def mark(html: str, port: str = "", faces: str = "") -> str:
        extra = ""
        if port:
            extra += f' data-port="{port}"'
        if faces:
            extra += f' data-faces="{faces}"'
        return _inject_attrs(html, extra) if extra else html

    def btn(svg: str, label: str, extra: str = "") -> str:
        cls = f"comp button{f' {extra}' if extra else ''}"
        return f'<button type="button" class="{cls}" aria-label="{label}">{svg}</button>'

    def sw(svg: str, label: str, extra: str = "", port: str = "") -> str:
        cls = f"comp switch{f' {extra}' if extra else ''}"
        return mark(
            f'<button type="button" class="{cls}" aria-pressed="false" '
            f'aria-label="{label}">{svg}</button>',
            port,
        )

    def box(
        cls: str,
        label: str,
        svg: str,
        tag: str = "div",
        role: str = "img",
        port: str = "",
        faces: str = "",
    ) -> str:
        if tag == "button":
            html = f'<button type="button" class="{cls}" aria-label="{label}">{svg}</button>'
        else:
            html = f'<div class="{cls}" role="{role}" aria-label="{label}">{svg}</div>'
        return mark(html, port, faces)

    toggle = "3.4 20.1 13.2 6.8"

    left_parts = [
        ("l-pl", 54, 1.6, box("comp plasma", "Plasma ball. Touch the glass.", plasma, port="6.6 29.8 14.8 6.4", faces="left right bottom")),
        ("l-dn", 150, 11.4, box("comp dnp", "Do not press.", dnp, "button")),
        ("l-bq", 248, 21.4, btn(button_square, "Square button")),
        ("l-sl", 8, 26.0, sw(switch_slide, "Slide switch", "switch-slide")),
        ("l-se", 80, 31.6, box("comp seismo", "Seismograph. Click to shake.", seismo, "button")),
        ("l-rk", 158, 38.2, sw(switch_rocker, "Rocker switch", "switch-rocker")),
        ("l-bw", 26, 43.4, btn(button_rect, "Bar button", "button-wide")),
        ("l-dt", 212, 47.6, box("comp dial dial-temp", "Temperature dial.", dial_temp)),
        ("l-sm", 38, 52.8, box("comp simon", "Simon. Press play, then repeat the lights.", simon, role="group")),
        ("l-br2", 228, 70.6, btn(button, "Round button")),
        ("l-rd", 218, 80.0, box("comp radar", "Radar. Contacts appear as chaos rises.", radar)),
        ("l-rgb", 16, 83.8, box("comp rgb", "RGB board. Slide R, G, and B to change the background.", rgb, role="group", faces="top bottom")),
        ("l-kb", 62, 94.0, box("comp keyboard", "Two octave keyboard. Press keys to play.", keyboard, role="group")),
    ]
    # fa/fb = port face, ta/tb = 0-1 along that face, via = [x px, y %] elbows.
    left_wires = [
        {"a": "l-pl", "fa": "right", "ta": 0.45, "b": "l-dn", "fb": "left", "tb": 0.28},
        {"a": "l-pl", "fa": "bottom", "ta": 0.22, "b": "l-sl", "fb": "top", "tb": 0.55, "via": [[40, 20.4]]},
        {"a": "l-dn", "fa": "right", "ta": 0.22, "b": "l-bq", "fb": "top", "tb": 0.45, "via": [[248, 16.8]]},
        {"a": "l-sl", "fa": "right", "ta": 0.55, "b": "l-se", "fb": "left", "tb": 0.28},
        {"a": "l-se", "fa": "right", "ta": 0.62, "b": "l-rk", "fb": "left", "tb": 0.38},
        {"a": "l-se", "fa": "bottom", "ta": 0.22, "b": "l-bw", "fb": "top", "tb": 0.48, "via": [[48, 38.4]]},
        {"a": "l-bq", "fa": "bottom", "ta": 0.55, "b": "l-rk", "fb": "right", "tb": 0.42, "via": [[262, 36.0]]},
        {"a": "l-rk", "fa": "bottom", "ta": 0.72, "b": "l-dt", "fb": "top", "tb": 0.32},
        {"a": "l-bw", "fa": "bottom", "ta": 0.58, "b": "l-sm", "fb": "top", "tb": 0.22},
        {"a": "l-sm", "fa": "right", "ta": 0.22, "b": "l-dt", "fb": "left", "tb": 0.55, "via": [[176, 50.8]]},
        {"a": "l-sm", "fa": "bottom", "ta": 0.38, "b": "l-rgb", "fb": "top", "tb": 0.36},
        {"a": "l-dt", "fa": "bottom", "ta": 0.62, "b": "l-br2", "fb": "top", "tb": 0.5},
        {"a": "l-br2", "fa": "bottom", "ta": 0.5, "b": "l-rd", "fb": "top", "tb": 0.42},
        {"a": "l-rgb", "fa": "bottom", "ta": 0.55, "b": "l-kb", "fb": "top", "tb": 0.34},
    ]
    right_parts = [
        ("r-sc", 70, 1.4, box("comp scope", "Oscilloscope, hold to increase sweep speed", scope, "button")),
        ("r-wh", 258, 3.8, box("comp whistle", "Steam whistle. Pull the cord to blow.", whistle, "button", port="4.2 23.8 7.6 4.4", faces="left")),
        ("r-dp", 10, 12.0, box("comp dial", "Steam pressure dial.", dial)),
        ("r-al", 166, 14.8, box("comp alarm", "In case of emergency, break glass. Swing the hammer, then pull the lever.", alarm, port="1.3 9.2 27.2 37.4", faces="left bottom")),
        ("r-hn", 58, 33.6, box("comp hanoi", "Towers of Hanoi. Drag the disks.", hanoi)),
        ("r-dv", 210, 36.4, box("comp dial dial-vu", "VU meter.", dial_vu)),
        ("r-bw", 162, 52.4, btn(button_rect, "Bar button", "button-wide")),
        ("r-br", 18, 57.4, btn(button, "Round button")),
        ("r-ga", 118, 61.0, box("comp galton", "Galton board. Pick up the ball and drop it.", galton)),
        ("r-mx", 198, 75.6, box("comp mixer", "Mixer. Drag the four sliders.", mixer, role="group")),
        ("r-tk", 36, 81.4, box("comp tank", "Fish tank. The fish is swimming.", tank, "button")),
        ("r-dt", 194, 86.0, box("comp dial dial-temp", "Temperature dial.", dial_temp)),
        ("r-sl", 82, 93.6, sw(switch_slide, "Slide switch", "switch-slide")),
    ]
    right_wires = [
        {"a": "r-sc", "fa": "right", "ta": 0.5, "b": "r-wh", "fb": "left", "tb": 0.22},
        {"a": "r-sc", "fa": "bottom", "ta": 0.2, "b": "r-dp", "fb": "top", "tb": 0.58, "via": [[48, 8.6]]},
        {"a": "r-dp", "fa": "right", "ta": 0.48, "b": "r-al", "fb": "left", "tb": 0.18},
        {"a": "r-al", "fa": "bottom", "ta": 0.78, "b": "r-hn", "fb": "bottom", "tb": 0.72, "via": [[288, 33.0], [288, 47.2], [116, 47.2]]},
        {"a": "r-hn", "fa": "right", "ta": 0.48, "b": "r-dv", "fb": "left", "tb": 0.5},
        {"a": "r-hn", "fa": "left", "ta": 0.72, "b": "r-br", "fb": "top", "tb": 0.48, "via": [[20, 41.4], [20, 55.2]]},
        {"a": "r-dv", "fa": "bottom", "ta": 0.45, "b": "r-bw", "fb": "right", "tb": 0.28, "via": [[226, 49.2]]},
        {"a": "r-br", "fa": "right", "ta": 0.5, "b": "r-ga", "fb": "left", "tb": 0.12},
        {"a": "r-br", "fa": "bottom", "ta": 0.48, "b": "r-tk", "fb": "top", "tb": 0.18, "via": [[30, 70.0]]},
        {"a": "r-bw", "fa": "right", "ta": 0.55, "b": "r-mx", "fb": "top", "tb": 0.72, "via": [[286, 54.2], [286, 73.0]]},
        {"a": "r-mx", "fa": "bottom", "ta": 0.62, "b": "r-dt", "fb": "right", "tb": 0.38, "via": [[286, 84.0]]},
        {"a": "r-ga", "fa": "right", "ta": 0.88, "b": "r-dt", "fb": "top", "tb": 0.28, "via": [[190, 83.0]]},
        {"a": "r-tk", "fa": "bottom", "ta": 0.62, "b": "r-sl", "fb": "left", "tb": 0.4},
        {"a": "r-dt", "fa": "bottom", "ta": 0.28, "b": "r-sl", "fb": "right", "tb": 0.52},
    ]

    left = f"""    <aside class="ribbon ribbon-left" aria-label="Left circuitry">
{render_circuit("left", 276, left_parts, left_wires)}
    </aside>"""
    right = f"""    <aside class="ribbon ribbon-right" aria-label="Right circuitry">
{render_circuit("right", 302, right_parts, right_wires)}
    </aside>"""
    return left, right


def render_scoreboard(name: str) -> str:
    board = build_board(name)
    cols = len(board[0])
    pixels = []
    for row in board:
        for bit in row:
            state = " on" if bit == "1" else ""
            pixels.append(f'<span class="px{state}"></span>')
    grid = "\n          ".join(pixels)
    return (
        f'        <div class="led-grid" style="--led-cols: {cols}" '
        f'aria-hidden="true">\n          {grid}\n        </div>'
    )


def build_html(
    stub_html: str,
    scoreboard_html: str,
    left_ribbon: str,
    right_ribbon: str,
    debug: bool = False,
) -> str:
    debug_hud = (
        '  <div class="fps-hud" aria-hidden="true">\n'
        '    <div class="fps-readout">FPS <span class="fps-value">--</span></div>\n'
        '    <canvas class="fps-plot" width="140" height="36"></canvas>\n'
        "  </div>\n"
        if debug
        else ""
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CHRISTOPHER RODRIGUEZ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bitcount+Grid+Single&family=Press+Start+2P&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="scanlines" aria-hidden="true"></div>
  <div class="pixel-grid" aria-hidden="true"></div>
{debug_hud}  <div class="page">
{left_ribbon}
    <main class="cabinet">
      <section class="panel name-panel" aria-label="Scoreboard name">
        <h1 class="sr-only">CHRISTOPHER RODRIGUEZ</h1>
{scoreboard_html}
      </section>
      <section class="panel stub-panel">
{stub_html}
      </section>
    </main>
{right_ribbon}
  </div>
  <script src="assets/circuit.js?v=chaos26"></script>
</body>
</html>
"""


def build_css() -> str:
    return """*,
*::before,
*::after {
  box-sizing: border-box;
}

:root {
  --bg: #062406;
  --panel: #000000;
  --slot: #031203;
  --text: #ffffff;
  --line: #f4fff4;
  --px-on: #ffffff;
  --px-off: #6e6e6e;
  --pixel: 1px;
  --ribbon-left: 276px;
  --ribbon-right: 302px;
}

html {
  overflow-x: auto;
}

html,
body {
  margin: 0;
  min-height: 100%;
  min-width: calc(var(--ribbon-right) * 4);
}

body {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  overflow-x: auto;
  padding: clamp(16px, 4vw, 48px);
  background: var(--bg);
  color: var(--text);
  font-family: "Bitcount Grid Single", "Courier New", Courier, monospace;
  letter-spacing: 0.03em;
}

.scanlines,
.pixel-grid {
  pointer-events: none;
  position: fixed;
  inset: 0;
}

.scanlines {
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.18) 0,
    rgba(0, 0, 0, 0.18) 1px,
    transparent 1px,
    transparent 3px
  );
  z-index: 2;
}

.pixel-grid {
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 8px 8px;
  z-index: 1;
}

.page {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: clamp(16px, 2.4vw, 36px);
  width: min(1480px, 100%);
  min-width: calc(var(--ribbon-right) * 4);
  margin-inline: auto;
  flex-shrink: 0;
}

.page-feeds {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 0;
}

.cabinet {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  width: min(920px, 100%);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  padding: clamp(16px, 3vw, 28px);
}

.name-panel {
  padding: clamp(10px, 2vw, 18px);
}

.comp.keyboard {
  width: 154px;
  cursor: default;
}

.keyboard .key {
  cursor: pointer;
  pointer-events: all;
  fill: transparent;
  stroke: none;
}

.keyboard .key.down {
  fill: #ffffff;
}

.led-grid {
  display: grid;
  grid-template-columns: repeat(var(--led-cols), minmax(0, 1fr));
  gap: clamp(1px, 0.22vw, 3px);
  width: 100%;
}

.px {
  width: 100%;
  aspect-ratio: 1;
  background: var(--px-off);
}

.px.on {
  background: var(--px-on);
}

.stub-panel {
  text-align: left;
}

.stub-panel p {
  margin: 0 0 1.15em;
  color: var(--text);
  font-size: clamp(14px, 1.85vw, 17px);
  line-height: 1.6;
}

.stub-panel p:last-child {
  margin-bottom: 0;
}

.stub-panel a {
  color: inherit;
  text-decoration: underline;
}

.ribbon {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: auto;
  user-select: none;
}

.circuit-board {
  position: relative;
  height: 100%;
}

.circuit {
  position: relative;
  z-index: 1;
  height: 100%;
  min-height: 420px;
}

.circuit .comp {
  position: absolute;
  z-index: 1;
}

.circuit-board > .traces {
  position: absolute;
  overflow: visible;
  pointer-events: none;
  z-index: 0;
}

.comp {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  color: inherit;
  cursor: pointer;
  display: block;
  touch-action: none;
}

.comp.button {
  width: 25px;
}

.comp.dnp {
  width: 70px;
}

.comp.dnp svg {
  overflow: visible;
}

.dnp .guts {
  pointer-events: none;
}

.dnp .plate .skin,
.dnp-sparks .skin {
  fill: #062406;
}

.dnp .plate-copy,
.dnp-sparks .plate-copy {
  font-family: "Press Start 2P", "Courier New", Courier, monospace;
  font-size: 2.85px;
  fill: #ffffff;
  stroke: none;
  text-anchor: middle;
}

.dnp.pressed .face {
  fill: #ffffff;
}

.dnp-sparks,
.site-fire {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  overflow: visible;
}

.dnp-sparks {
  left: 0;
  top: 0;
}

.site-fire {
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 220px;
}

.comp.button-wide {
  width: 38px;
}

.comp.switch {
  width: 48px;
}

.comp.switch-slide {
  width: 53px;
}

.comp.switch-rocker {
  width: 45px;
}

.comp.scope {
  width: 43px;
}

.comp.plasma {
  width: 55px;
  cursor: pointer;
}

.plasma .bolt {
  pointer-events: none;
  opacity: 0.62;
}

.plasma.touching .bolt {
  opacity: 1;
}

.plasma.touching .electrode {
  fill: #ffffff;
}

.comp.seismo {
  width: 65px;
}

.seismo .trace,
.seismo .pen {
  pointer-events: none;
}

.comp.simon {
  width: 90px;
  cursor: default;
}

.simon .pad,
.simon .play {
  cursor: pointer;
  fill: transparent;
}

.simon .pad.on,
.simon .play.on {
  fill: #ffffff;
}

.simon .play.on path {
  fill: transparent;
}

.simon .hi,
.simon .hi-label {
  font-family: "Press Start 2P", "Courier New", Courier, monospace;
  pointer-events: none;
}

.seismo.shaking {
  animation: seismo-shake 0.7s steps(2, end);
}

@keyframes seismo-shake {
  0%,
  100% {
    transform: translate(0, 0);
  }
  10% {
    transform: translate(-2px, 1px) rotate(-1.4deg);
  }
  22% {
    transform: translate(2px, -1px) rotate(1.2deg);
  }
  36% {
    transform: translate(-2px, -1px) rotate(-0.8deg);
  }
  50% {
    transform: translate(2px, 1px) rotate(1deg);
  }
  64% {
    transform: translate(-1px, 2px) rotate(-0.6deg);
  }
  78% {
    transform: translate(1px, -2px) rotate(0.5deg);
  }
}

.comp.dial {
  width: 50px;
  cursor: default;
  pointer-events: none;
}

.comp.radar {
  width: 50px;
  cursor: default;
  pointer-events: none;
}

.radar .blip {
  fill: #ffffff;
  stroke: none;
}

.comp.dial-vu {
  width: 65px;
}

.comp.dial-temp {
  width: 45px;
}

.comp.hanoi {
  width: 80px;
  cursor: default;
}

.hanoi .disk {
  fill: #ffffff;
  cursor: grab;
}

.hanoi.dragging .disk {
  cursor: grabbing;
}

.hanoi .lamp {
  fill: none;
}

.hanoi.solved .lamp {
  fill: #ffffff;
}

.comp.alarm {
  width: 68px;
  cursor: default;
}

.comp.alarm svg {
  overflow: visible;
}

.alarm .lever {
  pointer-events: none;
  fill: transparent;
}

.alarm.broken .lever {
  pointer-events: all;
  cursor: ns-resize;
}

.alarm.broken .glass {
  display: none;
}

.alarm .beam {
  opacity: 0;
}

.alarm.latched .beam {
  opacity: 0.92;
}

.alarm.latched .beam.dim {
  opacity: 0.28;
}

.alarm .rotor,
.alarm .beam {
  pointer-events: none;
}

.alarm .plate {
  font-family: "Press Start 2P", "Courier New", Courier, monospace;
  pointer-events: none;
}

.comp.whistle {
  width: 35px;
}

.comp.mixer {
  width: 80px;
  cursor: default;
}

.mixer .cap {
  cursor: ns-resize;
  fill: #ffffff;
}

.comp.rgb {
  width: 150px;
  cursor: default;
}

.rgb .cap {
  cursor: ew-resize;
  fill: #ffffff;
}

.rgb .rgb-label {
  font-family: "Bitcount Grid Single", "Courier New", Courier, monospace;
  font-size: 5.2px;
  fill: #ffffff;
  stroke: none;
}

.comp.tank {
  width: 78px;
  cursor: pointer;
}

.tank .fish {
  pointer-events: none;
}

.comp.galton {
  width: 73px;
  cursor: default;
}

.galton .ball {
  cursor: grab;
}

.galton.dragging .ball {
  cursor: grabbing;
}

.galton .bin.lit {
  fill: #ffffff;
}

.galton .bin {
  fill: none;
}

.comp.whistle svg {
  overflow: visible;
}

.whistle .steam {
  opacity: 0;
}

.whistle.blowing .steam {
  opacity: 1;
}

.ribbon,
.circuit-board,
.circuit {
  overflow: visible;
}

.cord-layer.dragging .cord-ring,
.cord-layer.dragging .cord-hammer {
  cursor: grabbing;
}

.cord-layer {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 4;
  pointer-events: none;
  overflow: visible;
}

.cord-ring,
.cord-hammer {
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}

.comp svg {
  display: block;
  width: 100%;
  height: auto;
}

.comp:focus-visible {
  outline: 1px solid var(--line);
  outline-offset: 2px;
}

.paddle-on {
  display: none;
}

.button.pressed .face {
  fill: #ffffff;
}

.switch.on .paddle-off {
  display: none;
}

.switch.on .paddle-on {
  display: block;
}

.scope.holding .screen {
  fill: #ffffff;
}

.scope.holding .wave {
  stroke: #062406;
}

.fps-hud {
  position: fixed;
  top: 10px;
  left: 10px;
  z-index: 30;
  pointer-events: none;
  min-width: 148px;
  padding: 6px 7px 5px;
  background: #000000;
  border: 1px solid var(--line);
  color: var(--text);
  font-family: "Press Start 2P", "Courier New", Courier, monospace;
  font-size: 8px;
  line-height: 1.4;
}

.fps-readout {
  margin-bottom: 4px;
}

.fps-plot {
  display: block;
  width: 140px;
  height: 36px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 720px) {
  .page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: stretch;
  }

  .cabinet {
    grid-column: 1 / -1;
    grid-row: 1;
    width: 100%;
  }

  .ribbon-left {
    grid-row: 2;
  }

  .ribbon-right {
    grid-row: 2;
  }

  .ribbon {
    justify-self: center;
  }
}
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the personal site.")
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Include a top-left FPS plot for animation debugging.",
    )
    args = parser.parse_args()

    if not DATA_PATH.exists():
        raise SystemExit(f"Missing stub text: {DATA_PATH}")

    stub_html = stub_to_html(DATA_PATH.read_text(encoding="utf-8"))
    scoreboard_html = render_scoreboard(DISPLAY_NAME)
    left_ribbon, right_ribbon = render_ribbons()

    SITE_DIR.mkdir(parents=True, exist_ok=True)
    dest_assets = SITE_DIR / "assets"
    if dest_assets.exists():
        shutil.rmtree(dest_assets)
    shutil.copytree(ASSETS_DIR, dest_assets)

    (SITE_DIR / "index.html").write_text(
        build_html(stub_html, scoreboard_html, left_ribbon, right_ribbon, debug=args.debug),
        encoding="utf-8",
    )
    (SITE_DIR / "styles.css").write_text(build_css(), encoding="utf-8")
    print(f"Wrote {SITE_DIR / 'index.html'}")
    print(f"Wrote {SITE_DIR / 'styles.css'}")
    print(f"Copied assets to {dest_assets}")
    if args.debug:
        print("Debug FPS HUD enabled")


if __name__ == "__main__":
    main()
