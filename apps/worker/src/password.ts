const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const MIN_PASSWORD_CHARACTERS = 12;
const MAX_PASSWORD_CHARACTERS = 128;
const encoder = new TextEncoder();

export class PasswordValidationError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
    this.name = "PasswordValidationError";
  }
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

const fromBase64Url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const derivePasswordBytes = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltBuffer = new Uint8Array(salt).buffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    key,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
};

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index] ^ right[index];
  }
  return different === 0;
};

export const validateNewPassword = (password: unknown) => {
  if (typeof password !== "string") throw new PasswordValidationError("password_required");
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_CHARACTERS) {
    throw new PasswordValidationError("password_too_short");
  }
  if (length > MAX_PASSWORD_CHARACTERS) {
    throw new PasswordValidationError("password_too_long");
  }
  return password;
};

export interface StoredPasswordMaterial {
  passwordHash: string;
  passwordSalt: string;
  iterations: number;
}

export const hashPassword = async (passwordValue: unknown): Promise<StoredPasswordMaterial> => {
  const password = validateNewPassword(passwordValue);
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePasswordBytes(password, salt, PASSWORD_ITERATIONS);
  return {
    passwordHash: toBase64Url(hash),
    passwordSalt: toBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  };
};

export const verifyPassword = async (
  password: string,
  material: StoredPasswordMaterial,
) => {
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(material.passwordSalt);
    expected = fromBase64Url(material.passwordHash);
  } catch {
    return false;
  }
  if (material.iterations < 100_000 || material.iterations > 2_000_000) return false;
  const actual = await derivePasswordBytes(password, salt, material.iterations);
  return constantTimeEqual(actual, expected);
};

const DUMMY_PASSWORD_MATERIAL: StoredPasswordMaterial = {
  passwordHash: "f6jB8q4qElzzqYkgjmj-FwRSPc_R2CkXv4RzVf6TbA0",
  passwordSalt: "aHJ0ZWN oaWZ5LWR1bW15".replaceAll(" ", ""),
  iterations: PASSWORD_ITERATIONS,
};

export const burnUnknownPasswordAttempt = async (password: string) => {
  await verifyPassword(password, DUMMY_PASSWORD_MATERIAL);
};

export const passwordPolicy = {
  minimumCharacters: MIN_PASSWORD_CHARACTERS,
  maximumCharacters: MAX_PASSWORD_CHARACTERS,
  algorithm: "PBKDF2-HMAC-SHA256",
  iterations: PASSWORD_ITERATIONS,
} as const;
