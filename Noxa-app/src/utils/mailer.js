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

  if (!host || !port || !user || !pass) {
    return null;
  }

  return {
    host,
    port,
    secure,
    auth: {
      user,
      pass,
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

export const sendPasswordResetOtpEmail = async ({ to, username, otp, expiresInMinutes = 10 }) => {
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
    subject: "Noxa Password Reset OTP",
    text: `Hi ${safeUsername}, your Noxa password reset OTP is ${safeOtp}. It expires in ${safeExpiry} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Password Reset OTP</h2>
        <p>Hi ${safeUsername},</p>
        <p>Use this OTP to reset your Noxa password:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${safeOtp}</p>
        <p>This OTP expires in ${safeExpiry} minutes.</p>
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
