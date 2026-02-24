import { Reminder } from "../models/reminder.model.js";
import { Task } from "../models/task.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem, sendList } from "../utils/http.js";
import { emitNotification } from "../utils/emitNotification.js";
import {
  assertEnum,
  assertNonNegativeNumber,
  assertObjectId,
  assertRequired,
} from "../utils/validation.js";
import {
  NOTIFICATION_METHOD_VALUES,
  PRIORITY_VALUES,
  REMINDER_FREQUENCY_VALUES,
  REMINDER_STATUS_VALUES,
  TASK_CATEGORY_VALUES,
} from "../config/constants.js";

const validateReminderPayload = (payload, isPatch = false) => {
  if (!isPatch) {
    assertRequired(payload, ["title", "dueDate", "reminderTime"]);
  }

  assertEnum("status", payload.status, REMINDER_STATUS_VALUES);
  assertEnum("priority", payload.priority, PRIORITY_VALUES);
  assertEnum("category", payload.category, TASK_CATEGORY_VALUES);
  assertEnum("frequency", payload.frequency, REMINDER_FREQUENCY_VALUES);
  assertEnum("notificationMethod", payload.notificationMethod, NOTIFICATION_METHOD_VALUES);
};

const pickReminderUpdates = (payload) => {
  const allowedFields = [
    "taskId",
    "title",
    "dueDate",
    "reminderTime",
    "status",
    "priority",
    "category",
    "frequency",
    "notificationMethod",
    "note",
  ];

  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
  );
};

const validateTaskOwnership = async (taskId, userId) => {
  assertObjectId(taskId, "taskId");
  const task = await Task.findOne({ _id: taskId, userId });
  if (!task) {
    throw createError(400, "taskId does not belong to the authenticated user");
  }
};

const resolveReminderNotificationType = (beforeReminder, afterReminder) => {
  if (beforeReminder.status !== "completed" && afterReminder.status === "completed") {
    return "reminder_completed";
  }

  if (beforeReminder.status === "completed" && afterReminder.status !== "completed") {
    return "reminder_reopened";
  }

  if (afterReminder.status === "snoozed") {
    return "reminder_snoozed";
  }

  return "reminder_updated";
};

export const createReminder = asyncHandler(async (req, res) => {
  validateReminderPayload(req.body);

  if (req.body.taskId) {
    await validateTaskOwnership(req.body.taskId, req.user.id);
  }

  const reminder = await Reminder.create({
    ...pickReminderUpdates(req.body),
    userId: req.user.id,
  });

  emitNotification(
    req,
    {
      eventId: `reminder_created_${reminder._id}`,
      notificationType: "reminder_created",
      itemType: "reminder",
      item: {
        id: String(reminder._id),
        title: reminder.title,
        status: reminder.status,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, reminder, 201);
});

export const getReminders = asyncHandler(async (req, res) => {
  const reminders = await Reminder.find({ userId: req.user.id }).sort({ createdAt: -1 });
  return sendList(res, reminders);
});

export const updateReminder = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const updates = pickReminderUpdates(req.body);
  validateReminderPayload(updates, true);

  if (updates.taskId) {
    await validateTaskOwnership(updates.taskId, req.user.id);
  }

  const existingReminder = await Reminder.findOne({ _id: req.params.id, userId: req.user.id });
  if (!existingReminder) {
    throw createError(404, "Reminder not found");
  }

  const reminder = await Reminder.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: updates },
    { new: true, runValidators: true }
  );

  const notificationType = resolveReminderNotificationType(existingReminder, reminder);

  emitNotification(
    req,
    {
      eventId: `${notificationType}_${reminder._id}_${Date.now()}`,
      notificationType,
      itemType: "reminder",
      item: {
        id: String(reminder._id),
        title: reminder.title,
        status: reminder.status,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, reminder);
});

export const deleteReminder = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const reminder = await Reminder.findOneAndDelete({
    _id: req.params.id,
    userId: req.user.id,
  });

  if (!reminder) {
    throw createError(404, "Reminder not found");
  }

  emitNotification(
    req,
    {
      eventId: `reminder_deleted_${reminder._id}`,
      notificationType: "reminder_deleted",
      itemType: "reminder",
      item: {
        id: String(reminder._id),
        title: reminder.title,
        status: reminder.status,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, reminder);
});

export const snoozeReminder = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const reminder = await Reminder.findOne({ _id: req.params.id, userId: req.user.id });
  if (!reminder) {
    throw createError(404, "Reminder not found");
  }

  const snoozeMinutes = req.body.snoozeMinutes ?? 10;
  assertNonNegativeNumber(snoozeMinutes, "snoozeMinutes");

  if (snoozeMinutes <= 0) {
    throw createError(400, "snoozeMinutes must be greater than 0");
  }

  const baseTime =
    reminder.reminderTime && reminder.reminderTime > new Date() ? reminder.reminderTime : new Date();

  reminder.reminderTime = new Date(baseTime.getTime() + snoozeMinutes * 60 * 1000);
  reminder.status = "snoozed";
  await reminder.save();

  emitNotification(
    req,
    {
      eventId: `reminder_snoozed_${reminder._id}_${Date.now()}`,
      notificationType: "reminder_snoozed",
      itemType: "reminder",
      item: {
        id: String(reminder._id),
        title: reminder.title,
        status: reminder.status,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, reminder);
});
