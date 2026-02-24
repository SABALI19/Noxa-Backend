import mongoose from "mongoose";
import { createError } from "./http.js";

export const assertRequired = (payload, requiredFields) => {
  if (!payload || typeof payload !== "object") {
    throw createError(400, "Request body is required");
  }

  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      throw createError(400, `${field} is required`);
    }
  }
};

export const assertEnum = (fieldName, value, allowedValues) => {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (!allowedValues.includes(value)) {
    throw createError(400, `Invalid ${fieldName}. Allowed values: ${allowedValues.join(", ")}`);
  }
};

export const assertObjectId = (value, fieldName = "id") => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createError(400, `Invalid ${fieldName}`);
  }
};

export const assertNonNegativeNumber = (value, fieldName) => {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    throw createError(400, `${fieldName} must be a non-negative number`);
  }
};

export const assertRange = (value, fieldName, min, max) => {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value !== "number" || Number.isNaN(value) || value < min || value > max) {
    throw createError(400, `${fieldName} must be between ${min} and ${max}`);
  }
};
