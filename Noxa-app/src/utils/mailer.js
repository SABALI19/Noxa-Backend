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
