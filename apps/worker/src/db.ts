export interface D1RunResult {
  success?: boolean;
  meta?: unknown;
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
}

export const requireDatabase = (env: WorkerEnv): D1DatabaseLike => {
  if (!env.DB) {
    throw new Error("d1_not_configured");
  }

  return env.DB;
};
