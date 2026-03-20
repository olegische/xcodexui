#!/usr/bin/env bash
set -euo pipefail

TMP_DIR=""

usage() {
  cat <<'EOF'
Usage: prepare-wasm-runtime.sh

Downloads and prepares:
- xcodex wasm browser bundle into public/pkg
- xrouter-browser assets into public/xrouter-browser

Environment:
  XCODEX_WASM_TARBALL      Optional. Defaults to the public xcodex-wasm release tarball.
  XROUTER_BROWSER_TARBALL  Optional. Defaults to the public xrouter-browser release tarball.
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

download_if_url() {
  local source="$1"
  local target="$2"
  if [[ "${source}" =~ ^https?:// ]]; then
    curl -L "${source}" -o "${target}"
  else
    cp "${source}" "${target}"
  fi
}

find_dir_with_files() {
  local root="$1"
  shift
  python3 - "$root" "$@" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
required = sys.argv[2:]

for candidate in sorted([p for p in root.rglob("*") if p.is_dir()]):
    names = {child.name for child in candidate.iterdir()}
    if all(item in names for item in required):
        print(candidate)
        sys.exit(0)

sys.exit(1)
PY
}

prepare_current_dir() {
  local source_dir="$1"
  local target_root="$2"
  local current_dir="${target_root}/current"

  rm -rf "${current_dir}"
  mkdir -p "${current_dir}"
  cp -R "${source_dir}/." "${current_dir}/"
}

write_manifest() {
  local manifest_path="$1"
  local build_id="$2"
  local entry_path="$3"
  local wasm_path="$4"

  mkdir -p "$(dirname "${manifest_path}")"
  cat > "${manifest_path}" <<EOF
{
  "buildId": "${build_id}",
  "entry": "${entry_path}",
  "wasm": "${wasm_path}"
}
EOF
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_command curl
  require_command tar
  require_command python3

  local script_dir project_root
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  project_root="$(cd "${script_dir}/.." && pwd)"

  local xcodex_wasm_tarball="${XCODEX_WASM_TARBALL:-https://github.com/olegische/xcodex/releases/download/xcodex-wasm/xcodex-wasm.tar.gz}"
  local xrouter_browser_tarball="${XROUTER_BROWSER_TARBALL:-https://github.com/olegische/xrouter/releases/download/xrouter-browser-main/xrouter-browser-main.tar.gz}"

  local public_pkg_root="${project_root}/public/pkg"
  local public_xrouter_root="${project_root}/public/xrouter-browser"

  TMP_DIR="$(mktemp -d)"
  trap '[[ -n "${TMP_DIR:-}" ]] && rm -rf "${TMP_DIR}"' EXIT

  local xcodex_tarball_path="${TMP_DIR}/xcodex-wasm.tar.gz"
  local xrouter_tarball_path="${TMP_DIR}/xrouter-browser.tar.gz"
  local xcodex_unpack_dir="${TMP_DIR}/xcodex-wasm"
  local xrouter_unpack_dir="${TMP_DIR}/xrouter-browser"

  mkdir -p "${xcodex_unpack_dir}" "${xrouter_unpack_dir}" "${public_pkg_root}" "${public_xrouter_root}"

  echo "Downloading xcodex-wasm tarball..."
  download_if_url "${xcodex_wasm_tarball}" "${xcodex_tarball_path}"

  echo "Downloading xrouter-browser tarball..."
  download_if_url "${xrouter_browser_tarball}" "${xrouter_tarball_path}"

  echo "Extracting xcodex-wasm tarball..."
  tar -xzf "${xcodex_tarball_path}" -C "${xcodex_unpack_dir}"

  echo "Extracting xrouter-browser tarball..."
  tar -xzf "${xrouter_tarball_path}" -C "${xrouter_unpack_dir}"

  local xcodex_bundle_dir xcodex_current_dir xrouter_pkg_dir
  xcodex_bundle_dir="$(find_dir_with_files "${xcodex_unpack_dir}" manifest.json current)"
  xcodex_current_dir="${xcodex_bundle_dir}/current"
  xrouter_pkg_dir="$(find_dir_with_files "${xrouter_unpack_dir}" xrouter_browser.js xrouter_browser_bg.wasm)"

  if [[ ! -f "${xcodex_bundle_dir}/manifest.json" ]]; then
    echo "xcodex-wasm tarball does not contain manifest.json" >&2
    exit 1
  fi
  if [[ ! -f "${xcodex_current_dir}/xcodex.js" || ! -f "${xcodex_current_dir}/xcodex_bg.wasm" ]]; then
    echo "xcodex-wasm tarball does not contain expected runtime bundle files" >&2
    exit 1
  fi

  echo "Installing wasm browser assets into public/pkg..."
  rm -rf "${public_pkg_root}"
  mkdir -p "${public_pkg_root}"
  prepare_current_dir "${xcodex_current_dir}" "${public_pkg_root}"
  python3 - "${xcodex_bundle_dir}/manifest.json" "${public_pkg_root}/manifest.json" <<'PY'
import json
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
manifest = json.loads(source.read_text())
target.write_text(json.dumps({
    "buildId": manifest.get("buildId", ""),
    "entry": "/pkg/current/xcodex.js",
    "wasm": "/pkg/current/xcodex_bg.wasm",
    "runtime": "/pkg/current/xcodex-runtime.js",
}, indent=2) + "\n")
PY

  echo "Installing xrouter-browser assets into public/xrouter-browser..."
  prepare_current_dir "${xrouter_pkg_dir}" "${public_xrouter_root}"
  local build_id
  build_id="$(date -u +%Y%m%d%H%M%S)"
  write_manifest \
    "${public_xrouter_root}/manifest.json" \
    "${build_id}" \
    "/xrouter-browser/current/xrouter_browser.js" \
    "/xrouter-browser/current/xrouter_browser_bg.wasm"

  echo "Prepared wasm runtime artifacts:"
  echo "  wasm manifest: ${public_pkg_root}/manifest.json"
  echo "  xrouter manifest: ${public_xrouter_root}/manifest.json"
}

main "$@"
