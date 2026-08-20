import { toBase64Url } from "./auth-utils";

const encoder = new TextEncoder();

const fromBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const importKey = async (secret: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
};

export const encryptStorageToken = async (
  token: string,
  secret: string,
  associatedData: string,
) => {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await importKey(secret);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(associatedData),
    },
    key,
    encoder.encode(token),
  );

  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
};

export const decryptStorageToken = async (
  encrypted: string,
  secret: string,
  associatedData: string,
) => {
  const [ivValue, ciphertextValue] = encrypted.split(".");
  if (!ivValue || !ciphertextValue) throw new Error("storage_token_invalid");

  const key = await importKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(ivValue),
      additionalData: encoder.encode(associatedData),
    },
    key,
    fromBase64Url(ciphertextValue),
  );

  return new TextDecoder().decode(plaintext);
};
