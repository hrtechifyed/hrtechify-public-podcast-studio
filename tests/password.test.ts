import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPassword,
  PasswordValidationError,
  passwordPolicy,
  validateNewPassword,
  verifyPassword,
} from "../apps/worker/src/password";

test("password policy keeps long Unicode-friendly passphrases and rejects short values", () => {
  assert.equal(passwordPolicy.minimumCharacters, 12);
  assert.equal(passwordPolicy.maximumCharacters, 128);
  assert.equal(validateNewPassword("correct horse battery staple"), "correct horse battery staple");
  assert.equal(validateNewPassword("安全なパスワードです123"), "安全なパスワードです123");
  assert.throws(
    () => validateNewPassword("too short"),
    (error) => error instanceof PasswordValidationError && error.code === "password_too_short",
  );
});

test("password hashes use a unique salt and verify without storing plaintext", async () => {
  const password = "correct horse battery staple";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first.passwordSalt, second.passwordSalt);
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.equal(first.iterations, 600_000);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong password value", first), false);
  assert.notEqual(first.passwordHash, password);
});
