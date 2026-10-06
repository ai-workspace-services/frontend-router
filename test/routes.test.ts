import { describe, expect, it } from 'vitest';

import { isStaticAsset, routeForPath, staticSectionForPath } from '../src/routes';

describe('frontend route table', () => {
  it.each(['catalog', 'plans', 'mcp'])('routes only exact Operations %s endpoint to Console', (endpoint) => {
    expect(routeForPath(`/api/operations/${endpoint}`)).toBe('ssr-console');
    expect(routeForPath(`/api/operations/${endpoint}/extra`)).toBe('api');
    expect(routeForPath(`/api/operations/${endpoint}evil`)).toBe('api');
  });

  it('does not allow future Operations execution or dispatch routes implicitly', () => {
    expect(routeForPath('/api/operations/execute')).toBe('api');
    expect(routeForPath('/api/operations/dispatch')).toBe('api');
  });
  it.each([
    ['/_next/static/chunks/app.js', 'static'],
    ['/assets/logo.svg', 'static'],
    ['/favicon.ico', 'static'],
    ['/_edge/public/_next/static/chunks/app.css', 'ssr-public'],
    ['/_edge/content/_next/static/chunks/app.js', 'ssr-content'],
    ['/_edge/auth/_next/static/chunks/app.css', 'ssr-auth'],
    ['/_edge/console/_next/static/chunks/app.js', 'ssr-console'],
    ['/_edge/workspace/_next/static/chunks/app.css', 'ssr-workspace'],
    ['/api/auth/mfa/setup', 'ssr-auth'],
    ['/api/auth/mfa/status', 'ssr-auth'],
    ['/api/auth/mfa/verify', 'ssr-auth'],
    ['/api/auth/mfa/disable', 'ssr-auth'],
    ['/api/auth/login', 'ssr-auth'],
    ['/api/auth/register', 'ssr-auth'],
    ['/api/auth/register/send', 'ssr-auth'],
    ['/api/auth/register/verify', 'ssr-auth'],
    ['/api/auth/verify-email', 'ssr-auth'],
    ['/api/auth/verify-email/send', 'ssr-auth'],
    ['/api/v1/auth/session', 'api-auth'],
    ['/api/auth/token/exchange', 'ssr-auth'],
    ['/api/auth/token/exchange/extra', 'api-auth'],
    ['/api/auth/session', 'ssr-auth'],
    ['/api/agent-server/v1/nodes', 'ssr-console'],
    ['/api/agent-server/v1/regional-pools', 'ssr-console'],
    ['/api/agent/nodes', 'ssr-console'],
    ['/api/account/policy', 'ssr-console'],
    ['/api/account/usage/summary', 'ssr-console'],
    ['/api/xconnect-zero/overview', 'ssr-console'],
    ['/api/xconnect-zero/networks', 'ssr-console'],
    ['/api/xconnect-zero/devices', 'ssr-console'],
    ['/api/xconnect-zero/invites', 'ssr-console'],
    ['/api/xconnect-zero/networks/bootstrap', 'ssr-console'],
    ['/api/xconnect-zero/invites/create', 'ssr-console'],
    ['/api/xconnect-zero/devices/device-123/revoke', 'ssr-console'],
    ['/api/xconnect-zero/networks/network-123/policy', 'ssr-console'],
    ['/api/xconnect-zeroevil/overview', 'api'],
    ['/api/global-mesh/nodes', 'ssr-public'],
    ['/api/v1/docs/pages/guide', 'api'],
    ['/login', 'ssr-auth'],
    ['/register/complete', 'ssr-auth'],
    ['/blogs/edge-routing', 'ssr-content'],
    ['/docs/architecture', 'ssr-content'],
    ['/panel/account', 'ssr-console'],
    ['/dashboard/cms', 'ssr-console'],
    ['/ai-workspace/conversation/42', 'ssr-workspace'],
    ['/xworkmate', 'ssr-workspace'],
    ['/about', 'ssr-public'],
  ] as const)('routes %s to %s', (pathname, expected) => {
    expect(routeForPath(pathname)).toBe(expected);
  });

  it('does not classify ordinary page paths as static assets', () => {
    expect(isStaticAsset('/products/xconnect')).toBe(false);
    expect(isStaticAsset('/download')).toBe(false);
  });
});

describe('static content sections', () => {
  it.each([
    ['/blogs', 'blogs'],
    ['/blogs/edge-routing', 'blogs'],
    ['/docs', 'docs'],
    ['/docs/01-console/overview', 'docs'],
    ['/products', 'products'],
    ['/products/xconnect', 'products'],
    ['/support', 'support'],
    ['/support/discussions', 'support'],
  ] as const)('maps %s to the %s section', (pathname, expected) => {
    expect(staticSectionForPath(pathname)).toBe(expected);
  });

  it.each([
    '/download',
    '/panel/account',
    '/about',
    '/blogsomething',
    '/api/docs/search',
    '/_edge/content/_next/static/chunks/app.js',
  ])('leaves %s outside every section', (pathname) => {
    expect(staticSectionForPath(pathname)).toBeUndefined();
  });
});

it('routes only the fixed release evidence BFF to Console', () => {
  expect(routeForPath('/api/operations/releases')).toBe('ssr-console');
  expect(routeForPath('/api/operations/releases/dispatch')).toBe('api');
});
