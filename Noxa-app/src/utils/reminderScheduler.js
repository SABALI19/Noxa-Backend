import { Reminder } from "../models/reminder.model.js";
import { emitNotificationToUser } from "./emitNotification.js";

const ENABLED_BY_DEFAULT = "true";
const DEFAULT_INTERVAL_MS = 30000;
const DEFAULT_BATCH_SIZE = 50;

const parsePositiveInt = (raw, fallback) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const isAppPushMethod = (method) => {
  const normalized = String(method || "").trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "push" || normalized === "in_app";
};

const shouldEnableReminderScheduler = () =>
  String(process.env.ENABLE_REMINDER_SCHEDULER || ENABLED_BY_DEFAULT).trim().toLowerCase() !== "false";

const buildReminderTriggeredPayload = (reminder) => ({
  eventId: `reminder_triggered_${String(reminder._id)}_${Date.now()}`,
  notificationType: "reminder_triggered",
  itemType: "reminder",
  message: `Reminder due: ${reminder.title}`,
  item: {
    id: String(reminder._id),
    title: reminder.title,
    status: reminder.status,
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
    const reminder = await Reminder.findOneAndUpdate(
      {
        _id: dueReminder._id,
        status: { $in: ["pending", "snoozed"] },
        reminderTime: { $lte: now },
      },
      {
        $set: {
          status: "sent",
        },
      },
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
      let processed = 0;
      do {
        processed = await triggerDueRemindersBatch(io, batchSize);
      } while (processed === batchSize);
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

