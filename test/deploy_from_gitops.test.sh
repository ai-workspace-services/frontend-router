#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

mkdir -p "${test_dir}/bin"
cat >"${test_dir}/routing.json" <<'EOF'
{
  "kind": "EdgeRoutingConfig",
  "metadata": {"mode": "serverless"},
  "spec": {
    "runtime": {"mode": "serverless"},
    "serverless": {
      "console_host": "console-cloudflare-uat.onwalk.net",
      "frontend_router": {
        "worker_name": "frontend-router-uat",
        "host": "console-cloudflare-uat.onwalk.net",
        "pages_origin": "https://ai-workspace-portal-uat.pages.dev",
        "api_origin": "https://accounts-cloudflare-uat.onwalk.net",
        "static_sections": {
          "blogs": "https://ai-workspace-portal-uat.pages.dev",
          "docs": "https://ai-workspace-docs-uat.pages.dev",
          "support": ""
        },
        "bindings": {
          "api_auth": "edge-gateway-auth-uat",
          "auth": "frontend-ssr-auth-uat",
          "content": "frontend-ssr-content-uat",
          "console": "frontend-ssr-console-uat",
          "workspace": "frontend-ssr-workspace-uat",
          "public": "frontend-ssr-public-uat"
        }
      }
    }
  }
}
EOF

cat >"${test_dir}/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

test "$1" = "wrangler"
test "$2" = "deploy"
test "$3" = "--config"
cp "$4" "${MOCK_WRANGLER_CONFIG}"
EOF
chmod +x "${test_dir}/bin/npx"

pushd "${repo_root}" >/dev/null
PATH="${test_dir}/bin:${PATH}" \
MOCK_WRANGLER_CONFIG="${test_dir}/wrangler.json" \
CLOUDFLARE_API_TOKEN="test-token" \
CLOUDFLARE_ACCOUNT_ID="account-1" \
FRONTEND_ROUTER_CONFIG_FILE="${test_dir}/routing.json" \
./scripts/deploy_from_gitops.sh >/dev/null
popd >/dev/null

jq -e '
  .name == "frontend-router-uat"
  and .vars.PAGES_ORIGIN == "https://ai-workspace-portal-uat.pages.dev"
  and .vars.API_ORIGIN == "https://accounts-cloudflare-uat.onwalk.net"
  and ([.services[].binding] | sort) == ["API_AUTH", "SSR_AUTH", "SSR_CONSOLE", "SSR_CONTENT", "SSR_PUBLIC", "SSR_WORKSPACE"]
' "${test_dir}/wrangler.json" >/dev/null

# A declared section becomes its own origin var; sections may point at different
# Pages projects, and an empty declaration must not be rendered at all — an
# absent var is what keeps a section on its SSR boundary.
jq -e '
  .vars.PAGES_ORIGIN_BLOGS == "https://ai-workspace-portal-uat.pages.dev"
  and .vars.PAGES_ORIGIN_DOCS == "https://ai-workspace-docs-uat.pages.dev"
  and (has("vars") and (.vars | has("PAGES_ORIGIN_SUPPORT")) == false)
  and (.vars | has("PAGES_ORIGIN_PRODUCTS")) == false
' "${test_dir}/wrangler.json" >/dev/null

echo "deploy_from_gitops.test: PASS"
