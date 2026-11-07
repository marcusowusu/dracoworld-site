const resendEndpoint = "https://api.resend.com/emails";
const requestTimeoutMs = 10_000;

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.");
    this.name = "EmailNotConfiguredError";
  }
}

export class EmailDeliveryError extends Error {
  constructor() {
    super("The verification email could not be delivered.");
    this.name = "EmailDeliveryError";
  }
}

export function requireEmailConfiguration() {
  if (!isResendConfigured()) {
    throw new EmailNotConfiguredError();
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export async function sendAccountEmail({ to, subject, text, html }) {
  requireEmailConfiguration();

  try {
    const response = await fetch(resendEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error("Email provider returned an unsuccessful status.");
    }

    const result = await response.json();
    if (!result || typeof result.id !== "string" || !result.id.trim()) {
      throw new Error("Email provider returned an invalid response.");
    }
  } catch (error) {
    console.error("Email delivery failed.");
    throw new EmailDeliveryError();
  }
}

export async function sendVerificationEmail({ email, name, token }) {
  const url = new URL("/api/auth/verify", process.env.PUBLIC_ORIGIN);
  url.searchParams.set("token", token);
  const safeName = escapeHtml(name);
  await sendAccountEmail({
    to: email,
    subject: "Verify your DracoWorld account",
    text: `Hello ${name},\n\nVerify your email address: ${url}\n\nThis link expires in 24 hours.`,
    html: `<p>Hello ${safeName},</p><p><a href="${url}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail({ email, name, token }) {
  const url = new URL("/", process.env.PUBLIC_ORIGIN);
  url.searchParams.set("reset_token", token);
  const safeName = escapeHtml(name);
  await sendAccountEmail({
    to: email,
    subject: "Reset your DracoWorld password",
    text: `Hello ${name},\n\nReset your password: ${url}\n\nThis link expires in one hour. If you did not request this, ignore this email.`,
    html: `<p>Hello ${safeName},</p><p><a href="${url}">Reset your password</a></p><p>This link expires in one hour. If you did not request this, ignore this email.</p>`,
  });
}

export async function sendInvitationEmail({ email, tierName, token, expiresAt }) {
  const url = new URL("/", process.env.PUBLIC_ORIGIN);
  url.searchParams.set("invite", token);
  await sendAccountEmail({
    to: email,
    subject: "You are invited to DracoWorld",
    text: `You have been invited to join DracoWorld as a ${tierName} member.\n\nAccept your invitation: ${url}\n\nThis invitation expires on ${expiresAt.toISOString()}.`,
    html: `<p>You have been invited to join DracoWorld as a ${escapeHtml(tierName)} member.</p><p><a href="${url}">Accept your invitation</a></p><p>This invitation expires on ${escapeHtml(expiresAt.toISOString())}.</p>`,
  });
}
