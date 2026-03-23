import nodemailer from "nodemailer";

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value).trim().toLowerCase() === "true";
};

const getSmtpConfig = () => {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 0);
  const user = String(process.env.SMTP_USER || process.env.GMAIL_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || "").trim();
  const secure = toBoolean(process.env.SMTP_SECURE, port === 465);
  const rejectUnauthorized = toBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true);

  if (!host || !port || !user || !pass) {
    return null;
  }

  if (secure && port === 587) {
    console.warn("SMTP_SECURE=true with port 587 is usually invalid. Use SMTP_SECURE=false for STARTTLS.");
  }

  return {
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized,
    },
  };
};

const getFromAddress = () => {
  const fromName = String(process.env.SMTP_FROM_NAME || "Noxa").trim();
  const fromEmail =
    String(process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || process.env.GMAIL_USER || "").trim();

  if (!fromEmail) {
    return null;
  }

  return `"${fromName}" <${fromEmail}>`;
};

const smtpConfig = getSmtpConfig();
const fromAddress = getFromAddress();
const transporter = smtpConfig ? nodemailer.createTransport(smtpConfig) : null;

export const isMailConfigured = () => Boolean(transporter && fromAddress);

export const sendCustomEmail = async ({
  to,
  subject,
  text = "",
  html = "",
  cc,
  bcc,
  replyTo,
}) => {
  if (!isMailConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason: "mail_not_configured",
    };
  }

  const safeTo = String(to || "").trim().toLowerCase();
  const safeSubject = String(subject || "").trim();
  const safeText = String(text || "").trim();
  const safeHtml = String(html || "").trim();
  const safeReplyTo = String(replyTo || "").trim();

  if (!safeTo) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_recipient",
    };
  }

  if (!safeSubject) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_subject",
    };
  }

  if (!safeText && !safeHtml) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_content",
    };
  }

  await transporter.sendMail({
    from: fromAddress,
    to: safeTo,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: safeReplyTo || undefined,
    subject: safeSubject,
    text: safeText || undefined,
    html: safeHtml || undefined,
  });

  return {
    sent: true,
    skipped: false,
  };
};

export const sendAccountCreatedEmail = async ({ to, username }) => {
  if (!isMailConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason: "mail_not_configured",
    };
  }

  const safeUsername = String(username || "there").trim() || "there";
  const safeTo = String(to || "").trim().toLowerCase();

  if (!safeTo) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_recipient",
    };
  }

  await transporter.sendMail({
    from: fromAddress,
    to: safeTo,
    subject: "Welcome to Noxa - Account Created",
    text: `Hi ${safeUsername}, your Noxa account was created successfully.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Welcome to Noxa</h2>
        <p>Hi ${safeUsername},</p>
        <p>Your account has been created successfully.</p>
        <p>You can now sign in and start managing your goals, tasks, and reminders.</p>
        <p>Regards,<br/>Noxa Team</p>
      </div>
    `,
  });

  return {
    sent: true,
    skipped: false,
  };
};

export const sendSignupVerificationEmail = async ({
  to,
  username,
  otp,
  expiresInMinutes = 10,
}) => {
  if (!isMailConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason: "mail_not_configured",
    };
  }

  const safeUsername = String(username || "there").trim() || "there";
  const safeTo = String(to || "").trim().toLowerCase();
  const safeOtp = String(otp || "").trim();
  const safeExpiry = Number.isFinite(Number(expiresInMinutes)) ? Number(expiresInMinutes) : 10;

  if (!safeTo) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_recipient",
    };
  }

  if (!safeOtp) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_otp",
    };
  }

  await transporter.sendMail({
    from: fromAddress,
    to: safeTo,
    subject: "Verify your Noxa email",
    text: `Hi ${safeUsername}, your Noxa signup verification code is ${safeOtp}. It expires in ${safeExpiry} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Verify your email</h2>
        <p>Hi ${safeUsername},</p>
        <p>Use this code to confirm your Noxa account email address:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${safeOtp}</p>
        <p>This code expires in ${safeExpiry} minutes.</p>
        <p>If you did not create this account, you can ignore this email.</p>
        <p>Regards,<br/>Noxa Team</p>
      </div>
    `,
  });

  return {
    sent: true,
    skipped: false,
  };
};

export const sendPasswordResetOtpEmail = async ({
  to,
  username,
  otp,
  expiresInMinutes = 10,
  resetUrl = "",
  resetToken = "",
}) => {
  if (!isMailConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason: "mail_not_configured",
    };
  }

  const safeUsername = String(username || "there").trim() || "there";
  const safeTo = String(to || "").trim().toLowerCase();
  const safeOtp = String(otp || "").trim();
  const safeExpiry = Number.isFinite(Number(expiresInMinutes)) ? Number(expiresInMinutes) : 10;
  const safeResetUrl = String(resetUrl || "").trim();
  const safeResetToken = String(resetToken || "").trim();

  if (!safeTo) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_recipient",
    };
  }

  if (!safeOtp) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_otp",
    };
  }

  await transporter.sendMail({
    from: fromAddress,
    to: safeTo,
    subject: "Noxa Password Reset OTP",
    text: `Hi ${safeUsername}, your Noxa password reset OTP is ${safeOtp}. It expires in ${safeExpiry} minutes.${
      safeResetUrl
        ? ` You can also open this reset link: ${safeResetUrl}`
        : safeResetToken
          ? ` You can also use this reset token: ${safeResetToken}`
          : ""
    }`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Password Reset OTP</h2>
        <p>Hi ${safeUsername},</p>
        <p>Use this OTP to reset your Noxa password:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${safeOtp}</p>
        <p>This OTP expires in ${safeExpiry} minutes.</p>
        ${
          safeResetUrl
            ? `<p>You can also reset directly with this link:</p>
        <p><a href="${safeResetUrl}">${safeResetUrl}</a></p>`
            : safeResetToken
              ? `<p>If your app asks for a reset token, use this token:</p>
        <p style="font-family: monospace; font-size: 16px; word-break: break-all;">${safeResetToken}</p>`
              : ""
        }
        <p>If you did not request this, you can ignore this email.</p>
        <p>Regards,<br/>Noxa Team</p>
      </div>
    `,
  });

  return {
    sent: true,
    skipped: false,
  };
};

export const sendLoginOtpEmail = async ({ to, username, otp, expiresInMinutes = 10 }) => {
  if (!isMailConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason: "mail_not_configured",
    };
  }

  const safeUsername = String(username || "there").trim() || "there";
  const safeTo = String(to || "").trim().toLowerCase();
  const safeOtp = String(otp || "").trim();
  const safeExpiry = Number.isFinite(Number(expiresInMinutes)) ? Number(expiresInMinutes) : 10;

  if (!safeTo) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_recipient",
    };
  }

  if (!safeOtp) {
    return {
      sent: false,
      skipped: true,
      reason: "missing_otp",
    };
  }

  await transporter.sendMail({
    from: fromAddress,
    to: safeTo,
    subject: "Noxa Login OTP",
    text: `Hi ${safeUsername}, your Noxa login OTP is ${safeOtp}. It expires in ${safeExpiry} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Login OTP</h2>
        <p>Hi ${safeUsername},</p>
        <p>Use this OTP to complete your Noxa login:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${safeOtp}</p>
        <p>This OTP expires in ${safeExpiry} minutes.</p>
        <p>If you did not try to log in, you can ignore this email.</p>
        <p>Regards,<br/>Noxa Team</p>
      </div>
    `,
  });

  return {
    sent: true,
    skipped: false,
  };
};
