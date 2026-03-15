import mongoose, { Schema } from "mongoose";

const signupVerificationSchema = new Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  verifiedAt: {
    type: Date,
    default: null,
  },
  consumedAt: {
    type: Date,
    default: null,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: () => new Date(),
  },
});

export const SignupVerification = mongoose.model(
  "SignupVerification",
  signupVerificationSchema
);
