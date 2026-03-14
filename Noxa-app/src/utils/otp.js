import bcrypt from "bcrypt";
import OtpToken from "../models/otp/otpToken.js";

export const OTP_PURPOSES = Object.freeze({
  PASSWORD_RESET: "password_reset",
  LOGIN: "login",
});

export const generateNumericOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const createAndSaveOtp = async (
  userId,
  expireMinutes = 10,
  purpose = OTP_PURPOSES.PASSWORD_RESET
) => {
  // Keep a single active OTP per purpose so login and reset flows do not invalidate each other.
  await OtpToken.updateMany({ userId, purpose, used: false }, { used: true });

  const otp = generateNumericOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000);

  const doc = await OtpToken.create({
    userId,
    purpose,
    otpHash,
    expiresAt,
  });

  return { otp, doc };
};

export const verifyOtpForUser = async (
  userId,
  otp,
  purpose = OTP_PURPOSES.PASSWORD_RESET,
  maxAttempts = 5
) => {
  const safeOtp = String(otp || "").trim();
  if (!safeOtp) {
    return { valid: false, reason: "missing_otp" };
  }

  const otpDoc = await OtpToken.findOne({ userId, purpose, used: false }).sort({ createdAt: -1 });
  if (!otpDoc) {
    return { valid: false, reason: "otp_not_found" };
  }

  if (otpDoc.expiresAt.getTime() <= Date.now()) {
    otpDoc.used = true;
    await otpDoc.save();
    return { valid: false, reason: "otp_expired" };
  }

  const matches = await bcrypt.compare(safeOtp, otpDoc.otpHash);

  if (!matches) {
    otpDoc.attempts += 1;

    // Repeated bad guesses should invalidate the OTP instead of keeping it alive indefinitely.
    if (otpDoc.attempts >= maxAttempts) {
      otpDoc.used = true;
    }

    await otpDoc.save();
    return { valid: false, reason: "otp_invalid" };
  }

  otpDoc.used = true;
  otpDoc.attempts += 1;
  await otpDoc.save();

  return { valid: true, otpDoc };
};
