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

export interface ImagesOutputLike {
  response(): Response;
}

export interface ImagesTransformLike {
  transform(options: Record<string, unknown>): ImagesTransformLike;
  output(options: { format: string }): Promise<ImagesOutputLike>;
}

export interface ImagesBindingLike {
  input(source: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array): ImagesTransformLike;
}

export interface AiBindingLike {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface MediaOutputLike {
  response(): Promise<Response> | Response;
}

export interface MediaInputLike {
  output(options: Record<string, unknown>): MediaOutputLike;
}

export interface MediaBindingLike {
  input(source: ReadableStream<Uint8Array>): MediaInputLike;
}

export interface WorkflowInstanceLike {
  id: string;
}

export interface WorkflowBindingLike {
  create(options: {
    id: string;
    params: { jobId: string };
  }): Promise<WorkflowInstanceLike>;
}

export interface WorkerEnv {
  DB?: D1DatabaseLike;
  IMAGES?: ImagesBindingLike;
  AI?: AiBindingLike;
  MEDIA?: MediaBindingLike;
  RENDER_WORKFLOW?: WorkflowBindingLike;
  RENDER_CONTAINER?: unknown;
  SESSION_SIGNING_KEY?: string;
  GOOGLE_AUTH_CLIENT_ID?: string;
  GOOGLE_AUTH_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  DROPBOX_CLIENT_ID?: string;
  DROPBOX_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
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
