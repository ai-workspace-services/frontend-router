import type { FrontendRoute } from './types';

const STATIC_PREFIXES = ['/_next/', '/static/', '/assets/'] as const;
const STATIC_DOCUMENTS = new Set(['/favicon.ico', '/robots.txt', '/sitemap.xml']);
const STATIC_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|txt|webp|woff2?|xml)$/i;

const AUTH_PREFIXES = ['/login', '/register', '/email-verification', '/logout'] as const;
// Authentication APIs are implemented by the Accounts gateway auth boundary,
// not the identity-page SSR Worker. Keep these ahead of the generic /api/*
// route so a Console request reaches the auth gateway service binding.
const AUTH_API_PREFIXES = ['/api/auth', '/api/v1/auth'] as const;
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

export function routeForPath(pathname: string): FrontendRoute {
  const boundaryRoute = BOUNDARY_ASSET_ROUTES.find(([prefix]) => matchesPrefix(pathname, prefix));
  if (boundaryRoute) return boundaryRoute[1];
  if (matchesAnyPrefix(pathname, AUTH_API_PREFIXES)) return 'api-auth';
  if (isStaticAsset(pathname)) return 'static';
  if (matchesPrefix(pathname, '/api')) return 'api';
  if (matchesAnyPrefix(pathname, AUTH_PREFIXES)) return 'ssr-auth';
  if (matchesAnyPrefix(pathname, CONTENT_PREFIXES)) return 'ssr-content';
  if (matchesAnyPrefix(pathname, CONSOLE_PREFIXES)) return 'ssr-console';
  if (matchesAnyPrefix(pathname, WORKSPACE_PREFIXES)) return 'ssr-workspace';
  return 'ssr-public';
}
