import {
  TRACKING_ACTION_VALUES,
  TRACKING_ITEM_TYPE_VALUES,
  TRACKING_NOTIFICATION_TYPE_VALUES,
} from "../config/constants.js";
import { TrackingEvent } from "../models/trackingEvent.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem, sendList } from "../utils/http.js";
import { assertEnum, assertRequired } from "../utils/validation.js";

const pickTrackingUpdates = (payload) => {
  const allowedFields = ["itemType", "itemId", "action", "notificationType", "metadata"];

  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
  );
};

const validateTrackingPayload = (payload) => {
  assertRequired(payload, ["itemType", "itemId", "action"]);

  assertEnum("itemType", payload.itemType, TRACKING_ITEM_TYPE_VALUES);
  assertEnum("action", payload.action, TRACKING_ACTION_VALUES);
  assertEnum("notificationType", payload.notificationType, TRACKING_NOTIFICATION_TYPE_VALUES);

  if (payload.metadata !== undefined && typeof payload.metadata !== "object") {
    throw createError(400, "metadata must be an object");
  }
};

export const createTrackingEvent = asyncHandler(async (req, res) => {
  const payload = pickTrackingUpdates(req.body);
  validateTrackingPayload(payload);

  const event = await TrackingEvent.create({
    ...payload,
    userId: req.user.id,
  });

  return sendItem(res, event, 201);
});

export const getTrackingByItem = asyncHandler(async (req, res) => {
  const { itemType, itemId } = req.params;

  assertEnum("itemType", itemType, TRACKING_ITEM_TYPE_VALUES);

  const events = await TrackingEvent.find({
    userId: req.user.id,
    itemType,
    itemId,
  }).sort({ createdAt: -1 });

  return sendList(res, events);
});
