import { sendUserWebPushNotification } from "./webPush.js";

const USER_ROOM_PREFIX = "user:";

export const getUserRoom = (userId) => `${USER_ROOM_PREFIX}${String(userId)}`;

export const emitNotification = (req, payload, options = {}) => {
  const io = req.app.get("io");

  const event = {
    eventId: payload.eventId || `${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  const targetUserId = options.userId || req.user?.id;
  if (targetUserId) {
    if (io) {
      io.to(getUserRoom(targetUserId)).emit("notification", event);
    }
    void sendUserWebPushNotification(targetUserId, event);
    return;
  }

  if (io) {
    io.emit("notification", event);
  }
};
