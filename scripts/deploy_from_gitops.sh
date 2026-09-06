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

# Per-section static origins. GitOps declares
# `frontend_router.static_sections.<section>` for every content section that is
# published as a prebuilt site; a section that is absent stays on its SSR
# boundary, which is both the rollout switch and the rollback. Declaring a
# different origin per section is what lets them be published independently.
static_section_vars="$(jq -c '
  (.spec.serverless.frontend_router.static_sections // {})
  | to_entries
  | map(select(.value | type == "string" and (. | length) > 0))
  | map({key: ("PAGES_ORIGIN_" + (.key | ascii_upcase)), value: .value})
  | from_entries
' "${CONFIG_FILE}")"

static_cache_ttl="$(jq -r '.spec.serverless.frontend_router.static_cache_ttl // "604800"' "${CONFIG_FILE}")"
public_cache_ttl="$(jq -r '.spec.serverless.frontend_router.public_cache_ttl // "3600"' "${CONFIG_FILE}")"

jq -n \
  --arg name "${worker_name}" \
  --arg website_hosts "$(jq -r '(.spec.serverless.frontend_router.website.hosts // []) | join(",")' "${CONFIG_FILE}")" \
  --arg platform_origin "$(jq -r '.spec.serverless.frontend_router.website.platform_origin // empty' "${CONFIG_FILE}")" \
  --arg pages_origin "${pages_origin}" \
  --arg api_origin "${api_origin}" \
  --arg static_cache_ttl "${static_cache_ttl}" \
  --arg public_cache_ttl "${public_cache_ttl}" \
  --arg api_auth "$(jq -er '.spec.serverless.frontend_router.bindings.api_auth' "${CONFIG_FILE}")" \
  --argjson static_sections "${static_section_vars}" \
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
    vars: ({
      WEBSITE_HOSTS: $website_hosts,
      PLATFORM_ORIGIN: $platform_origin,
      PAGES_ORIGIN: $pages_origin,
      API_ORIGIN: $api_origin,
      STATIC_CACHE_TTL: ($static_cache_ttl | tostring),
      PUBLIC_CACHE_TTL: ($public_cache_ttl | tostring)
    } + $static_sections),
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
