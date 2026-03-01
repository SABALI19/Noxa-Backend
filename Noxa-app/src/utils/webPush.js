import webpush from "web-push";
import { createError } from "./http.js";
import { User } from "../models/user.model.js";

const isConfigured = () =>
  Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  );

const configureWebPush = () => {
  if (!isConfigured()) {
    return false;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  return true;
};

const validateSubscription = (subscription) => {
  if (!subscription || typeof subscription !== "object") {
    throw createError(400, "subscription is required");
  }

  const endpoint = String(subscription.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();

  if (!endpoint || !p256dh || !auth) {
    throw createError(400, "Invalid push subscription payload");
  }

  return {
    endpoint,
    expirationTime:
      subscription.expirationTime === null || subscription.expirationTime === undefined
        ? null
        : Number(subscription.expirationTime),
    keys: {
      p256dh,
      auth,
    },
    createdAt: new Date(),
  };
};

export const getPublicVapidKey = () => String(process.env.VAPID_PUBLIC_KEY || "").trim();

export const upsertUserPushSubscription = async (userId, subscription) => {
  const normalized = validateSubscription(subscription);
  const user = await User.findById(userId);
  if (!user) {
    throw createError(404, "User not found");
  }

  const existingIndex = (user.pushSubscriptions || []).findIndex(
    (entry) => entry.endpoint === normalized.endpoint
  );

  if (existingIndex >= 0) {
    user.pushSubscriptions[existingIndex] = normalized;
  } else {
    user.pushSubscriptions.push(normalized);
  }

  await user.save();
  return normalized;
};

export const removeUserPushSubscription = async (userId, endpoint) => {
  const user = await User.findById(userId);
  if (!user) {
    throw createError(404, "User not found");
  }

  if (endpoint) {
    user.pushSubscriptions = (user.pushSubscriptions || []).filter(
      (subscription) => subscription.endpoint !== endpoint
    );
  } else {
    user.pushSubscriptions = [];
  }

  await user.save();
};

const buildPushTemplate = (payload) => {
  const itemTitle = payload?.item?.title || "Activity update";
  const type = payload?.notificationType || "notification";

  const templates = {
    task_created: { title: "Task Created", body: `Created: ${itemTitle}` },
    task_updated: { title: "Task Updated", body: `Updated: ${itemTitle}` },
    task_deleted: { title: "Task Deleted", body: `Deleted: ${itemTitle}` },
    goal_created: { title: "Goal Created", body: `Created: ${itemTitle}` },
    goal_completed: { title: "Goal Completed", body: `Completed: ${itemTitle}` },
    goal_updated: { title: "Goal Updated", body: `Updated: ${itemTitle}` },
    reminder_created: { title: "Reminder Set", body: `Reminder: ${itemTitle}` },
    reminder_updated: { title: "Reminder Updated", body: `Updated: ${itemTitle}` },
    reminder_deleted: { title: "Reminder Deleted", body: `Deleted: ${itemTitle}` },
    note_created: { title: "Note Created", body: `Created: ${itemTitle}` },
    note_updated: { title: "Note Updated", body: `Updated: ${itemTitle}` },
    note_deleted: { title: "Note Deleted", body: `Deleted: ${itemTitle}` },
  };

  const fallback = {
    title: "Noxa Notification",
    body: String(payload?.message || itemTitle || "You have a new update."),
  };

  const template = templates[type] || fallback;
  return {
    title: template.title,
    body: template.body,
    data: {
      eventId: payload?.eventId || `${Date.now()}`,
      notificationType: type,
      itemType: payload?.itemType || "system",
      itemId: payload?.item?.id || null,
      url: "/dashboard",
    },
  };
};

export const sendUserWebPushNotification = async (userId, payload) => {
  if (!configureWebPush()) {
    return;
  }

  const user = await User.findById(userId).select("pushSubscriptions");
  const subscriptions = user?.pushSubscriptions || [];
  if (subscriptions.length === 0) {
    return;
  }

  const pushPayload = JSON.stringify(buildPushTemplate(payload));
  const expiredEndpoints = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription.toObject?.() || subscription, pushPayload);
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          expiredEndpoints.push(subscription.endpoint);
          return;
        }

        console.error("Web push send error:", error?.message || error);
      }
    })
  );

  if (expiredEndpoints.length > 0) {
    await User.updateOne(
      { _id: userId },
      {
        $pull: {
          pushSubscriptions: {
            endpoint: { $in: expiredEndpoints },
          },
        },
      }
    );
  }
};

