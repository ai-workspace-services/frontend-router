import { describe, expect, it, vi } from 'vitest';

import worker from '../src/index';
import type { Env, WorkerServiceBinding } from '../src/types';

function binding(response: Response): WorkerServiceBinding {
  return { fetch: vi.fn().mockResolvedValue(response) };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    PAGES_ORIGIN: 'https://portal.pages.dev',
    API_ORIGIN: 'https://accounts.example.test',
    API_AUTH: binding(new Response('api-auth')),
    SSR_AUTH: binding(new Response('auth')),
    SSR_CONTENT: binding(new Response('content')),
    SSR_CONSOLE: binding(new Response('console')),
    SSR_WORKSPACE: binding(new Response('workspace')),
    SSR_PUBLIC: binding(new Response('public')),
    ...overrides,
  };
}

describe('frontend-router worker', () => {
  it('dispatches a console route to its SSR binding', async () => {
    const runtime = env();
    const response = await worker.fetch(new Request('https://console.example.test/panel/account'), runtime);

    expect(await response.text()).toBe('console');
    expect(response.headers.get('X-Frontend-Route')).toBe('ssr-console');
    expect(runtime.SSR_CONSOLE?.fetch).toHaveBeenCalledOnce();
    const forwarded = vi.mocked(runtime.SSR_CONSOLE!.fetch).mock.calls[0][0];
    expect(forwarded.headers.get('X-Forwarded-Host')).toBe('console.example.test');
  });

  it('serves crawler metadata on a console alias', async () => {
    const runtime = env();
    const response = await worker.fetch(new Request('https://console.onwalk.net/sitemap.xml'), runtime);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/xml');
    expect(await response.text()).toContain('<loc>https://console.onwalk.net/privacy</loc>');
    expect(runtime.SSR_PUBLIC?.fetch).not.toHaveBeenCalled();
  });

  it('keeps a content section on its SSR boundary until an origin is configured', async () => {
    const runtime = env();
    const response = await worker.fetch(new Request('https://console.example.test/blogs/edge-routing'), runtime);

    expect(await response.text()).toBe('content');
    expect(response.headers.get('X-Frontend-Route')).toBe('ssr-content');
  });

  it('serves a configured content section from its own static origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('static blogs'));
    try {
      const runtime = env({ PAGES_ORIGIN_BLOGS: 'https://blogs.pages.dev' });
      const response = await worker.fetch(new Request('https://console.example.test/blogs/edge-routing'), runtime);

      expect(await response.text()).toBe('static blogs');
      expect(response.headers.get('X-Frontend-Route')).toBe('static');
      expect(runtime.SSR_CONTENT?.fetch).not.toHaveBeenCalled();
      const forwarded = fetchSpy.mock.calls[0][0] as Request;
      expect(forwarded.url).toBe('https://blogs.pages.dev/blogs/edge-routing');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('leaves the other sections alone when one is published statically', async () => {
    const runtime = env({ PAGES_ORIGIN_BLOGS: 'https://blogs.pages.dev' });
    const response = await worker.fetch(new Request('https://console.example.test/docs/01-console/overview'), runtime);

    expect(await response.text()).toBe('content');
    expect(response.headers.get('X-Frontend-Route')).toBe('ssr-content');
  });

  it('sends boundary-prefixed build assets back to the owning SSR binding', async () => {
    const runtime = env();
    const response = await worker.fetch(
      new Request('https://console.example.test/_edge/public/_next/static/chunks/app.css'),
      runtime,
    );

    expect(await response.text()).toBe('public');
    expect(response.headers.get('X-Frontend-Route')).toBe('ssr-public');
    expect(runtime.SSR_PUBLIC?.fetch).toHaveBeenCalledOnce();
  });

  it('dispatches browser login through the Portal auth BFF', async () => {
    const runtime = env();
    const response = await worker.fetch(
      new Request('https://console.example.test/api/auth/login', { method: 'POST', body: '{}' }),
      runtime,
    );

    expect(await response.text()).toBe('auth');
    expect(response.headers.get('X-Frontend-Route')).toBe('ssr-auth');
    expect(runtime.SSR_AUTH?.fetch).toHaveBeenCalledOnce();
    const forwarded = vi.mocked(runtime.SSR_AUTH!.fetch).mock.calls[0][0];
    expect(forwarded.headers.get('X-Frontend-Route')).toBe('ssr-auth');
  });

  it.each([
    ['GET', '/api/xconnect-zero/overview'],
    ['GET', '/api/xconnect-zero/networks'],
    ['GET', '/api/xconnect-zero/devices'],
    ['GET', '/api/xconnect-zero/invites'],
    ['POST', '/api/xconnect-zero/networks/bootstrap'],
    ['POST', '/api/xconnect-zero/invites'],
    ['POST', '/api/xconnect-zero/devices/device-123/revoke'],
    ['PUT', '/api/xconnect-zero/networks/network-123/policy'],
  ] as const)('dispatches XConnect Zero BFF %s %s through the Console SSR binding', async (method, path) => {
    const runtime = env();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('generic API origin must not be called'));
    try {
      const response = await worker.fetch(
        new Request(`https://console.example.test${path}`, {
          method,
          headers: { Cookie: 'xc_session=opaque-session' },
          body: method === 'GET' ? undefined : '{}',
        }),
        runtime,
      );

      expect(await response.text()).toBe('console');
      expect(response.headers.get('X-Frontend-Route')).toBe('ssr-console');
      expect(runtime.SSR_CONSOLE?.fetch).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
      const forwarded = vi.mocked(runtime.SSR_CONSOLE!.fetch).mock.calls[0][0];
      expect(forwarded.url).toBe(`https://console.example.test${path}`);
      expect(forwarded.headers.get('Cookie')).toBe('xc_session=opaque-session');
      expect(forwarded.headers.get('X-Forwarded-Host')).toBe('console.example.test');
      expect(forwarded.headers.get('X-Frontend-Route')).toBe('ssr-console');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps a similarly named non-BFF API path on the generic Accounts origin', async () => {
    const runtime = env();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gateway'));
    try {
      const response = await worker.fetch(
        new Request('https://console.example.test/api/xconnect-zeroevil/overview'),
        runtime,
      );

      expect(await response.text()).toBe('gateway');
      expect(response.headers.get('X-Frontend-Route')).toBe('api');
      expect(runtime.SSR_CONSOLE?.fetch).not.toHaveBeenCalled();
      const forwarded = fetchSpy.mock.calls[0][0] as Request;
      expect(forwarded.url).toBe('https://accounts.example.test/api/xconnect-zeroevil/overview');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns a configuration error when the Portal auth BFF binding is missing', async () => {
    const response = await worker.fetch(
      new Request('https://console.example.test/api/auth/login'),
      env({ SSR_AUTH: undefined }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Service binding for ssr-auth is not configured' });
  });

  it('keeps versioned Accounts auth APIs on the auth gateway binding', async () => {
    const runtime = env();
    const response = await worker.fetch(
      new Request('https://console.example.test/api/v1/auth/session'),
      runtime,
    );

    expect(await response.text()).toBe('api-auth');
    expect(response.headers.get('X-Frontend-Route')).toBe('api-auth');
    expect(runtime.API_AUTH?.fetch).toHaveBeenCalledOnce();
  });

  it('proxies non-auth API requests through the configured Accounts gateway origin', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gateway'));
    const response = await worker.fetch(
      new Request('https://console.example.test/api/users', { method: 'GET' }),
      env(),
    );

    expect(await response.text()).toBe('gateway');
    expect(response.headers.get('X-Frontend-Route')).toBe('api');
    const forwarded = fetchMock.mock.calls[0][0] as Request;
    expect(forwarded.url).toBe('https://accounts.example.test/api/users');
    expect(forwarded.headers.get('X-Frontend-Route')).toBe('api');
    fetchMock.mockRestore();
  });

  it('returns a configuration error instead of falling through to SSR for API paths', async () => {
    const runtime = env({ API_ORIGIN: undefined });
    const response = await worker.fetch(new Request('https://console.example.test/api/users'), runtime);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'API origin is not configured' });
    expect(runtime.SSR_PUBLIC?.fetch).not.toHaveBeenCalled();
  });

  it('redirects /dashboard and /dashboard/ to /panel with 301', async () => {
    const response = await worker.fetch(new Request('https://console.example.test/dashboard?foo=bar'), env());

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://console.example.test/panel?foo=bar');
  });

  it('enriches static responses with immutable Cache-Control when upstream returns weak cache', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('image data', {
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
      }),
    );
    try {
      const response = await worker.fetch(
        new Request('https://console.example.test/marketing/logo.svg'),
        env(),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=604800, s-maxage=604800, immutable');
      expect(response.headers.get('X-Frontend-Route')).toBe('static');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('respects custom STATIC_CACHE_TTL configured via GitOps / environment variables', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('css data', {
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=0' },
      }),
    );
    try {
      const response = await worker.fetch(
        new Request('https://console.example.test/_next/static/css/app.css'),
        env({ STATIC_CACHE_TTL: '86400' }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400, immutable');
      expect(response.headers.get('X-Frontend-Route')).toBe('static');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('brand domains', () => {
  const website = { WEBSITE_HOSTS: 'xworktech.com,www.xworktech.com', PLATFORM_ORIGIN: 'https://svc.plus' };

  for (const host of ['xworktech.com', 'www.xworktech.com']) {
    it(`serves the homepage on ${host}`, async () => {
      const runtime = env(website);
      const response = await worker.fetch(new Request(`https://${host}/?lang=zh`), runtime);
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
      expect(runtime.SSR_PUBLIC?.fetch).toHaveBeenCalledOnce();
    });
    for (const path of ['/about', '/privacy', '/terms', '/contact', '/support', '/privacy/']) {
      it(`serves ${host}${path} on the brand domain`, async () => {
        const runtime = env(website);
        const response = await worker.fetch(new Request(`https://${host}${path}`), runtime);
        expect(response.status).toBe(200);
        expect(response.headers.get('Location')).toBeNull();
        const expectedBinding = path.startsWith('/support') ? runtime.SSR_WORKSPACE : runtime.SSR_PUBLIC;
        expect(expectedBinding?.fetch).toHaveBeenCalledOnce();
      });
    }
    it(`serves crawler metadata on ${host} from the brand domain`, async () => {
      const runtime = env(website);
      const robots = await worker.fetch(new Request(`https://${host}/robots.txt`), runtime);
      const sitemap = await worker.fetch(new Request(`https://${host}/sitemap.xml`), runtime);

      expect(robots.status).toBe(200);
      expect(robots.headers.get('Content-Type')).toContain('text/plain');
      expect(robots.headers.get('Location')).toBeNull();
      expect(await robots.text()).toContain(`Sitemap: https://${host}/sitemap.xml`);

      expect(sitemap.status).toBe(200);
      expect(sitemap.headers.get('Content-Type')).toContain('application/xml');
      expect(sitemap.headers.get('Location')).toBeNull();
      expect(await sitemap.text()).toContain(`<loc>https://${host}/privacy</loc>`);
      expect(runtime.SSR_PUBLIC?.fetch).not.toHaveBeenCalled();
      expect(runtime.SSR_WORKSPACE?.fetch).not.toHaveBeenCalled();
    });
    it(`supports metadata HEAD requests on ${host}`, async () => {
      const runtime = env(website);
      const response = await worker.fetch(new Request(`https://${host}/sitemap.xml`, { method: 'HEAD' }), runtime);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/xml');
      expect(await response.text()).toBe('');
    });
    // Company verification reviewers follow product links from the brand
    // homepage; every public page must render on the brand domain itself.
    for (const [path, binding] of [
      ['/products/xworkmate', 'SSR_PUBLIC'],
      ['/products/xconnect', 'SSR_PUBLIC'],
      ['/prices', 'SSR_PUBLIC'],
      ['/company', 'SSR_PUBLIC'],
      ['/docs', 'SSR_CONTENT'],
      ['/blogs/some-post', 'SSR_CONTENT'],
      ['/download', 'SSR_CONTENT'],
      ['/support/discussions', 'SSR_WORKSPACE'],
      ['/ai-workspace?entry=trial', 'SSR_WORKSPACE'],
      ['/xworkmate', 'SSR_WORKSPACE'],
    ] as const) {
      it(`serves public page ${host}${path} on the brand domain`, async () => {
        const runtime = env(website);
        const response = await worker.fetch(new Request(`https://${host}${path}`), runtime);
        expect(response.status).toBe(200);
        expect(response.headers.get('Location')).toBeNull();
        expect(runtime[binding]?.fetch).toHaveBeenCalledOnce();
      });
    }
    it(`does not turn a protocol-relative path on ${host} into an off-site redirect`, async () => {
      const runtime = env(website);
      const response = await worker.fetch(new Request(`https://${host}//evil.example/path`), runtime);
      expect(response.headers.get('Location')).toBeNull();
    });
    it(`lists public product pages in the ${host} sitemap`, async () => {
      const response = await worker.fetch(new Request(`https://${host}/sitemap.xml`), env(website));
      expect(await response.text()).toContain(`<loc>https://${host}/products/xworkmate</loc>`);
    });
    for (const path of ['/login', '/register', '/panel', '/panel/billing', '/dashboard', '/api/auth/session', '/_edge/auth/login', '/_edge/console/app.js']) {
      it(`sends ${host}${path} to the platform`, async () => {
        const runtime = env(website);
        const response = await worker.fetch(new Request(`https://${host}${path}`), runtime);
        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe(`https://svc.plus${path}`);
        expect(runtime.API_AUTH?.fetch).not.toHaveBeenCalled();
        expect(runtime.SSR_AUTH?.fetch).not.toHaveBeenCalled();
        expect(runtime.SSR_PUBLIC?.fetch).not.toHaveBeenCalled();
      });
    }
  }
  it('retains homepage boundary assets', async () => {
    const runtime = env(website);
    const response = await worker.fetch(new Request('https://www.xworktech.com/_edge/public/_next/static/app.js'), runtime);
    expect(response.status).toBe(200);
    expect(runtime.SSR_PUBLIC?.fetch).toHaveBeenCalledOnce();
  });
  it('retains homepage marketing images', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image'));
    try {
      const response = await worker.fetch(new Request('https://www.xworktech.com/marketing/home-editions/web-zh.png'), env(website));
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('does not send API mutations or Server Actions to the platform', async () => {
    for (const path of ['/', '/api/auth/login', '/panel']) {
      const runtime = env(website);
      const response = await worker.fetch(new Request(`https://www.xworktech.com${path}`, { method: 'POST', body: '{}' }), runtime);
      expect(response.status).toBe(421);
      expect(runtime.API_AUTH?.fetch).not.toHaveBeenCalled();
      expect(runtime.SSR_PUBLIC?.fetch).not.toHaveBeenCalled();
    }
  });
  it('leaves platform dispatch unchanged', async () => {
    const runtime = env(website);
    const response = await worker.fetch(new Request('https://svc.plus/panel'), runtime);
    expect(response.status).toBe(200);
    expect(runtime.SSR_CONSOLE?.fetch).toHaveBeenCalledOnce();
  });
  it('fails closed when the platform origin is missing', async () => {
    const response = await worker.fetch(new Request('https://www.xworktech.com/login'), env({ ...website, PLATFORM_ORIGIN: '' }));
    expect(response.status).toBe(500);
  });
});
