set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

wasm-runtime-pull xcodex_wasm_tarball="https://github.com/olegische/xcodex/releases/download/xcodex-wasm/xcodex-wasm.tar.gz" xrouter_browser_tarball="https://github.com/olegische/xrouter/releases/download/xrouter-browser-main/xrouter-browser-main.tar.gz" xcodex_runtime_tarball="":
    if [[ -z "{{xcodex_runtime_tarball}}" ]]; then \
      echo "XCODEX runtime SDK tarball is required."; \
      echo "Pass it as: just wasm-runtime-pull xcodex_runtime_tarball=/path/to/xcodex-runtime.tgz"; \
      exit 1; \
    fi
    XCODEX_RUNTIME_TARBALL="{{xcodex_runtime_tarball}}" node scripts/prepare-runtime-sdk.mjs
    XCODEX_WASM_TARBALL="{{xcodex_wasm_tarball}}" XROUTER_BROWSER_TARBALL="{{xrouter_browser_tarball}}" npm run prepare:wasm-assets

wasm-dev host="127.0.0.1" port="4173":
    VITE_CODEX_RUNTIME=wasm npm run dev -- --host {{host}} --port {{port}}

wasm-dev-ready host="127.0.0.1" port="4173" xcodex_wasm_tarball="https://github.com/olegische/xcodex/releases/download/xcodex-wasm/xcodex-wasm.tar.gz" xrouter_browser_tarball="https://github.com/olegische/xrouter/releases/download/xrouter-browser-main/xrouter-browser-main.tar.gz" xcodex_runtime_tarball="":
    just wasm-runtime-pull xcodex_wasm_tarball={{xcodex_wasm_tarball}} xrouter_browser_tarball={{xrouter_browser_tarball}} xcodex_runtime_tarball={{xcodex_runtime_tarball}}
    just wasm-dev host={{host}} port={{port}}
