import assert from "node:assert/strict";
import test from "node:test";
import {
  PODCAST_TECHNICAL_CLEANUP_PROFILE_V1,
  TECHNICAL_ADJUSTMENTS,
  createTechnicalCleanupPlan,
  validateTechnicalCleanupProfile,
  type TechnicalCleanupProfile,
} from "../packages/audio/src/index";

test("podcast cleanup profile uses the fixed professional loudness and true-peak targets", () => {
  const profile = PODCAST_TECHNICAL_CLEANUP_PROFILE_V1;
  assert.equal(profile.version, "podcast-cleanup-v1");
  assert.equal(profile.targetIntegratedLoudnessLkfs, -16);
  assert.equal(profile.loudnessToleranceDb, 1);
  assert.equal(profile.maxTruePeakDbfs, -1);
  assert.equal(validateTechnicalCleanupProfile(profile), true);
});

test("technical cleanup preserves words timing pitch and speaking speed", () => {
  const profile = PODCAST_TECHNICAL_CLEANUP_PROFILE_V1;
  assert.equal(profile.preserveWords, true);
  assert.equal(profile.preserveTiming, true);
  assert.equal(profile.preservePitch, true);
  assert.equal(profile.preserveSpeakingSpeed, true);
});

test("every known technical adjustment appears exactly once and is gentle", () => {
  const profile = PODCAST_TECHNICAL_CLEANUP_PROFILE_V1;
  assert.equal(profile.rules.length, TECHNICAL_ADJUSTMENTS.length);
  assert.deepEqual(
    new Set(profile.rules.map((rule) => rule.adjustment)),
    new Set(TECHNICAL_ADJUSTMENTS),
  );
  assert.ok(profile.rules.every((rule) => rule.maxStrength === "gentle"));
  assert.deepEqual(
    profile.rules.filter((rule) => rule.condition === "always").map((rule) => rule.adjustment),
    ["level_balancing", "peak_protection"],
  );
});

test("cleanup plan can only be created from an immutable source", () => {
  assert.throws(() => createTechnicalCleanupPlan(false), /technical_cleanup_requires_immutable_source/);
  const plan = createTechnicalCleanupPlan(true);
  assert.equal(plan.sourceImmutable, true);
  assert.equal(plan.profileVersion, "podcast-cleanup-v1");
  assert.equal(plan.preserveWords, true);
  assert.equal(plan.preserveTiming, true);
  assert.equal(plan.preservePitch, true);
  assert.equal(plan.preserveSpeakingSpeed, true);
});

test("validator rejects duplicate or unsafe cleanup rules", () => {
  const duplicate = {
    ...PODCAST_TECHNICAL_CLEANUP_PROFILE_V1,
    rules: [
      ...PODCAST_TECHNICAL_CLEANUP_PROFILE_V1.rules,
      { adjustment: "level_balancing", condition: "always", maxStrength: "gentle" },
    ],
  } as TechnicalCleanupProfile;
  assert.throws(() => validateTechnicalCleanupProfile(duplicate), /technical_cleanup_duplicate_adjustment/);

  const unsafeTarget = {
    ...PODCAST_TECHNICAL_CLEANUP_PROFILE_V1,
    targetIntegratedLoudnessLkfs: -10,
  } as TechnicalCleanupProfile;
  assert.throws(() => validateTechnicalCleanupProfile(unsafeTarget), /technical_cleanup_loudness_invalid/);
});
