import type { WorkerEnv } from "./db";

export class EmailDeliveryError extends Error {
  constructor(public readonly code: "email_delivery_not_configured" | "email_delivery_failed") {
    super(code);
    this.name = "EmailDeliveryError";
  }
}

export const isEmailDeliveryConfigured = (env: WorkerEnv) =>
  Boolean(env.RESEND_API_KEY && env.AUTH_EMAIL_FROM);

const sendAuthEmail = async (
  env: WorkerEnv,
  email: string,
  subject: string,
  html: string,
) => {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) {
    throw new EmailDeliveryError("email_delivery_not_configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: [email],
      subject,
      html,
    }),
  });

  if (!response.ok) throw new EmailDeliveryError("email_delivery_failed");
};

export const sendMagicLinkEmail = async (
  env: WorkerEnv,
  email: string,
  magicLink: string,
) => sendAuthEmail(
  env,
  email,
  "Sign in to HRTechify Podcast Studio",
  [
    "<p>Use the secure link below to sign in to HRTechify Podcast Studio.</p>",
    `<p><a href=\"${magicLink}\">Sign in to HRTechify Podcast Studio</a></p>`,
    "<p>This link expires in 15 minutes and can be used only once.</p>",
    "<p>If you did not request this email, you can ignore it.</p>",
  ].join(""),
);

export const sendPasswordVerificationEmail = async (
  env: WorkerEnv,
  email: string,
  verificationLink: string,
) => sendAuthEmail(
  env,
  email,
  "Verify your HRTechify Podcast Studio account",
  [
    "<p>Confirm that this email address belongs to you before your password sign-up becomes active.</p>",
    `<p><a href=\"${verificationLink}\">Verify email and enter HRTechify Podcast Studio</a></p>`,
    "<p>This verification link expires in 30 minutes and can be used only once.</p>",
    "<p>If you did not create this account, ignore this email. No password account will be activated.</p>",
  ].join(""),
);

export const sendPasswordResetEmail = async (
  env: WorkerEnv,
  email: string,
  resetLink: string,
) => sendAuthEmail(
  env,
  email,
  "Reset your HRTechify Podcast Studio password",
  [
    "<p>A password reset was requested for your HRTechify Podcast Studio account.</p>",
    `<p><a href=\"${resetLink}\">Set a new password</a></p>`,
    "<p>This reset link expires in 20 minutes and can be used only once.</p>",
    "<p>If you did not request a password reset, ignore this email. Your current sign-in method remains unchanged.</p>",
  ].join(""),
);
