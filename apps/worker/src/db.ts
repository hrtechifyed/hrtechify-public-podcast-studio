export interface D1RunMeta {
  changes?: number;
}

export interface D1RunResult {
  success?: boolean;
  meta?: D1RunMeta;
}

export interface D1AllResult<T> {
  results: T[];
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>;
  run(): Promise<D1RunResult>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface WorkerEnv {
  DB?: D1DatabaseLike;
  SESSION_SIGNING_KEY?: string;
  GOOGLE_AUTH_CLIENT_ID?: string;
  GOOGLE_AUTH_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  APP_URL?: string;
}

export const requireDatabase = (env: WorkerEnv): D1DatabaseLike => {
  if (!env.DB) {
    throw new Error("d1_not_configured");
  }

  return env.DB;
};
