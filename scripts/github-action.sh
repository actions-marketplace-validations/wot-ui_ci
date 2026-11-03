#!/usr/bin/env bash
set -euo pipefail

working_directory="${INPUT_WORKING_DIRECTORY:-.}"
cd "$working_directory"

if [ "${INPUT_INSTALL_DEPENDENCIES:-false}" = "true" ]; then
  if [ -f pnpm-lock.yaml ]; then
    if ! command -v pnpm >/dev/null 2>&1; then
      corepack enable
    fi
    pnpm install --frozen-lockfile
  elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
    yarn install --frozen-lockfile
  elif [ -f package-lock.json ]; then
    npm ci
  elif [ -f bun.lockb ] && command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile
  else
    npm install
  fi
fi

read -r -a command_parts <<< "${INPUT_COMMAND:-upload}"
args=("${command_parts[@]}")

if [ -n "${INPUT_PLATFORM:-}" ]; then
  args+=("-p" "$INPUT_PLATFORM")
fi

if [ -n "${INPUT_CONFIG:-}" ]; then
  args+=("-c" "$INPUT_CONFIG")
fi

case "${INPUT_JSON:-false}" in
  true|1) args+=("--json") ;;
esac

case "${INPUT_DRY_RUN:-false}" in
  true|1) args+=("--dry-run") ;;
esac

case "${INPUT_NETWORK:-false}" in
  true|1) args+=("--network") ;;
esac

case "${INPUT_YES:-false}" in
  true|1) args+=("--yes") ;;
esac

if [ -n "${INPUT_VERSION:-}" ]; then
  args+=("--version" "$INPUT_VERSION")
fi

case "${INPUT_PR_COMMENT:-auto}" in
  true|1) args+=("--pr-comment") ;;
  false|0) args+=("--no-pr-comment") ;;
esac

case "${INPUT_HISTORY:-auto}" in
  false|0) args+=("--no-history") ;;
esac

case "${command_parts[0]}" in
  upload|preview|release)
    if [ -n "${INPUT_SUMMARY:-}" ]; then
      args+=("--summary" "$INPUT_SUMMARY")
    fi
    ;;
esac

if [ -n "${INPUT_ARGS:-}" ]; then
  read -r -a extra_args <<< "$INPUT_ARGS"
  args+=("${extra_args[@]}")
fi

if [ -x "./node_modules/.bin/wotci" ]; then
  cli=("./node_modules/.bin/wotci")
else
  cli=("npx" "--yes" "@wot-ui/ci@${INPUT_PACKAGE_VERSION:-latest}")
fi

echo "[wotci-action] ${cli[*]} ${args[*]}"
"${cli[@]}" "${args[@]}"
