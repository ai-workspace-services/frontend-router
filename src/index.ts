import { routeForPath } from './routes';
import type { Env, FrontendRoute, WorkerServiceBinding } from './types';

const HOP_BY_HOP_HEADERS = ['connection', 'content-length', 'host', 'keep-alive', 'transfer-encoding'];

function jsonError(message: string, status: number, requestId: string): Response {
  return new Response(JSON.stringify({ error: message, request_id: requestId }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    },
  });
}

function requestIdFor(request: Request): string {
  return request.headers.get('X-Request-Id')?.trim() || crypto.randomUUID();
}

function requestWithRouterHeaders(request: Request, requestId: string, route: FrontendRoute): Request {
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.set('X-Request-Id', requestId);
  headers.set('X-Frontend-Route', route);
  headers.set('X-Forwarded-Host', new URL(request.url).host);
  headers.set('X-Forwarded-Proto', new URL(request.url).protocol.replace(':', ''));
  return new Request(request, { headers });
}

function requestForOrigin(request: Request, origin: string, requestId: string, route: FrontendRoute): Request {
  let destinationOrigin: URL;
  try {
    destinationOrigin = new URL(origin);
  } catch {
    throw new Error(`Invalid ${route} origin`);
  }

  if (destinationOrigin.protocol !== 'https:') {
    throw new Error(`${route} origin must use HTTPS`);
  }

  const source = new URL(request.url);
  const destination = new URL(`${source.pathname}${source.search}`, destinationOrigin);
  const withHeaders = requestWithRouterHeaders(request, requestId, route);
  const init: RequestInit & { duplex?: 'half' } = {
    method: withHeaders.method,
    headers: withHeaders.headers,
    body: withHeaders.method === 'GET' || withHeaders.method === 'HEAD' ? undefined : withHeaders.body,
    redirect: withHeaders.redirect,
  };

  // Node's undici requires this for a streaming request body. Cloudflare's
  // Workers runtime accepts the Web Fetch request unchanged.
  if (init.body) init.duplex = 'half';
  return new Request(destination, init);
}

function responseWithRouteHeaders(response: Response, route: FrontendRoute, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Frontend-Route', route);
  headers.set('X-Request-Id', requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function bindingForRoute(env: Env, route: FrontendRoute): WorkerServiceBinding | undefined {
  switch (route) {
    case 'ssr-auth':
      return env.SSR_AUTH;
    case 'ssr-content':
      return env.SSR_CONTENT;
    case 'ssr-console':
      return env.SSR_CONSOLE;
    case 'ssr-workspace':
      return env.SSR_WORKSPACE;
    case 'ssr-public':
      return env.SSR_PUBLIC;
    default:
      return undefined;
  }
}

async function dispatch(request: Request, env: Env, route: FrontendRoute, requestId: string): Promise<Response> {
  if (route === 'static') {
    if (!env.PAGES_ORIGIN) return jsonError('Pages origin is not configured', 500, requestId);
    return fetch(requestForOrigin(request, env.PAGES_ORIGIN, requestId, route));
  }

  if (route === 'api') {
    if (!env.API_ORIGIN) return jsonError('API origin is not configured', 500, requestId);
    return fetch(requestForOrigin(request, env.API_ORIGIN, requestId, route));
  }

  if (route === 'api-auth') {
    if (!env.API_AUTH) return jsonError('API auth binding is not configured', 500, requestId);
    return env.API_AUTH.fetch(requestWithRouterHeaders(request, requestId, route));
  }

  const binding = bindingForRoute(env, route);
  if (!binding) return jsonError(`Service binding for ${route} is not configured`, 500, requestId);
  return binding.fetch(requestWithRouterHeaders(request, requestId, route));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = requestIdFor(request);
    const route = routeForPath(new URL(request.url).pathname);

    try {
      const response = await dispatch(request, env, route, requestId);
      return responseWithRouteHeaders(response, route, requestId);
    } catch (error) {
      console.error(`frontend-router request failed (${route})`, error);
      return jsonError('upstream_unreachable', 502, requestId);
    }
  },
};
