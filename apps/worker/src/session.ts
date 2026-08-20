import type { VerifiedIdentity } from "./auth";

export const SESSION_COOKIE_NAME = "__Host-hrtechify_session";

interface SessionPayload {
  v: 1;
  sub: string;
  email: string;
  name?: string;
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const fromBase64Url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const importKey = (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const signValue = async (value: string, secret: string) => {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
};

const readCookie = (request: Request, name: string) => {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=");
  }

  return null;
};

export const verifySession = async (
  request: Request,
  secret: string,
): Promise<VerifiedIdentity | null> => {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;

  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;

  const key = await importKey(secret);
  const signature = fromBase64Url(signaturePart);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(payloadPart),
  );
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(decoder.decode(fromBase64Url(payloadPart))) as SessionPayload;
  } catch {
    return null;
  }

  if (
    payload.v !== 1 ||
    !payload.sub ||
    !payload.email ||
    !payload.exp ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return {
    userId: payload.sub,
    email: payload.email,
    displayName: payload.name,
  };
};

export const createSessionCookie = async (
  identity: VerifiedIdentity,
  secret: string,
  lifetimeSeconds = 60 * 60 * 24 * 14,
) => {
  const payload: SessionPayload = {
    v: 1,
    sub: identity.userId,
    email: identity.email,
    name: identity.displayName,
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  };

  const payloadPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await signValue(payloadPart, secret);
  const token = `${payloadPart}.${signature}`;

  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${lifetimeSeconds}`;
};

export const clearSessionCookie = () =>
  `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
