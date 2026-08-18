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

  it('proxies API requests through the configured Accounts gateway origin', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gateway'));
    const response = await worker.fetch(
      new Request('https://console.example.test/api/auth/login?redirect=%2Fpanel', { method: 'POST', body: '{}' }),
      env(),
    );

    expect(await response.text()).toBe('gateway');
    expect(response.headers.get('X-Frontend-Route')).toBe('api');
    const forwarded = fetchMock.mock.calls[0][0] as Request;
    expect(forwarded.url).toBe('https://accounts.example.test/api/auth/login?redirect=%2Fpanel');
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
});
