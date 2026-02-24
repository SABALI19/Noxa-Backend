import { Task } from "../models/task.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem, sendList } from "../utils/http.js";
import { assertEnum, assertNonNegativeNumber, assertObjectId } from "../utils/validation.js";
import { emitNotification } from "../utils/emitNotification.js";
import {
  NOTIFICATION_METHOD_VALUES,
  PRIORITY_VALUES,
  TASK_CATEGORY_VALUES,
  TASK_RECURRENCE_VALUES,
  TASK_STATUS_VALUES,
} from "../config/constants.js";

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

    assertEnum(
      "reminderSettings.method",
      payload.reminderSettings.method,
      NOTIFICATION_METHOD_VALUES
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
  });

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

  return sendItem(res, task);
});

export const deleteTask = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const task = await Task.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!task) {
    throw createError(404, "Task not found");
  }

  return sendItem(res, task);
});
