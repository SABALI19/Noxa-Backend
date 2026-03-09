import mongoose, { Schema } from "mongoose";

const wordOfDaySchema = new Schema(
  {
    word: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    normalizedWord: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },
    meaning: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    example: {
      type: String,
      default: "",
      trim: true,
      maxlength: 240,
    },
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    moderatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    moderatedAt: {
      type: Date,
      default: null,
    },
    moderationNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 240,
    },
  },
  {
    timestamps: true,
  }
);

export const WordOfDay = mongoose.model("WordOfDay", wordOfDaySchema);
