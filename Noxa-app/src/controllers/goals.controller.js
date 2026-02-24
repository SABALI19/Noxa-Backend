import { Goal } from "../models/goal.model.js";
import { GOAL_CATEGORY_VALUES } from "../config/constants.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem, sendList } from "../utils/http.js";
import { assertEnum, assertNonNegativeNumber, assertObjectId, assertRange } from "../utils/validation.js";
import { emitNotification } from "../utils/emitNotification.js";

const pickGoalUpdates = (payload) => {
  const allowedFields = [
    "title",
    "category",
    "targetDate",
    "progress",
    "completed",
    "targetValue",
    "currentValue",
    "unit",
    "description",
    "milestones",
  ];

  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
  );
};

const validateMilestones = (milestones) => {
  if (milestones === undefined) return;

  if (!Array.isArray(milestones)) {
    throw createError(400, "milestones must be an array");
  }

  milestones.forEach((milestone, index) => {
    if (!milestone || typeof milestone !== "object") {
      throw createError(400, `milestones[${index}] must be an object`);
    }

    if (!milestone.title) {
      throw createError(400, `milestones[${index}].title is required`);
    }
  });
};

const normalizeGoalCompletion = (goalPayload) => {
  const payload = { ...goalPayload };

  if (payload.progress !== undefined && payload.progress >= 100) {
    payload.completed = true;
  }

  if (
    payload.targetValue !== undefined &&
    payload.currentValue !== undefined &&
    payload.targetValue > 0 &&
    payload.currentValue >= payload.targetValue
  ) {
    payload.completed = true;
    if (payload.progress === undefined) {
      payload.progress = 100;
    }
  }

  return payload;
};

const validateGoalPayload = (payload, isPatch = false) => {
  if (!isPatch && !payload.title) {
    throw createError(400, "title is required");
  }

  assertEnum("category", payload.category, GOAL_CATEGORY_VALUES);
  assertRange(payload.progress, "progress", 0, 100);
  assertNonNegativeNumber(payload.targetValue, "targetValue");
  assertNonNegativeNumber(payload.currentValue, "currentValue");
  validateMilestones(payload.milestones);
};

const resolveGoalNotificationType = (beforeGoal, updates, afterGoal) => {
  if (updates.milestones !== undefined) return "goal_milestone";

  const justCompleted = beforeGoal.completed !== true && afterGoal.completed === true;
  if (justCompleted) return "goal_completed";

  const progressChanged =
    updates.progress !== undefined &&
    Number(beforeGoal.progress ?? 0) !== Number(afterGoal.progress ?? 0);
  if (progressChanged) return "goal_progress";

  return "goal_updated";
};

export const createGoal = asyncHandler(async (req, res) => {
  const payload = normalizeGoalCompletion(pickGoalUpdates(req.body));
  validateGoalPayload(payload);

  const goal = await Goal.create({
    ...payload,
    userId: req.user.id,
  });

  emitNotification(
    req,
    {
      eventId: `goal_created_${goal._id}`,
      notificationType: "goal_created",
      itemType: "goal",
      item: {
        id: String(goal._id),
        title: goal.title,
        progress: goal.progress,
        status: goal.completed ? "completed" : "active",
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, goal, 201);
});

export const getGoals = asyncHandler(async (req, res) => {
  const goals = await Goal.find({ userId: req.user.id }).sort({ createdAt: -1 });
  return sendList(res, goals);
});

export const getGoalById = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const goal = await Goal.findOne({ _id: req.params.id, userId: req.user.id });
  if (!goal) {
    throw createError(404, "Goal not found");
  }

  return sendItem(res, goal);
});

export const updateGoal = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const payload = normalizeGoalCompletion(pickGoalUpdates(req.body));
  validateGoalPayload(payload, true);

  const existingGoal = await Goal.findOne({ _id: req.params.id, userId: req.user.id });
  if (!existingGoal) {
    throw createError(404, "Goal not found");
  }

  const goal = await Goal.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: payload },
    { new: true, runValidators: true }
  );

  const notificationType = resolveGoalNotificationType(existingGoal, payload, goal);

  emitNotification(
    req,
    {
      eventId: `${notificationType}_${goal._id}_${Date.now()}`,
      notificationType,
      itemType: "goal",
      item: {
        id: String(goal._id),
        title: goal.title,
        progress: goal.progress,
        status: goal.completed ? "completed" : "active",
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, goal);
});

export const deleteGoal = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const goal = await Goal.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!goal) {
    throw createError(404, "Goal not found");
  }

  emitNotification(
    req,
    {
      eventId: `goal_deleted_${goal._id}`,
      notificationType: "goal_deleted",
      itemType: "goal",
      item: {
        id: String(goal._id),
        title: goal.title,
        progress: goal.progress,
        status: goal.completed ? "completed" : "active",
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, goal);
});
