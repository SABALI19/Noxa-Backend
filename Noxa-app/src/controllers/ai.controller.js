import Anthropic from "@anthropic-ai/sdk";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError } from "../utils/http.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 1000;

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
