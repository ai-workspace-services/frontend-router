# Frontend Router

`frontend-router` is the Cloudflare Worker ingress for `console.svc.plus`. It is deliberately separate from [`edge-gateway`](https://github.com/ai-workspace-services/edge-gateway): this Worker owns frontend dispatch, while `edge-gateway` owns API authentication, service routing, CORS, and Cloud Run failover.

## Request ownership

| Request | Target |
| --- | --- |
| `/_next/*`, `/static/*`, `/assets/*`, static documents and media | Cloudflare Pages through `PAGES_ORIGIN` |
| `/api/auth/*`, `/api/v1/auth/*` on the Console domain | `API_AUTH` Service Binding (`edge-gateway-auth`) |
| Other `/api/*` requests | Accounts Edge Gateway through `API_ORIGIN` |
| Auth pages | `SSR_AUTH` Service Binding |
| Content pages | `SSR_CONTENT` Service Binding |
| Console pages | `SSR_CONSOLE` Service Binding |
| Workspace pages | `SSR_WORKSPACE` Service Binding |
| Other UI pages | `SSR_PUBLIC` Service Binding |

## Statically published content sections

`/blogs`, `/docs`, `/products` and `/support` can each be served from a prebuilt
static site instead of their SSR boundary. A section is redirected there only
when its origin is configured, through GitOps
`spec.serverless.frontend_router.static_sections.<section>`:

| Declaration | Result |
| --- | --- |
| absent or empty | the section stays on its SSR boundary — this is the rollback |
| the shared Pages origin | served from the shared static site |
| a section-specific Pages origin | that section is published on its own cadence, independently of the others and of the main site |

The sections are prefix-matched, so a declared section takes every path beneath
it. Publish the section before declaring its origin.

The complete environment and migration contract is documented in [Console Frontend Router 与 Edge Gateway 目标架构及实施计划](https://github.com/ai-workspace-services/knowledge/blob/main/docs/zh/frontend-edge-routing-target-architecture.md).

## Local development

```bash
cp .dev.vars.example .dev.vars
npm install
npm run check
npm run dev
```

`wrangler.toml` intentionally contains no production domain, Worker name suffix, origin, or Service Binding. The platform orchestrator must render them from GitOps at deployment time.

## GitOps deployment

`scripts/deploy_from_gitops.sh` is the only deployment entrypoint. It reads the rendered
`EdgeRoutingConfig` from `FRONTEND_ROUTER_CONFIG_FILE`, generates a temporary Wrangler config
with the five SSR Service Bindings, and deploys the named Worker. It deliberately does **not**
attach a Custom Domain; `platform-ops-toolkit` owns that later reconciliation step.

## Deployment boundary

Do not manually attach `console.svc.plus` to this Worker before the GitOps frontend-router contract and UAT canary are ready. Pages currently owns the Console custom domain; the migration must first deploy this Worker to a temporary UAT hostname and verify the static, SSR, API, and Cookie acceptance matrix.

## Homepage-only brand domains

GitOps `frontend_router.website.hosts` declares homepage-only domains, rendered
as `WEBSITE_HOSTS`. They serve `/` and homepage assets in place. Other GET/HEAD
paths redirect to `website.platform_origin` (`PLATFORM_ORIGIN`) with the path
and query preserved. Non-read requests return 421 without reaching a service
binding, so login/API mutations must be submitted directly to the platform.
The production contract uses xworktech.com and www.xworktech.com for the homepage,
and https://svc.plus for platform navigation. Unconfigured environments retain
the existing full frontend dispatch.
