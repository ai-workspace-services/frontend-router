export interface WorkerServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  WEBSITE_HOSTS?: string;
  PLATFORM_ORIGIN?: string;
  PAGES_ORIGIN?: string;
  API_ORIGIN?: string;
  STATIC_CACHE_TTL?: string;
  PUBLIC_CACHE_TTL?: string;
  API_AUTH?: WorkerServiceBinding;
  // One origin per content section. A section is served from its origin only
  // when the origin is set, so an unset variable keeps the section on its SSR
  // boundary — that is both the rollout switch and the rollback. Pointing two
  // sections at different Pages projects is what lets them be published
  // independently of each other and of the main site.
  PAGES_ORIGIN_BLOGS?: string;
  PAGES_ORIGIN_DOCS?: string;
  PAGES_ORIGIN_PRODUCTS?: string;
  PAGES_ORIGIN_SUPPORT?: string;
  SSR_AUTH?: WorkerServiceBinding;
  SSR_CONTENT?: WorkerServiceBinding;
  SSR_CONSOLE?: WorkerServiceBinding;
  SSR_WORKSPACE?: WorkerServiceBinding;
  SSR_PUBLIC?: WorkerServiceBinding;
}

export type FrontendRoute =
  | 'static'
  | 'api'
  | 'api-auth'
  | 'ssr-auth'
  | 'ssr-content'
  | 'ssr-console'
  | 'ssr-workspace'
  | 'ssr-public';
