import mongoose, { Schema } from "mongoose";

const aiChatMessageSchema = new Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      required: true,
    },
    isError: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  }
);

const aiChatSessionSchema = new Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      default: "New conversation",
      trim: true,
    },
    createdAt: {
      type: Date,
      required: true,
    },
    updatedAt: {
      type: Date,
      required: true,
    },
    messages: {
      type: [aiChatMessageSchema],
      default: [],
    },
  },
  {
    _id: false,
  }
);

const aiChatHistorySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    sessions: {
      type: [aiChatSessionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

export const AiChatHistory = mongoose.model("AiChatHistory", aiChatHistorySchema);
