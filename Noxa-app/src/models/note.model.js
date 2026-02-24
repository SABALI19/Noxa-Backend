import mongoose, { Schema } from "mongoose";
import { NOTE_CATEGORY_VALUES } from "../config/constants.js";

const noteSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: NOTE_CATEGORY_VALUES,
      default: "general",
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    color: {
      type: String,
      default: "#ffffff",
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Note = mongoose.model("Note", noteSchema);
