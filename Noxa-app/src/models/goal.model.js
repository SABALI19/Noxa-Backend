import mongoose, { Schema } from "mongoose";
import { GOAL_CATEGORY_VALUES } from "../config/constants.js";

const milestoneSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    targetDate: {
      type: Date,
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const goalSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: GOAL_CATEGORY_VALUES,
      default: "personal",
    },
    targetDate: {
      type: Date,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    targetValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    currentValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    unit: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    milestones: {
      type: [milestoneSchema],
      default: [],
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

export const Goal = mongoose.model("Goal", goalSchema);
