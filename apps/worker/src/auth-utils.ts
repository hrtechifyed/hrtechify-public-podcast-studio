const encoder = new TextEncoder();

export const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

export const randomToken = (bytes = 32) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toBase64Url(value);
};

export const sha256Base64Url = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
};

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const safeReturnTo = (value: string | null | undefined) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
};

export const addSecondsSqlite = (seconds: number) =>
  new Date(Date.now() + seconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

export const pkceChallenge = async (verifier: string) => sha256Base64Url(verifier);
