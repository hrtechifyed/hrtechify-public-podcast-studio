import type { WorkerEnv } from "./db";

export class EmailDeliveryError extends Error {
  constructor(public readonly code: "email_delivery_not_configured" | "email_delivery_failed") {
    super(code);
    this.name = "EmailDeliveryError";
  }
}

export const isEmailDeliveryConfigured = (env: WorkerEnv) =>
  Boolean(env.RESEND_API_KEY && env.AUTH_EMAIL_FROM);

export const sendMagicLinkEmail = async (
  env: WorkerEnv,
  email: string,
  magicLink: string,
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
      subject: "Sign in to HRTechify Podcast Studio",
      html: [
        "<p>Use the secure link below to sign in to HRTechify Podcast Studio.</p>",
        `<p><a href=\"${magicLink}\">Sign in to HRTechify Podcast Studio</a></p>`,
        "<p>This link expires in 15 minutes and can be used only once.</p>",
        "<p>If you did not request this email, you can ignore it.</p>",
      ].join(""),
    }),
  });

  if (!response.ok) {
    throw new EmailDeliveryError("email_delivery_failed");
  }
};
