import { AiActionLog } from "../models/aiActionLog.model.js";

const truncate = (value, maxLength = 240) => {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
};

export const logAiAction = async ({
  userId,
  actionType,
  source = "assistant",
  status = "succeeded",
  sessionId,
  summary,
  metadata = {},
}) => {
  if (!userId || !actionType) return null;

  try {
    return await AiActionLog.create({
      userId,
      actionType,
      source,
      status,
      sessionId: sessionId ? String(sessionId) : undefined,
      summary: truncate(summary, 240),
      metadata,
    });
  } catch (error) {
    console.error("Failed to write AI action log:", error?.message || error);
    return null;
  }
};
