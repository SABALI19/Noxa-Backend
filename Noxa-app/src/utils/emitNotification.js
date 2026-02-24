export const emitNotification = (req, payload) => {
  const io = req.app.get('io');
  if (!io) return;

  io.emit('notification', {
    eventId: payload.eventId || `${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...payload
  });
};
