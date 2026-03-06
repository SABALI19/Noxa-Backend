import { sendUserWebPushNotification } from "./webPush.js";

const USER_ROOM_PREFIX = "user:";

export const getUserRoom = (userId) => `${USER_ROOM_PREFIX}${String(userId)}`;

const buildNotificationEvent = (payload) => ({
  eventId: payload.eventId || `${Date.now()}`,
  timestamp: new Date().toISOString(),
  ...payload,
});

export const emitNotificationToUser = ({ io, userId, payload }) => {
  const event = buildNotificationEvent(payload);
  const targetUserId =
    userId === undefined || userId === null || userId === "" ? null : String(userId);

  if (targetUserId) {
    if (io) {
      io.to(getUserRoom(targetUserId)).emit("notification", event);
    }

    void sendUserWebPushNotification(targetUserId, event);
    return event;
  }

  if (io) {
    io.emit("notification", event);
  }

  return event;
};

export const emitNotification = (req, payload, options = {}) => {
  const io = req.app.get("io");
  const targetUserId = options.userId || req.user?.id;
  return emitNotificationToUser({ io, userId: targetUserId, payload });
};
