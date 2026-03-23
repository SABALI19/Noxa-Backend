import Anthropic from "@anthropic-ai/sdk";
import { AiActionLog } from "../models/aiActionLog.model.js";
import { AiChatHistory } from "../models/aiChatHistory.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getAiWorkspaceContext } from "../utils/aiContext.js";
import { logAiAction } from "../utils/aiActionLog.js";
import { createError, sendItem, sendList } from "../utils/http.js";
import { assertRequired } from "../utils/validation.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 1000;
const MAX_CHAT_SESSIONS = 20;
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_CONTENT_LENGTH = 20000;
const MAX_AI_ACTION_LOGS = 100;
const BASE_SYSTEM_PROMPT = `You are Noxa, an AI productivity assistant inside a goals, tasks, reminders, and notes app.

Your responses must feel specific, grounded, and useful, not generic.

Core rules:
- Use the user's actual workspace context and recent conversation when it is provided.
- Refer to real item names, deadlines, priorities, progress, or constraints when relevant.
- Give concrete next steps, prioritization, sequencing, or tradeoffs instead of broad productivity advice.
- If something seems urgent, explain why using the provided context.
- Avoid filler, cliches, empty encouragement, and vague summaries.
- Do not invent missing facts. If context is incomplete, say what is missing briefly and still offer the best next step.
- Keep answers concise but substantive.`;

const isValidMessageRole = (role) => role === "user" || role === "assistant";

const messageContentToString = (content) => {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return String(content ?? "").trim();
  }

  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item?.type === "text") return item.text || "";
      return "";
    })
    .join("\n")
    .trim();
};

const buildSystemPrompt = (system, contextBlock = "") => {
  const callerPrompt = typeof system === "string" ? system.trim() : "";
  const sections = [BASE_SYSTEM_PROMPT];

  if (contextBlock) {
    sections.push(`Grounded user context:\n${contextBlock}`);
  }

  if (callerPrompt) {
    sections.push(`Additional caller instructions:\n${callerPrompt}`);
  }

  return sections.join("\n\n");
};

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

const normalizeOptionalString = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw createError(400, `${fieldName} must be a string`);
  }

  return value.trim();
};

const parseBooleanFlag = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  throw createError(400, "boolean flags must be true or false");
};

const extractAssistantText = (message) =>
  Array.isArray(message?.content)
    ? message.content
        .filter((item) => item?.type === "text")
        .map((item) => item.text)
        .join("\n")
        .trim()
    : "";

const buildNoxaMetadata = ({ workspaceContext, sessionId, persisted }) => ({
  groundedContext: {
    tasks: workspaceContext.workspaceSummary.tasks.length,
    goals: workspaceContext.workspaceSummary.goals.length,
    reminders: workspaceContext.workspaceSummary.reminders.length,
    notes: workspaceContext.workspaceSummary.notes.length,
  },
  followUpSuggestions: workspaceContext.followUpSuggestions,
  memoryUsed: workspaceContext.memoryUsed,
  sessionId: sessionId || null,
  persisted,
});

const persistConversationTurn = async ({
  userId,
  sessionId,
  sessionTitle,
  userMessage,
  assistantMessage,
}) => {
  if (!userId || !sessionId || !assistantMessage) {
    return null;
  }

  const history =
    (await AiChatHistory.findOne({ userId })) || new AiChatHistory({ userId, sessions: [] });
  const now = new Date();
  const nextMessages = [
    userMessage
      ? {
          role: "user",
          content: userMessage,
          timestamp: now,
          isError: false,
        }
      : null,
    {
      role: "assistant",
      content: assistantMessage,
      timestamp: now,
      isError: false,
    },
  ].filter(Boolean);

  const existingSession = history.sessions.find((session) => session.id === sessionId);

  if (existingSession) {
    existingSession.title = sessionTitle || existingSession.title || "New conversation";
    existingSession.updatedAt = now;
    existingSession.messages = [...existingSession.messages, ...nextMessages].slice(
      -MAX_MESSAGES_PER_SESSION
    );
  } else {
    history.sessions.unshift({
      id: sessionId,
      title: sessionTitle || "New conversation",
      createdAt: now,
      updatedAt: now,
      messages: nextMessages.slice(-MAX_MESSAGES_PER_SESSION),
    });
  }

  history.sessions = history.sessions
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, MAX_CHAT_SESSIONS);

  await history.save();
  return sessionId;
};

const prepareAiRequest = async (req) => {
  const {
    model,
    max_tokens: maxTokens,
    messages,
    system,
    sessionId: rawSessionId,
    sessionTitle: rawSessionTitle,
    persistResponse: rawPersistResponse,
    includeWorkspaceContext: rawIncludeWorkspaceContext,
  } = req.body || {};

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

  const sessionId = normalizeOptionalString(rawSessionId, "sessionId");
  const sessionTitle = normalizeOptionalString(rawSessionTitle, "sessionTitle");
  const includeWorkspaceContext = parseBooleanFlag(rawIncludeWorkspaceContext, true);
  const persistResponse = parseBooleanFlag(rawPersistResponse, Boolean(sessionId));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw createError(500, "AI provider is not configured");
  }

  const workspaceContext = includeWorkspaceContext
    ? await getAiWorkspaceContext(req.user.id)
    : {
        promptBlock: "",
        workspaceSummary: { tasks: [], goals: [], reminders: [], notes: [] },
        followUpSuggestions: [],
        memoryUsed: false,
      };

  return {
    anthropic: new Anthropic({ apiKey }),
    model: model?.trim() || DEFAULT_MODEL,
    maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS,
    messages,
    sessionId,
    sessionTitle,
    persistResponse,
    workspaceContext,
    systemPrompt: buildSystemPrompt(system, workspaceContext.promptBlock),
    latestUserMessage: messageContentToString(messages[messages.length - 1]?.content),
  };
};

