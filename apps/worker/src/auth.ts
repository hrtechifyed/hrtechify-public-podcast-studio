import { verifySession } from "./session";

export interface VerifiedIdentity {
  userId: string;
  email: string;
  displayName?: string;
}

export interface RequestContext {
  identity: VerifiedIdentity;
}

export interface AuthEnv {
  SESSION_SIGNING_KEY?: string;
}

export class AuthenticationError extends Error {
  constructor(public readonly code: "authentication_not_configured" | "authentication_required") {
    super(code);
    this.name = "AuthenticationError";
  }
}

/**
 * Authentication provider integration is intentionally separate from tenant
 * authorization. Only a server-verified signed session may become a request
 * identity. Never trust user_id supplied in URL, query, body or browser headers
 * as an authorization decision.
 */
export const requireVerifiedIdentity = async (
  request: Request,
  env: AuthEnv,
): Promise<VerifiedIdentity> => {
  if (!env.SESSION_SIGNING_KEY) {
    throw new AuthenticationError("authentication_not_configured");
  }

  const identity = await verifySession(request, env.SESSION_SIGNING_KEY);
  if (!identity) {
    throw new AuthenticationError("authentication_required");
  }

  return identity;
};

export const createRequestContext = (identity: VerifiedIdentity): RequestContext => {
  if (!identity.userId || !identity.email) {
    throw new Error("invalid_verified_identity");
  }

  return { identity };
};
