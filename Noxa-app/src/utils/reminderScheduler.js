import { Reminder } from "../models/reminder.model.js";
import { Task } from "../models/task.model.js";
import { emitNotificationToUser } from "./emitNotification.js";

const ENABLED_BY_DEFAULT = "true";
const DEFAULT_INTERVAL_MS = 30000;
const DEFAULT_BATCH_SIZE = 50;
const TASK_REMINDER_TIMING_TO_MS = {
  "1_hour_before": 60 * 60 * 1000,
  "2_hours_before": 2 * 60 * 60 * 1000,
  "1_day_before": 24 * 60 * 60 * 1000,
  "2_days_before": 2 * 24 * 60 * 60 * 1000,
  "1_week_before": 7 * 24 * 60 * 60 * 1000,
  on_due_date: 0,
};

const parsePositiveInt = (raw, fallback) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const normalizeNotificationMethod = (value, fallback = "in_app") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "app") return "in_app";
  if (normalized === "push" || normalized === "in_app" || normalized === "email" || normalized === "both") {
    return normalized;
  }
  return fallback;
};

const isAppPushMethod = (method) => {
  const normalized = normalizeNotificationMethod(method);
  return normalized === "push" || normalized === "in_app" || normalized === "both";
};

const shouldEnableReminderScheduler = () =>
  String(process.env.ENABLE_REMINDER_SCHEDULER || ENABLED_BY_DEFAULT).trim().toLowerCase() !== "false";

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const addMonths = (dateValue, months) => {
  const next = new Date(dateValue);
  next.setMonth(next.getMonth() + months);
  return next;
};

