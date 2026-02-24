import mongoose, { Schema } from "mongoose";
import {
  NOTIFICATION_METHOD_VALUES,
  PRIORITY_VALUES,
  REMINDER_FREQUENCY_VALUES,
  REMINDER_STATUS_VALUES,
  TASK_CATEGORY_VALUES,
} from "../config/constants.js";

const reminderSchema = new Schema(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    reminderTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: REMINDER_STATUS_VALUES,
      default: "pending",
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
    frequency: {
      type: String,
      enum: REMINDER_FREQUENCY_VALUES,
      default: "once",
    },
    notificationMethod: {
      type: String,
      enum: NOTIFICATION_METHOD_VALUES,
      default: "push",
    },
    note: {
      type: String,
      default: "",
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

export const Reminder = mongoose.model("Reminder", reminderSchema);
