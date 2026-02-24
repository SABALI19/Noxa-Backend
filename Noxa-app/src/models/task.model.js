import mongoose, { Schema } from "mongoose";
import {
  NOTIFICATION_METHOD_VALUES,
  PRIORITY_VALUES,
  TASK_CATEGORY_VALUES,
  TASK_RECURRENCE_VALUES,
  TASK_STATUS_VALUES,
} from "../config/constants.js";

const taskSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    dueDate: {
      type: Date,
    },
    priority: {
      type: String,
      enum: PRIORITY_VALUES,
      default: "medium",
    },
    category: {
      type: String,
      enum: TASK_CATEGORY_VALUES,
      default: "other",
    },
    completed: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: TASK_STATUS_VALUES,
      default: "pending",
    },
    recurrence: {
      type: String,
      enum: TASK_RECURRENCE_VALUES,
      default: "none",
    },
    reminderSettings: {
      enabled: {
        type: Boolean,
        default: false,
      },
      timeBeforeMinutes: {
        type: Number,
        min: 0,
        default: 30,
      },
      method: {
        type: String,
        enum: NOTIFICATION_METHOD_VALUES,
        default: "push",
      },
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

export const Task = mongoose.model("Task", taskSchema);
