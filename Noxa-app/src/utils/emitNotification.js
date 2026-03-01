const USER_ROOM_PREFIX = "user:";

export const getUserRoom = (userId) => `${USER_ROOM_PREFIX}${String(userId)}`;

export const emitNotification = (req, payload, options = {}) => {
  const io = req.app.get("io");
  if (!io) return;

  const event = {
    eventId: payload.eventId || `${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  const targetUserId = options.userId || req.user?.id;
  if (targetUserId) {
    io.to(getUserRoom(targetUserId)).emit("notification", event);
    return;
  }

  io.emit("notification", event);
};
