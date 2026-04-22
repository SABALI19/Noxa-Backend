import mongoose, { Schema } from "mongoose";
import {
  PRIORITY_VALUES,
  REMINDER_NOTIFICATION_METHOD_VALUES,
  TASK_CATEGORY_VALUES,
  TASK_REMINDER_FREQUENCY_VALUES,
  TASK_REMINDER_TIMING_VALUES,
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
      frequency: {
        type: String,
        enum: TASK_REMINDER_FREQUENCY_VALUES,
        default: "once",
      },
      timing: {
        type: String,
        enum: TASK_REMINDER_TIMING_VALUES,
        default: "1_day_before",
      },
      customTime: {
        type: Date,
      },
      notificationMethod: {
        type: String,
        enum: REMINDER_NOTIFICATION_METHOD_VALUES,
        default: "in_app",
      },
      timeBeforeMinutes: {
        type: Number,
        min: 0,
        default: 30,
      },
      method: {
        type: String,
        enum: REMINDER_NOTIFICATION_METHOD_VALUES,
        default: "in_app",
      },
      lastTriggeredAt: {
        type: Date,
      },
      lastTriggeredScheduleKey: {
        type: String,
        trim: true,
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
