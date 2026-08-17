export interface WorkerServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  PAGES_ORIGIN?: string;
  API_ORIGIN?: string;
  SSR_AUTH?: WorkerServiceBinding;
  SSR_CONTENT?: WorkerServiceBinding;
  SSR_CONSOLE?: WorkerServiceBinding;
  SSR_WORKSPACE?: WorkerServiceBinding;
  SSR_PUBLIC?: WorkerServiceBinding;
}

export type FrontendRoute =
  | 'static'
  | 'api'
  | 'ssr-auth'
  | 'ssr-content'
  | 'ssr-console'
  | 'ssr-workspace'
  | 'ssr-public';