const getNextRecurringReminderTime = (reminderTime, frequency, now = new Date()) => {
  const current = toDate(reminderTime);
  if (!current) return null;

  let next = null;
  switch (String(frequency || "").trim().toLowerCase()) {
    case "daily":
      next = new Date(current.getTime() + 24 * 60 * 60 * 1000);
      break;
    case "weekly":
      next = new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case "monthly":
      next = addMonths(current, 1);
      break;
    default:
      return null;
  }

  while (next && next <= now) {
    if (frequency === "monthly") {
      next = addMonths(next, 1);
    } else if (frequency === "weekly") {
      next = new Date(next.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  return next;
};

const resolveReminderEventMeta = (reminder) => {
  if (reminder?.linkedGoalId) {
    return {
      notificationType: "goal_reminder",
      itemType: "goal",
      item: {
        id: String(reminder.linkedGoalId),
        title: reminder.title,
        status: reminder.status,
        reminderId: String(reminder._id),
      },
      message: `Goal reminder: ${reminder.title}`,
    };
  }

  if (reminder?.taskId) {
    return {
      notificationType: "task_reminder",
      itemType: "task",
      item: {
        id: String(reminder.taskId),
        title: reminder.title,
        status: reminder.status,
        reminderId: String(reminder._id),
      },
      message: `Task reminder: ${reminder.title}`,
    };
  }

  return {
    notificationType: "reminder_triggered",
    itemType: "reminder",
    item: {
      id: String(reminder._id),
      title: reminder.title,
      status: reminder.status,
    },
    message: `Reminder due: ${reminder.title}`,
  };
};

const buildReminderTriggeredPayload = (reminder) => {
  const meta = resolveReminderEventMeta(reminder);
  return {
    eventId: `${meta.notificationType}_${String(reminder._id)}_${Date.now()}`,
    notificationType: meta.notificationType,
    itemType: meta.itemType,
    message: meta.message,
    item: meta.item,
  };
};

const inferTaskReminderTiming = (settings = {}) => {
  const explicitTiming = String(settings.timing || "").trim().toLowerCase();
  if (TASK_REMINDER_TIMING_TO_MS[explicitTiming] !== undefined || explicitTiming === "custom") {
    return explicitTiming;
  }

  const explicitMinutes = Number(settings.timeBeforeMinutes);
  if (Number.isFinite(explicitMinutes)) {
    const matched = Object.entries(TASK_REMINDER_TIMING_TO_MS).find(
      ([, minutes]) => minutes === explicitMinutes * 60 * 1000
    );
    return matched ? matched[0] : "custom";
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
  const explicitMinutes = Number(settings.timeBeforeMinutes);

  return {
    enabled: settings.enabled !== false,
    frequency: ["once", "multiple", "daily"].includes(frequency) ? frequency : "once",
    timing,
    customTime: settings.customTime || null,
    notificationMethod,
    timeBeforeMinutes: Number.isFinite(explicitMinutes)
      ? explicitMinutes
      : Math.round((TASK_REMINDER_TIMING_TO_MS[timing] ?? 0) / (60 * 1000)),
    lastTriggeredAt: settings.lastTriggeredAt || null,
    lastTriggeredScheduleKey: settings.lastTriggeredScheduleKey || null,
  };
};

const getTaskReminderBaseTime = (task, settings) => {
  const dueDate = toDate(task?.dueDate);
  if (!dueDate) return null;

  if (settings.timing === "custom" && settings.customTime) {
    return toDate(settings.customTime);
  }

  if (Number.isFinite(settings.timeBeforeMinutes)) {
    return new Date(dueDate.getTime() - settings.timeBeforeMinutes * 60 * 1000);
  }

  const offset = TASK_REMINDER_TIMING_TO_MS[settings.timing] ?? TASK_REMINDER_TIMING_TO_MS["1_day_before"];
  return new Date(dueDate.getTime() - offset);
};

const getTaskReminderScheduleTimes = (task, settings) => {
  const dueDate = toDate(task?.dueDate);
  const baseTime = getTaskReminderBaseTime(task, settings);
  if (!dueDate || !baseTime) return [];

  if (settings.frequency === "multiple") {
    return [
      new Date(dueDate.getTime() - TASK_REMINDER_TIMING_TO_MS["1_week_before"]),
      new Date(dueDate.getTime() - TASK_REMINDER_TIMING_TO_MS["2_days_before"]),
      new Date(dueDate.getTime() - TASK_REMINDER_TIMING_TO_MS["1_day_before"]),
      new Date(dueDate.getTime() - TASK_REMINDER_TIMING_TO_MS["2_hours_before"]),
      new Date(dueDate.getTime() - TASK_REMINDER_TIMING_TO_MS["1_hour_before"]),
      dueDate,
    ]
      .filter((value) => value instanceof Date && !Number.isNaN(value.getTime()))
      .filter((value, index, list) => list.findIndex((entry) => entry.getTime() === value.getTime()) === index)
      .sort((left, right) => left.getTime() - right.getTime());
  }

  if (settings.frequency === "daily") {
    const times = [];
    let cursor = new Date(baseTime);
    const ceiling = dueDate.getTime();
    while (cursor.getTime() <= ceiling) {
      times.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return times;
  }

  return [baseTime];
};

const buildTaskReminderScheduleKey = (taskId, scheduleTime, timing, frequency) =>
  `task:${String(taskId)}:${scheduleTime.getTime()}:${String(timing || "1_day_before")}:${String(
    frequency || "once"
  )}`;

const buildTaskReminderPayload = (task, scheduleTime) => ({
  eventId: `task_reminder_${String(task._id)}_${scheduleTime.getTime()}`,
  notificationType: "task_reminder",
  itemType: "task",
  message: `Task reminder: ${task.title}`,
  item: {
    id: String(task._id),
    title: task.title,
    status: task.status,
    reminderTime: scheduleTime.toISOString(),
  },
});

const triggerDueRemindersBatch = async (io, batchSize) => {
  const now = new Date();
  const dueReminders = await Reminder.find({
    status: { $in: ["pending", "snoozed"] },
    reminderTime: { $lte: now },
  })
    .sort({ reminderTime: 1 })
    .limit(batchSize)
    .lean();

  let processed = 0;

  for (const dueReminder of dueReminders) {
    const nextReminderTime = getNextRecurringReminderTime(dueReminder.reminderTime, dueReminder.frequency, now);
    const updates = nextReminderTime
      ? {
          $set: {
            status: "pending",
            reminderTime: nextReminderTime,
          },
        }
      : {
          $set: {
            status: "sent",
          },
        };

    const reminder = await Reminder.findOneAndUpdate(
      {
        _id: dueReminder._id,
        status: { $in: ["pending", "snoozed"] },
        reminderTime: { $lte: now },
      },
      updates,
      {
        new: true,
        lean: true,
      }
    );

    if (!reminder) {
      continue;
    }

    processed += 1;

    if (!isAppPushMethod(reminder.notificationMethod)) {
      continue;
    }

    emitNotificationToUser({
      io,
      userId: reminder.userId,
      payload: buildReminderTriggeredPayload(reminder),
    });
  }

  return processed;
};

const triggerDueTaskRemindersBatch = async (io) => {
  const now = new Date();
  const tasks = await Task.find({
    completed: { $ne: true },
    dueDate: { $exists: true, $ne: null },
    "reminderSettings.enabled": true,
  })
    .sort({ dueDate: 1 })
    .lean();

  let processed = 0;

  for (const task of tasks) {
    const settings = normalizeTaskReminderSettings(task.reminderSettings || {});
    if (!settings.enabled) {
      continue;
    }

    const latestDueSchedule = getTaskReminderScheduleTimes(task, settings)
      .filter((scheduleTime) => scheduleTime.getTime() <= now.getTime())
      .sort((left, right) => right.getTime() - left.getTime())
      .find((scheduleTime) => {
        const scheduleKey = buildTaskReminderScheduleKey(
          task._id,
          scheduleTime,
          settings.timing,
          settings.frequency
        );
        return scheduleKey !== settings.lastTriggeredScheduleKey;
      });

    if (!latestDueSchedule) {
      continue;
    }

    const scheduleKey = buildTaskReminderScheduleKey(
      task._id,
      latestDueSchedule,
      settings.timing,
      settings.frequency
    );

    const updatedTask = await Task.findOneAndUpdate(
      {
        _id: task._id,
        completed: { $ne: true },
        "reminderSettings.enabled": true,
        "reminderSettings.lastTriggeredScheduleKey": { $ne: scheduleKey },
      },
      {
        $set: {
          "reminderSettings.frequency": settings.frequency,
          "reminderSettings.timing": settings.timing,
          "reminderSettings.customTime": settings.customTime ? new Date(settings.customTime) : null,
          "reminderSettings.notificationMethod": settings.notificationMethod,
          "reminderSettings.timeBeforeMinutes": settings.timeBeforeMinutes,
          "reminderSettings.method": settings.notificationMethod,
          "reminderSettings.lastTriggeredAt": now,
          "reminderSettings.lastTriggeredScheduleKey": scheduleKey,
        },
      },
      {
        new: true,
        lean: true,
      }
    );

    if (!updatedTask) {
      continue;
    }

    processed += 1;

    if (!isAppPushMethod(settings.notificationMethod)) {
      continue;
    }

    emitNotificationToUser({
      io,
      userId: updatedTask.userId,
      payload: buildTaskReminderPayload(updatedTask, latestDueSchedule),
    });
  }

  return processed;
};

export const startReminderScheduler = ({ io }) => {
  if (!shouldEnableReminderScheduler()) {
    console.info("Reminder scheduler disabled via ENABLE_REMINDER_SCHEDULER=false");
    return () => {};
  }

  const intervalMs = parsePositiveInt(
    process.env.REMINDER_SCHEDULER_INTERVAL_MS,
    DEFAULT_INTERVAL_MS
  );
  const batchSize = parsePositiveInt(process.env.REMINDER_SCHEDULER_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  let isRunning = false;

  const runOnce = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
      while (true) {
        const [processedReminders, processedTasks] = await Promise.all([
          triggerDueRemindersBatch(io, batchSize),
          triggerDueTaskRemindersBatch(io),
        ]);

        if (processedReminders < batchSize && processedTasks < batchSize) {
          break;
        }
      }
    } catch (error) {
      console.error("Reminder scheduler run failed:", error);
    } finally {
      isRunning = false;
    }
  };

  const timer = setInterval(() => {
    void runOnce();
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  void runOnce();
  console.info(`Reminder scheduler started (interval=${intervalMs}ms, batchSize=${batchSize})`);

  return () => {
    clearInterval(timer);
  };
};
