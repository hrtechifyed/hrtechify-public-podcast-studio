import {
  PODCAST_TECHNICAL_CLEANUP_PROFILE_V1,
  type TechnicalAdjustment,
} from "@hrtechify/audio";

interface TechnicalCleanupSummaryProps {
  sourceImmutable: boolean;
}

const adjustmentLabel: Record<TechnicalAdjustment, string> = {
  noise_control: "Noise control",
  hum_control: "Hum control",
  click_reduction: "Click reduction",
  de_essing: "De-essing",
  plosive_control: "Plosive control",
  level_balancing: "Level balancing",
  compression: "Compression",
  peak_protection: "Peak protection",
};

export function TechnicalCleanupSummary({ sourceImmutable }: TechnicalCleanupSummaryProps) {
  const profile = PODCAST_TECHNICAL_CLEANUP_PROFILE_V1;
  const always = profile.rules.filter((rule) => rule.condition === "always");
  const whenDetected = profile.rules.filter((rule) => rule.condition === "when_detected");

  return (
    <details style={{ width: "100%", marginTop: 10 }}>
      <summary>Technical cleanup policy</summary>
      <div className="trust-note" style={{ marginTop: 10 }}>
        <strong>Professional cleanup on a derived copy only</strong>
        {!sourceImmutable ? (
          <span>Technical cleanup is unavailable because this episode is not backed by a verified immutable original.</span>
        ) : (
          <>
            <span>
              Final audio processing is constrained to profile <code>{profile.version}</code>: target integrated loudness {profile.targetIntegratedLoudnessLkfs} LKFS (±{profile.loudnessToleranceDb} dB) and maximum true peak {profile.maxTruePeakDbfs} dBFS.
            </span>
            <span>
              Always: {always.map((rule) => adjustmentLabel[rule.adjustment]).join(" · ")}.
            </span>
            <span>
              Only when detected, and only gently: {whenDetected.map((rule) => adjustmentLabel[rule.adjustment]).join(" · ")}.
            </span>
            <span>
              Technical cleanup must preserve every word, timing, pitch and speaking speed. Editorial cuts remain separate and still require your explicit Apply in final edit decision.
            </span>
            <span>
              This screen defines the allowed cleanup policy; it does not modify the original recording. The processing engine will apply this policy only to a later derived render.
            </span>
          </>
        )}
      </div>
    </details>
  );
}
