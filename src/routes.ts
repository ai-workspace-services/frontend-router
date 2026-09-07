import type { FrontendRoute } from './types';

const STATIC_PREFIXES = ['/_next/', '/static/', '/assets/'] as const;
const STATIC_DOCUMENTS = new Set(['/favicon.ico', '/robots.txt', '/sitemap.xml']);
const STATIC_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|txt|webp|woff2?|xml)$/i;

const AUTH_PREFIXES = ['/login', '/register', '/email-verification', '/logout'] as const;
// Authentication APIs are implemented by the Accounts gateway auth boundary,
// not the identity-page SSR Worker. Keep these ahead of the generic /api/*
// route so a Console request reaches the auth gateway service binding.
const AUTH_API_PREFIXES = ['/api/auth', '/api/v1/auth'] as const;
// These Portal BFF endpoints must reach the auth SSR Worker. They convert the
// Accounts response into browser cookies or a same-origin normalized session
// response instead of making the browser depend on the raw Accounts contract.
const MFA_BFF_PREFIX = '/api/auth/mfa';
// Token exchange and session lookup are intentionally served by the Portal BFF.
// Exchange converts the Accounts response into the Console's HttpOnly session
// cookie; session lookup converts the opaque cookie into the normalized Portal
// user response. Keeping both same-origin avoids leaking either backend
// contract into the browser boundary.
const PORTAL_BFF_AUTH_PATHS = ['/api/auth/token/exchange', '/api/auth/session'] as const;
// User-facing agent discovery also belongs to the Portal BFF. It translates
// the browser's HttpOnly account cookie into an explicit session header before
// calling Accounts; routing these paths to the generic API origin can produce
// a false `session token is invalid or expired` response for an otherwise
// authenticated Console session.
const PORTAL_BFF_AGENT_PATHS = ['/api/agent-server/v1/nodes', '/api/agent/nodes'] as const;
const CONTENT_PREFIXES = ['/blogs', '/docs', '/download'] as const;
const CONSOLE_PREFIXES = ['/panel', '/dashboard'] as const;
const WORKSPACE_PREFIXES = ['/ai-workspace', '/cloud_iac', '/editor', '/support', '/xworkmate'] as const;
const BOUNDARY_ASSET_ROUTES: ReadonlyArray<readonly [string, FrontendRoute]> = [
  ['/_edge/auth', 'ssr-auth'],
  ['/_edge/content', 'ssr-content'],
  ['/_edge/console', 'ssr-console'],
  ['/_edge/workspace', 'ssr-workspace'],
  ['/_edge/public', 'ssr-public'],
];

// Content sections that can be served as a prebuilt static site instead of by
// an SSR boundary. Order matters only for readability: the prefixes are
// disjoint.
export const STATIC_SECTIONS = ['blogs', 'docs', 'products', 'support'] as const;

export type StaticSection = (typeof STATIC_SECTIONS)[number];

const STATIC_SECTION_PREFIXES: ReadonlyArray<readonly [string, StaticSection]> = [
  ['/blogs', 'blogs'],
  ['/docs', 'docs'],
  ['/products', 'products'],
  ['/support', 'support'],
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchesAnyPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isStaticAsset(pathname: string): boolean {
  return (
    STATIC_DOCUMENTS.has(pathname) ||
    STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    STATIC_EXTENSION.test(pathname)
  );
}

/**
 * The content section a path belongs to, or undefined when it belongs to none.
 * Whether that section is actually served statically depends on its origin
 * being configured; see `staticOriginFor` in index.ts.
 */
export function staticSectionForPath(pathname: string): StaticSection | undefined {
  if (matchesAnyPrefix(pathname, ['/api', '/_edge', '/_next'])) return undefined;
  return STATIC_SECTION_PREFIXES.find(([prefix]) => matchesPrefix(pathname, prefix))?.[1];
}

export function routeForPath(pathname: string): FrontendRoute {
  const boundaryRoute = BOUNDARY_ASSET_ROUTES.find(([prefix]) => matchesPrefix(pathname, prefix));
  if (boundaryRoute) return boundaryRoute[1];
  if (matchesPrefix(pathname, MFA_BFF_PREFIX)) return 'ssr-auth';
  if (PORTAL_BFF_AUTH_PATHS.some((path) => path === pathname)) {
    return 'ssr-auth';
  }
  if (PORTAL_BFF_AGENT_PATHS.some((path) => matchesPrefix(pathname, path))) {
    return 'ssr-console';
  }
  if (matchesAnyPrefix(pathname, AUTH_API_PREFIXES)) return 'api-auth';
  if (isStaticAsset(pathname)) return 'static';
  if (matchesPrefix(pathname, '/api')) return 'api';
  if (matchesAnyPrefix(pathname, AUTH_PREFIXES)) return 'ssr-auth';
  if (matchesAnyPrefix(pathname, CONTENT_PREFIXES)) return 'ssr-content';
  if (matchesAnyPrefix(pathname, CONSOLE_PREFIXES)) return 'ssr-console';
  if (matchesAnyPrefix(pathname, WORKSPACE_PREFIXES)) return 'ssr-workspace';
  return 'ssr-public';
}
