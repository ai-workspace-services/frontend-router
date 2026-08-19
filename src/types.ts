export interface WorkerServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  PAGES_ORIGIN?: string;
  API_ORIGIN?: string;
  API_AUTH?: WorkerServiceBinding;
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
