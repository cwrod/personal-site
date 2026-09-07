#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -n "${1-}" ]]; then
  SRC_ROOT="$(cd "$1" && pwd)"
else
  SRC_ROOT="$(cd "${AI_RACE_SRC:-$SCRIPT_DIR/../../game_theory}" && pwd)"
fi

SITE_SRC="$SRC_ROOT/output/site/ai-race/index.html"
SITE_DEST_DIR="$ROOT/site/ai-race"
SITE_DEST="$SITE_DEST_DIR/index.html"
SERVER_DEST="$ROOT/ai-race-server"

SERVER_FILES=(
  serve_play.py
  multiplayer.py
  game.py
  interactive.py
  requirements-play.txt
  render.yaml
)

if [[ ! -f "$SITE_SRC" ]]; then
  echo "Missing $SITE_SRC" >&2
  echo "Pass the game_theory path: $0 /path/to/game_theory" >&2
  exit 1
fi

for f in "${SERVER_FILES[@]}"; do
  if [[ ! -f "$SRC_ROOT/$f" ]]; then
    echo "Missing $SRC_ROOT/$f" >&2
    exit 1
  fi
done

mkdir -p "$SITE_DEST_DIR" "$SERVER_DEST"

existing_api=""
if [[ -f "$SITE_DEST" ]]; then
  existing_api="$(python3 -c '
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r"const PLAY_API = (\"(?:\\\\.|[^\"\\\\])*\")", text)
print(match.group(1)[1:-1] if match else "")
' "$SITE_DEST")"
fi

cp "$SITE_SRC" "$SITE_DEST"
if [[ -n "$existing_api" ]]; then
  python3 -c '
import json, re, sys
path, api = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
updated, n = re.subn(
    r"const PLAY_API = (\"(?:\\\\.|[^\"\\\\])*\")",
    "const PLAY_API = " + json.dumps(api),
    text,
    count=1,
)
if n != 1:
    raise SystemExit("Could not restore PLAY_API in site/ai-race/index.html")
open(path, "w", encoding="utf-8").write(updated)
' "$SITE_DEST" "$existing_api"
fi

for f in "${SERVER_FILES[@]}"; do
  cp "$SRC_ROOT/$f" "$SERVER_DEST/$f"
done

echo "Synced $SITE_SRC -> $SITE_DEST"
if [[ -n "$existing_api" ]]; then
  echo "Kept PLAY_API=$existing_api"
fi
echo "Synced server files -> $SERVER_DEST"
