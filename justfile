set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

wasm-runtime-pull source="remote" xcodex_tarball="/Users/olegromanchuk/Projects/xcodex/dist/xcodex-wasm.tar.gz":
    #!/usr/bin/env bash
    case "{{source}}" in
      remote)
        bash scripts/prepare-wasm-runtime.sh
        ;;
      local)
        XCODEX_WASM_TARBALL="{{xcodex_tarball}}" bash scripts/prepare-wasm-runtime.sh
        ;;
      *)
        echo "Unsupported source: {{source}} (expected remote or local)" >&2
        exit 1
        ;;
    esac

wasm-dev host="127.0.0.1" port="4173":
    VITE_CODEX_RUNTIME=wasm npm run dev -- --host {{host}} --port {{port}}

wasm-dev-ready host="127.0.0.1" port="4173" source="remote" xcodex_tarball="/Users/olegromanchuk/Projects/xcodex/dist/xcodex-wasm.tar.gz":
    just wasm-runtime-pull source={{source}} xcodex_tarball={{xcodex_tarball}}
    just wasm-dev host={{host}} port={{port}}
