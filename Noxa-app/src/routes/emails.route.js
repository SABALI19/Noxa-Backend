import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { authMiddleware as authenticateUser } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem, sendList } from "../utils/http.js";

const router = Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AI_MODEL = process.env.AI_MODEL || "claude-sonnet-4-20250514";
const GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

const decodeBase64Url = (input = "") => {
  if (!input) return "";
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
};

const getHeaderValue = (headers = [], name) => {
  return headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";
};

const extractBodyFromPayload = (payload) => {
  if (!payload) return "";

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (!Array.isArray(payload.parts)) {
    return "";
  }

  const plainTextPart = payload.parts.find((part) => part.mimeType === "text/plain");
  if (plainTextPart?.body?.data) {
    return decodeBase64Url(plainTextPart.body.data);
  }

  for (const part of payload.parts) {
    const nestedContent = extractBodyFromPayload(part);
    if (nestedContent) {
      return nestedContent;
    }
  }

  return "";
};

const parseSummaryPayload = (rawText) => {
  const fallback = {
    summary: rawText || "",
    actionItems: [],
    urgency: "medium",
    needsReply: false,
    suggestedReply: "",
    linkedGoal: null,
    linkedTask: null,
  };

  if (!rawText) return fallback;

  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return fallback;
  }

  const normalizedUrgency =
    parsed.urgency === "high" || parsed.urgency === "low" || parsed.urgency === "medium"
      ? parsed.urgency
      : "medium";

  return {
    summary: String(parsed.summary || "").trim(),
    actionItems: Array.isArray(parsed.actionItems)
      ? parsed.actionItems.map((item) => String(item)).filter(Boolean)
      : [],
    urgency: normalizedUrgency,
    needsReply: Boolean(parsed.needsReply),
    suggestedReply: parsed.suggestedReply ? String(parsed.suggestedReply) : "",
    linkedGoal: parsed.linkedGoal ?? null,
    linkedTask: parsed.linkedTask ?? null,
  };
};

const ensureGoogleAccessToken = (req, _res, next) => {
  const headerToken = req.headers["x-google-access-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    req.user = {
      ...req.user,
      accessToken: headerToken.trim(),
    };
  }

  next();
};

router.use(authenticateUser, ensureGoogleAccessToken);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const accessToken = req.user?.accessToken;
    if (!accessToken) {
      throw createError(401, "Google access token is required");
    }

    const listResponse = await fetch(`${GMAIL_BASE_URL}/messages?maxResults=10`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!listResponse.ok) {
      throw createError(500, "Failed to fetch emails from Gmail");
    }

    const listPayload = await listResponse.json();
    const messages = Array.isArray(listPayload.messages) ? listPayload.messages : [];

    const emails = await Promise.all(
      messages.map(async (message) => {
        const detailResponse = await fetch(
          `${GMAIL_BASE_URL}/messages/${message.id}?format=full`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!detailResponse.ok) {
          return null;
        }

        const detail = await detailResponse.json();
        const headers = detail.payload?.headers || [];
        const body = extractBodyFromPayload(detail.payload) || detail.snippet || "";

        return {
          id: detail.id,
          threadId: detail.threadId,
          from: getHeaderValue(headers, "From"),
          to: getHeaderValue(headers, "To"),
          subject: getHeaderValue(headers, "Subject"),
          date: getHeaderValue(headers, "Date"),
          snippet: detail.snippet || "",
          body,
        };
      })
    );

    return sendList(
      res,
      emails.filter(Boolean)
    );
  })
);

router.post(
  "/summarize",
  asyncHandler(async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw createError(500, "Anthropic API key is not configured");
    }

    const emailData = req.body;
    if (!emailData || typeof emailData !== "object") {
      throw createError(400, "email data is required");
    }

    const { from, to, subject, date, body, goals, tasks } = emailData;
    if (!body || !String(body).trim()) {
      throw createError(400, "body is required");
    }

    const completion = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1000,
      system:
        "You summarize emails for a productivity app. Respond with valid JSON only using keys: summary, actionItems, urgency, needsReply, suggestedReply, linkedGoal, linkedTask.",
      messages: [
        {
          role: "user",
          content: `Summarize this email and return strict JSON.\n\nFrom: ${
            from || ""
          }\nTo: ${to || ""}\nSubject: ${subject || ""}\nDate: ${date || ""}\nBody: ${
            body || ""
          }\nGoals: ${JSON.stringify(goals || [])}\nTasks: ${JSON.stringify(tasks || [])}`,
        },
      ],
    });

    const responseText = (completion.content || [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim();

    if (!responseText) {
      throw createError(500, "Failed to generate email summary");
    }

    const summary = parseSummaryPayload(responseText);
    return sendItem(res, summary);
  })
);

export default router;
