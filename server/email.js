import nodemailer from "nodemailer";

const requiredSmtpSettings = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_FROM",
];
const smtpPort = Number(process.env.SMTP_PORT || "");
const smtpSecure = process.env.SMTP_SECURE || "false";
export function smtpTransportTlsOptions(port, implicitTls) {
  return {
    port,
    secure: implicitTls,
    requireTLS: !implicitTls,
  };
}

export const smtpConfigured = requiredSmtpSettings.every((name) => Boolean(process.env[name]))
  && Boolean(process.env.SMTP_USER)
  && Boolean(process.env.SMTP_PASS)
  && Number.isInteger(smtpPort)
  && smtpPort >= 1
  && smtpPort <= 65535
  && ["true", "false"].includes(smtpSecure);
const transporter = smtpConfigured
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    ...smtpTransportTlsOptions(smtpPort, smtpSecure === "true"),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
  : null;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.");
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
  if (!transporter) {
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
  if (!transporter) {
    throw new EmailNotConfiguredError();
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error("Email delivery failed:", error.message);
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