export const postAiMessage = asyncHandler(async (req, res) => {
  const prepared = await prepareAiRequest(req);

  try {
    const response = await prepared.anthropic.messages.create({
      model: prepared.model,
      max_tokens: prepared.maxTokens,
      messages: prepared.messages,
      system: prepared.systemPrompt,
    });
    const assistantText = extractAssistantText(response);
    const persistedSessionId = prepared.persistResponse
      ? await persistConversationTurn({
          userId: req.user.id,
          sessionId: prepared.sessionId,
          sessionTitle: prepared.sessionTitle,
          userMessage: prepared.latestUserMessage,
          assistantMessage: assistantText,
        })
      : null;

    await logAiAction({
      userId: req.user.id,
      actionType: "chat_completion",
      source: "api_chat",
      status: "succeeded",
      sessionId: persistedSessionId || prepared.sessionId,
      summary: assistantText || "AI response generated",
      metadata: {
        model: prepared.model,
        streamed: false,
        groundedContext: buildNoxaMetadata({
          workspaceContext: prepared.workspaceContext,
          sessionId: persistedSessionId || prepared.sessionId,
          persisted: Boolean(persistedSessionId),
        }).groundedContext,
      },
    });

    const responsePayload = JSON.parse(JSON.stringify(response));
    responsePayload.noxa = buildNoxaMetadata({
      workspaceContext: prepared.workspaceContext,
      sessionId: persistedSessionId || prepared.sessionId,
      persisted: Boolean(persistedSessionId),
    });

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("Anthropic API error:", error?.message || error);
    await logAiAction({
      userId: req.user.id,
      actionType: "chat_completion",
      source: "api_chat",
      status: "failed",
      sessionId: prepared.sessionId,
      summary: error?.message || "AI provider request failed",
      metadata: {
        model: prepared.model,
        streamed: false,
      },
    });
    throw createError(500, "AI provider request failed");
  }
});

export const streamAiMessage = async (req, res, next) => {
  let prepared;

  try {
    prepared = await prepareAiRequest(req);
  } catch (error) {
    next(error);
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  let closed = false;
  let stream;
  let streamedText = "";

  req.on("close", () => {
    closed = true;
    if (typeof stream?.abort === "function") {
      stream.abort();
    }
  });

  try {
    stream = prepared.anthropic.messages.stream({
      model: prepared.model,
      max_tokens: prepared.maxTokens,
      messages: prepared.messages,
      system: prepared.systemPrompt,
    });

    stream.on("text", (text) => {
      streamedText += text;
      if (!closed) {
        res.write(`event: text\ndata:${JSON.stringify({ text })}\n\n`);
      }
    });

    const finalMessage = await stream.finalMessage();
    const assistantText = streamedText || extractAssistantText(finalMessage);
    const persistedSessionId = prepared.persistResponse
      ? await persistConversationTurn({
          userId: req.user.id,
          sessionId: prepared.sessionId,
          sessionTitle: prepared.sessionTitle,
          userMessage: prepared.latestUserMessage,
          assistantMessage: assistantText,
        })
      : null;

    await logAiAction({
      userId: req.user.id,
      actionType: "chat_stream",
      source: "api_stream",
      status: "succeeded",
      sessionId: persistedSessionId || prepared.sessionId,
      summary: assistantText || "AI stream generated",
      metadata: {
        model: prepared.model,
        streamed: true,
      },
    });

    if (!closed) {
      res.write(
        `event: meta\ndata:${JSON.stringify({
          noxa: buildNoxaMetadata({
            workspaceContext: prepared.workspaceContext,
            sessionId: persistedSessionId || prepared.sessionId,
            persisted: Boolean(persistedSessionId),
          }),
        })}\n\n`
      );
      res.write(`event: done\ndata:${JSON.stringify({ message: finalMessage })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error("Anthropic stream error:", error?.message || error);
    await logAiAction({
      userId: req.user.id,
      actionType: "chat_stream",
      source: "api_stream",
      status: "failed",
      sessionId: prepared.sessionId,
      summary: error?.message || "AI stream failed",
      metadata: {
        model: prepared.model,
        streamed: true,
      },
    });

    if (!closed) {
      res.write(
        `event: error\ndata:${JSON.stringify({ message: "AI provider stream failed" })}\n\n`
      );
      res.end();
    }
  }
};

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

export const getAiActionLogs = asyncHandler(async (req, res) => {
  const logs = await AiActionLog.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(MAX_AI_ACTION_LOGS)
    .lean();

  return sendList(res, logs);
});
