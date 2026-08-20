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

  it('dispatches Console auth API requests to the Accounts auth gateway binding', async () => {
    const runtime = env();
    const response = await worker.fetch(
      new Request('https://console.example.test/api/auth/login', { method: 'POST', body: '{}' }),
      runtime,
    );

    expect(await response.text()).toBe('api-auth');
    expect(response.headers.get('X-Frontend-Route')).toBe('api-auth');
    expect(runtime.API_AUTH?.fetch).toHaveBeenCalledOnce();
    const forwarded = vi.mocked(runtime.API_AUTH!.fetch).mock.calls[0][0];
    expect(forwarded.headers.get('X-Frontend-Route')).toBe('api-auth');
  });

  it('returns a configuration error when the auth gateway binding is missing', async () => {
    const response = await worker.fetch(
      new Request('https://console.example.test/api/auth/login'),
      env({ API_AUTH: undefined }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'API auth binding is not configured' });
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
});
