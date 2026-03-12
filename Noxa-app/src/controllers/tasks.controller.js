import { Task } from "../models/task.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem, sendList } from "../utils/http.js";
import { assertEnum, assertNonNegativeNumber, assertObjectId } from "../utils/validation.js";
import { emitNotification } from "../utils/emitNotification.js";
import {
  NOTIFICATION_METHOD_VALUES,
  PRIORITY_VALUES,
  TASK_CATEGORY_VALUES,
  TASK_REMINDER_FREQUENCY_VALUES,
  TASK_REMINDER_TIMING_VALUES,
  TASK_RECURRENCE_VALUES,
  TASK_STATUS_VALUES,
} from "../config/constants.js";

const TASK_REMINDER_TIMING_TO_MINUTES = {
  "1_hour_before": 60,
  "2_hours_before": 120,
  "1_day_before": 1440,
  "2_days_before": 2880,
  "1_week_before": 10080,
  on_due_date: 0,
};

const normalizeNotificationMethod = (value, fallback = "in_app") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "app") return "in_app";
  if (NOTIFICATION_METHOD_VALUES.includes(normalized)) return normalized;
  return fallback;
};

const inferTaskReminderTiming = (settings = {}) => {
  const explicitTiming = String(settings.timing || "").trim().toLowerCase();
  if (TASK_REMINDER_TIMING_VALUES.includes(explicitTiming)) {
    return explicitTiming;
  }

  const minutes = Number(settings.timeBeforeMinutes);
  if (Number.isFinite(minutes)) {
    const mapped = Object.entries(TASK_REMINDER_TIMING_TO_MINUTES).find(
      ([, candidate]) => candidate === minutes
    );
    return mapped ? mapped[0] : "custom";
  }

  return settings.customTime ? "custom" : "1_day_before";
};

const normalizeTaskReminderSettings = (settings = {}) => {
  const frequency = String(settings.frequency || "").trim().toLowerCase();
  const timing = inferTaskReminderTiming(settings);
  const notificationMethod = normalizeNotificationMethod(
    settings.notificationMethod ?? settings.method,
    "in_app"
  );
  const hasExplicitMinutes = Number.isFinite(Number(settings.timeBeforeMinutes));

  return {
    enabled: settings.enabled !== false,
    frequency: TASK_REMINDER_FREQUENCY_VALUES.includes(frequency) ? frequency : "once",
    timing,
    customTime: settings.customTime || undefined,
    notificationMethod,
    timeBeforeMinutes: hasExplicitMinutes
      ? Number(settings.timeBeforeMinutes)
      : TASK_REMINDER_TIMING_TO_MINUTES[timing] ?? 0,
    method: notificationMethod,
    lastTriggeredAt: settings.lastTriggeredAt || undefined,
    lastTriggeredScheduleKey: settings.lastTriggeredScheduleKey || undefined,
  };
};

const validateTaskPayload = (payload, isPatch = false) => {
  if (!isPatch && !payload.title) {
    throw createError(400, "title is required");
  }

  assertEnum("priority", payload.priority, PRIORITY_VALUES);
  assertEnum("category", payload.category, TASK_CATEGORY_VALUES);
  assertEnum("status", payload.status, TASK_STATUS_VALUES);
  assertEnum("recurrence", payload.recurrence, TASK_RECURRENCE_VALUES);

  if (payload.reminderSettings !== undefined) {
    if (typeof payload.reminderSettings !== "object" || payload.reminderSettings === null) {
      throw createError(400, "reminderSettings must be an object");
    }

    payload.reminderSettings = normalizeTaskReminderSettings(payload.reminderSettings);

    assertEnum(
      "reminderSettings.notificationMethod",
      payload.reminderSettings.notificationMethod,
      NOTIFICATION_METHOD_VALUES
    );
    assertEnum(
      "reminderSettings.frequency",
      payload.reminderSettings.frequency,
      TASK_REMINDER_FREQUENCY_VALUES
    );
    assertEnum(
      "reminderSettings.timing",
      payload.reminderSettings.timing,
      TASK_REMINDER_TIMING_VALUES
    );
    assertNonNegativeNumber(
      payload.reminderSettings.timeBeforeMinutes,
      "reminderSettings.timeBeforeMinutes"
    );
  }
};

const pickTaskUpdates = (payload) => {
  const allowedFields = [
    "title",
    "description",
    "dueDate",
    "priority",
    "category",
    "completed",
    "status",
    "recurrence",
    "reminderSettings",
  ];

  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
  );
};

export const createTask = asyncHandler(async (req, res) => {
  validateTaskPayload(req.body);

  const task = await Task.create({
    ...pickTaskUpdates(req.body),
    userId: req.user.id,
  });

  emitNotification(req, {
    eventId: `task_created_${task._id}`,
    notificationType: "task_created",
    itemType: "task",
    item: {
      id: String(task._id),
      title: task.title,
    },
  }, { userId: req.user.id });

  return sendItem(res, task, 201);
});

export const getTasks = asyncHandler(async (req, res) => {
  const tasks = await Task.find({ userId: req.user.id }).sort({ createdAt: -1 });
  return sendList(res, tasks);
});

export const getTaskById = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const task = await Task.findOne({ _id: req.params.id, userId: req.user.id });
  if (!task) {
    throw createError(404, "Task not found");
  }

  return sendItem(res, task);
});

export const updateTask = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const updates = pickTaskUpdates(req.body);
  validateTaskPayload(updates, true);

  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: updates },
    { new: true, runValidators: true }
  );

  if (!task) {
    throw createError(404, "Task not found");
  }

  emitNotification(
    req,
    {
      eventId: `task_updated_${task._id}_${Date.now()}`,
      notificationType: "task_updated",
      itemType: "task",
      item: {
        id: String(task._id),
        title: task.title,
        status: task.status,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, task);
});

export const deleteTask = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const task = await Task.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!task) {
    throw createError(404, "Task not found");
  }

  emitNotification(
    req,
    {
      eventId: `task_deleted_${task._id}`,
      notificationType: "task_deleted",
      itemType: "task",
      item: {
        id: String(task._id),
        title: task.title,
        status: task.status,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, task);
});
