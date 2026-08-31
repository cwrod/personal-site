#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/site"
SRC_ROOT="$(cd "$SCRIPT_DIR/../../pandemic_model" && pwd)"

MODEL_SRC="$SRC_ROOT/site_client/"
MODEL_DEST="$SITE_DIR/bioterror-model/"
RESULTS_SRC="$SRC_ROOT/site_preset_sweep_client/"
RESULTS_DEST="$SITE_DIR/bioterror-model-results/"

mkdir -p "$MODEL_DEST" "$RESULTS_DEST"

# --delete only removes extra files in dest. Source trees are not modified.
rsync -a --delete \
  --exclude 'build.py' \
  "$MODEL_SRC" \
  "$MODEL_DEST"

rsync -a --delete \
  --exclude 'build.py' \
  --exclude 'plots.py' \
  "$RESULTS_SRC" \
  "$RESULTS_DEST"

echo "Synced $MODEL_SRC -> $MODEL_DEST"
echo "Synced $RESULTS_SRC -> $RESULTS_DEST"
