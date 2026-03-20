set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

wasm-runtime-pull:
    bash scripts/prepare-wasm-runtime.sh

wasm-dev host="127.0.0.1" port="4173":
    VITE_CODEX_RUNTIME=wasm npm run dev -- --host {{host}} --port {{port}}

wasm-dev-ready host="127.0.0.1" port="4173":
    just wasm-runtime-pull
    just wasm-dev host={{host}} port={{port}}
