#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REBOUND_REF="${REBOUND_REF:-5.0.0}"
REBOUND_DIR="${ROOT_DIR}/.cache/rebound-${REBOUND_REF}"
OUTPUT_DIR="${ROOT_DIR}/public/rebound-v6-6"

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc was not found. Activate the Emscripten SDK before running this script." >&2
  exit 1
fi

if [[ ! -d "${REBOUND_DIR}/.git" ]]; then
  rm -rf "${REBOUND_DIR}"
  git clone --depth 1 --branch "${REBOUND_REF}" https://github.com/hannorein/rebound.git "${REBOUND_DIR}"
fi

mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_DIR}/rebound.js" "${OUTPUT_DIR}/rebound.wasm"

EXPORTED_FUNCTIONS='[
  "_rs_init",
  "_rs_reset",
  "_rs_set_integrator",
  "_rs_step",
  "_rs_spawn_impactor",
  "_rs_write_state",
  "_rs_state_buffer",
  "_rs_count",
  "_rs_time",
  "_rs_energy_error",
  "_rs_impacts",
  "_rs_last_impact_energy",
  "_rs_last_impact_speed",
  "_rs_last_impact_target",
  "_rs_living_world_index",
  "_rs_particle_type",
  "_rs_particle_name",
  "_rs_system_seed"
]'

emcc \
  -O3 \
  -flto \
  -I"${REBOUND_DIR}/src" \
  "${REBOUND_DIR}"/src/*.c \
  "${ROOT_DIR}/core/reality-v6-6/rebound_bridge.c" \
  -DSERVERHIDEWARNING \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createRealityRebound \
  -sENVIRONMENT=web \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sSTACK_SIZE=1048576 \
  -sFILESYSTEM=0 \
  -sASSERTIONS=0 \
  -sEXPORTED_FUNCTIONS="${EXPORTED_FUNCTIONS}" \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF64"]' \
  -o "${OUTPUT_DIR}/rebound.js"

cat > "${OUTPUT_DIR}/BUILD.txt" <<EOF
REBOUND ${REBOUND_REF}
Built with Emscripten for Reality Engine V6.6.
Exact source: https://github.com/hannorein/rebound/tree/${REBOUND_REF}
Bridge source: core/reality-v6-6/rebound_bridge.c
License: GNU GPL v3 or later; see LICENSE.txt in this directory.
EOF

cp "${REBOUND_DIR}/LICENSE" "${OUTPUT_DIR}/LICENSE.txt"

echo "Built same-origin REBOUND assets:"
ls -lh \
  "${OUTPUT_DIR}/rebound.js" \
  "${OUTPUT_DIR}/rebound.wasm" \
  "${OUTPUT_DIR}/LICENSE.txt"
