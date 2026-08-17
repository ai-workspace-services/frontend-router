import { describe, expect, it } from 'vitest';

import { isStaticAsset, routeForPath } from '../src/routes';

describe('frontend route table', () => {
  it.each([
    ['/_next/static/chunks/app.js', 'static'],
    ['/assets/logo.svg', 'static'],
    ['/favicon.ico', 'static'],
    ['/api/auth/login', 'api'],
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
