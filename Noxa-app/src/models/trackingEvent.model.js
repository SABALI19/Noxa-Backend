import mongoose, { Schema } from "mongoose";
import {
  TRACKING_ACTION_VALUES,
  TRACKING_ITEM_TYPE_VALUES,
  TRACKING_NOTIFICATION_TYPE_VALUES,
} from "../config/constants.js";

const trackingEventSchema = new Schema(
  {
    itemType: {
      type: String,
      enum: TRACKING_ITEM_TYPE_VALUES,
      required: true,
    },
    itemId: {
      type: String,
      required: true,
      trim: true,
    },
    action: {
      type: String,
      enum: TRACKING_ACTION_VALUES,
      required: true,
    },
    notificationType: {
      type: String,
      enum: TRACKING_NOTIFICATION_TYPE_VALUES,
      default: "none",
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const TrackingEvent = mongoose.model("TrackingEvent", trackingEventSchema);
