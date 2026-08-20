export interface VerifiedIdentity {
  userId: string;
  email: string;
  displayName?: string;
}

export interface RequestContext {
  identity: VerifiedIdentity;
}

/**
 * Authentication provider integration is intentionally separate from tenant
 * authorization. Only a server-verified identity may be converted into a
 * RequestContext. Never trust user_id supplied in URL, query, body or headers
 * by the browser as an authorization decision.
 */
export const createRequestContext = (identity: VerifiedIdentity): RequestContext => {
  if (!identity.userId || !identity.email) {
    throw new Error("invalid_verified_identity");
  }

  return { identity };
};
