import mongoose, { Schema } from "mongoose";

const aiActionLogSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actionType: {
      type: String,
      required: true,
      trim: true,
    },
    source: {
      type: String,
      default: "assistant",
      trim: true,
    },
    status: {
      type: String,
      enum: ["started", "succeeded", "failed"],
      default: "succeeded",
    },
    sessionId: {
      type: String,
      trim: true,
    },
    summary: {
      type: String,
      default: "",
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

export const AiActionLog = mongoose.model("AiActionLog", aiActionLogSchema);
