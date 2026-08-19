#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${FRONTEND_ROUTER_CONFIG_FILE:-${CLOUDFLARE_BOUNDARY_CONFIG:-}}"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }
test -n "${CONFIG_FILE}" || { echo "FRONTEND_ROUTER_CONFIG_FILE is required" >&2; exit 2; }
test -f "${CONFIG_FILE}" || { echo "frontend-router config not found: ${CONFIG_FILE}" >&2; exit 2; }

jq -e '
  .kind == "EdgeRoutingConfig"
  and .metadata.mode == "serverless"
  and .spec.runtime.mode == "serverless"
  and (.spec.serverless.frontend_router | type == "object")
' "${CONFIG_FILE}" >/dev/null || {
  echo "GitOps config must define a serverless frontend_router contract" >&2
  exit 2
}

worker_name="$(jq -er '.spec.serverless.frontend_router.worker_name' "${CONFIG_FILE}")"
router_host="$(jq -er '.spec.serverless.frontend_router.host' "${CONFIG_FILE}")"
console_host="$(jq -er '.spec.serverless.console_host' "${CONFIG_FILE}")"
pages_origin="$(jq -er '.spec.serverless.frontend_router.pages_origin' "${CONFIG_FILE}")"
api_origin="$(jq -er '.spec.serverless.frontend_router.api_origin' "${CONFIG_FILE}")"

if [[ "${router_host}" != "${console_host}" ]]; then
  echo "frontend_router.host must match serverless.console_host" >&2
  exit 2
fi

generated_config="$(mktemp "${PWD}/.wrangler.frontend-router.XXXXXX.json")"
trap 'rm -f "${generated_config}"' EXIT

jq -n \
  --arg name "${worker_name}" \
  --arg pages_origin "${pages_origin}" \
  --arg api_origin "${api_origin}" \
  --arg api_auth "$(jq -er '.spec.serverless.frontend_router.bindings.api_auth' "${CONFIG_FILE}")" \
  --arg auth "$(jq -er '.spec.serverless.frontend_router.bindings.auth' "${CONFIG_FILE}")" \
  --arg content "$(jq -er '.spec.serverless.frontend_router.bindings.content' "${CONFIG_FILE}")" \
  --arg console "$(jq -er '.spec.serverless.frontend_router.bindings.console' "${CONFIG_FILE}")" \
  --arg workspace "$(jq -er '.spec.serverless.frontend_router.bindings.workspace' "${CONFIG_FILE}")" \
  --arg public "$(jq -er '.spec.serverless.frontend_router.bindings.public' "${CONFIG_FILE}")" \
  '{
    name: $name,
    main: "src/index.ts",
    compatibility_date: "2026-08-18",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      PAGES_ORIGIN: $pages_origin,
      API_ORIGIN: $api_origin
    },
    services: [
      {binding: "API_AUTH", service: $api_auth},
      {binding: "SSR_AUTH", service: $auth},
      {binding: "SSR_CONTENT", service: $content},
      {binding: "SSR_CONSOLE", service: $console},
      {binding: "SSR_WORKSPACE", service: $workspace},
      {binding: "SSR_PUBLIC", service: $public}
    ],
    observability: {enabled: true}
  }' >"${generated_config}"

echo "==> Deploying ${worker_name}; Custom Domain reconciliation is owned by platform-ops-toolkit."
npx wrangler deploy --config "${generated_config}"
