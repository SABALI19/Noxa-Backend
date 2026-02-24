export const DB_NAME = "Noxa-backend";

export const DEFAULT_PORT = 4000;
export const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
export const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "dev-only-refresh-secret-change-me";
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

export const PRIORITY_VALUES = ["low", "medium", "high"];

export const TASK_CATEGORY_VALUES = [
  "work",
  "personal",
  "health",
  "finance",
  "education",
  "other",
];

export const TASK_STATUS_VALUES = ["pending", "in_progress", "completed", "cancelled"];

export const TASK_RECURRENCE_VALUES = ["none", "daily", "weekly", "monthly", "yearly"];

export const NOTIFICATION_METHOD_VALUES = ["push", "email", "sms", "in_app"];

export const REMINDER_STATUS_VALUES = ["pending", "sent", "dismissed", "snoozed"];

export const REMINDER_FREQUENCY_VALUES = ["once", "daily", "weekly", "monthly"];

export const GOAL_CATEGORY_VALUES = [
  "health",
  "career",
  "finance",
  "personal",
  "education",
  "fitness",
  "other",
];

export const NOTE_CATEGORY_VALUES = ["general", "work", "personal", "ideas", "study", "other"];

export const TRACKING_ITEM_TYPE_VALUES = ["task", "reminder", "goal", "note"];

export const TRACKING_ACTION_VALUES = [
  "created",
  "updated",
  "deleted",
  "completed",
  "snoozed",
  "notified",
  "viewed",
];

export const TRACKING_NOTIFICATION_TYPE_VALUES = [...NOTIFICATION_METHOD_VALUES, "none"];
