import Anthropic from "@anthropic-ai/sdk";
import { AiChatHistory } from "../models/aiChatHistory.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem } from "../utils/http.js";
import { assertRequired } from "../utils/validation.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 1000;
const MAX_CHAT_SESSIONS = 20;
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_CONTENT_LENGTH = 20000;

const isValidMessageRole = (role) => role === "user" || role === "assistant";

const validateMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw createError(400, "messages must be a non-empty array");
  }

  for (const [index, message] of messages.entries()) {
    if (!message || typeof message !== "object") {
      throw createError(400, `messages[${index}] must be an object`);
    }

    if (!isValidMessageRole(message.role)) {
      throw createError(400, `messages[${index}].role must be 'user' or 'assistant'`);
    }

    const { content } = message;
    const contentIsValid =
      (typeof content === "string" && content.trim().length > 0) ||
      (Array.isArray(content) && content.length > 0);

    if (!contentIsValid) {
      throw createError(400, `messages[${index}].content is required`);
    }
  }
};

const parseDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const normalizeMessage = (message = {}, sessionIndex, messageIndex) => {
  if (!message || typeof message !== "object") {
    throw createError(400, `sessions[${sessionIndex}].messages[${messageIndex}] must be an object`);
  }

  if (!isValidMessageRole(message.role)) {
    throw createError(
      400,
      `sessions[${sessionIndex}].messages[${messageIndex}].role must be 'user' or 'assistant'`
    );
  }

  const content = String(message.content ?? "").trim();
  if (!content) {
    throw createError(
      400,
      `sessions[${sessionIndex}].messages[${messageIndex}].content is required`
    );
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw createError(
      400,
      `sessions[${sessionIndex}].messages[${messageIndex}].content is too long`
    );
  }

  const timestamp = parseDate(message.timestamp);
  if (!timestamp) {
    throw createError(
      400,
      `sessions[${sessionIndex}].messages[${messageIndex}].timestamp must be a valid date`
    );
  }

  return {
    role: message.role,
    content,
    timestamp,
    isError: Boolean(message.isError),
  };
};

const normalizeSession = (session = {}, sessionIndex) => {
  if (!session || typeof session !== "object") {
    throw createError(400, `sessions[${sessionIndex}] must be an object`);
  }

  const id = String(session.id ?? "").trim();
  if (!id) {
    throw createError(400, `sessions[${sessionIndex}].id is required`);
  }

  const messagesInput = Array.isArray(session.messages) ? session.messages : [];
  const limitedMessages = messagesInput.slice(0, MAX_MESSAGES_PER_SESSION);
  const messages = limitedMessages.map((message, messageIndex) =>
    normalizeMessage(message, sessionIndex, messageIndex)
  );

  if (messages.length === 0) {
    throw createError(400, `sessions[${sessionIndex}].messages must contain at least one message`);
  }

  const createdAt = parseDate(session.createdAt) || messages[0]?.timestamp || new Date();
  const updatedAt =
    parseDate(session.updatedAt) || messages[messages.length - 1]?.timestamp || createdAt;

  const rawTitle = String(session.title ?? "").trim();
  const title = rawTitle || "New conversation";

  return {
    id,
    title: title.slice(0, 120),
    createdAt,
    updatedAt,
    messages,
  };
};

const normalizeSessions = (sessions) => {
  if (!Array.isArray(sessions)) {
    throw createError(400, "sessions must be an array");
  }

  return sessions.slice(0, MAX_CHAT_SESSIONS).map((session, sessionIndex) =>
    normalizeSession(session, sessionIndex)
  );
};

export const postAiMessage = asyncHandler(async (req, res) => {
  const { model, max_tokens: maxTokens, messages, system } = req.body || {};

  validateMessages(messages);

  if (system !== undefined && typeof system !== "string") {
    throw createError(400, "system must be a string");
  }

  if (
    maxTokens !== undefined &&
    (!Number.isInteger(maxTokens) || maxTokens <= 0 || maxTokens > 8192)
  ) {
    throw createError(400, "max_tokens must be an integer between 1 and 8192");
  }

  if (model !== undefined && (typeof model !== "string" || model.trim() === "")) {
    throw createError(400, "model must be a non-empty string");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw createError(500, "AI provider is not configured");
  }

  const anthropic = new Anthropic({ apiKey });

  try {
    const response = await anthropic.messages.create({
      model: model?.trim() || DEFAULT_MODEL,
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      ...(system ? { system } : {}),
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error("Anthropic API error:", error?.message || error);
    throw createError(500, "AI provider request failed");
  }
});

export const getAiChatHistory = asyncHandler(async (req, res) => {
  const history = await AiChatHistory.findOne({ userId: req.user.id }).lean();
  const sessions = Array.isArray(history?.sessions) ? history.sessions : [];
  return sendItem(res, { sessions });
});

export const upsertAiChatHistory = asyncHandler(async (req, res) => {
  assertRequired(req.body, ["sessions"]);
  const normalizedSessions = normalizeSessions(req.body.sessions);

  const history = await AiChatHistory.findOneAndUpdate(
    { userId: req.user.id },
    { $set: { sessions: normalizedSessions } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return sendItem(res, { sessions: history.sessions, updatedAt: history.updatedAt });
});
