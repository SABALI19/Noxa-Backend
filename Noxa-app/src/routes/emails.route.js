import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { Goal } from "../models/goal.model.js";
import { Task } from "../models/task.model.js";
import { authMiddleware as authenticateUser } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logAiAction } from "../utils/aiActionLog.js";
import { createError, sendItem, sendList } from "../utils/http.js";
import { sendCustomEmail } from "../utils/mailer.js";

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

const getHeaderValue = (headers = [], name) =>
  headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";

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
    if (nestedContent) return nestedContent;
  }

  return "";
};

const getCompletionText = (completion) =>
  (completion.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();

const parseJsonFromText = (rawText) => {
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
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

  const parsed = parseJsonFromText(rawText);
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

const parseInboxSummaryPayload = (rawText, emails = []) => {
  const fallback = {
    summary: rawText || "",
    actionItems: [],
    urgentEmailIds: [],
    emailsNeedingReply: [],
  };

  const parsed = parseJsonFromText(rawText);
  if (!parsed || typeof parsed !== "object") {
    return fallback;
  }

  const knownIds = new Set(emails.map((email) => String(email.id)));

  return {
    summary: String(parsed.summary || "").trim(),
    actionItems: Array.isArray(parsed.actionItems)
      ? parsed.actionItems.map((item) => String(item)).filter(Boolean)
      : [],
    urgentEmailIds: Array.isArray(parsed.urgentEmailIds)
      ? parsed.urgentEmailIds.map((id) => String(id)).filter((id) => knownIds.has(id))
      : [],
    emailsNeedingReply: Array.isArray(parsed.emailsNeedingReply)
      ? parsed.emailsNeedingReply.map((id) => String(id)).filter((id) => knownIds.has(id))
      : [],
  };
};

const parseEmailDraftPayload = (rawText) => {
  const parsed = parseJsonFromText(rawText);
  if (!parsed || typeof parsed !== "object") {
    return {
      subject: "",
      text: rawText || "",
      html: "",
    };
  }

  return {
    subject: String(parsed.subject || "").trim(),
    text: String(parsed.text || "").trim(),
    html: String(parsed.html || "").trim(),
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

const parseMaxResults = (value, fallback = 10) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createError(400, "maxResults must be a positive integer");
  }

  return Math.min(parsed, 20);
};

const fetchInboxEmails = async (accessToken, maxResults = 10) => {
  const listResponse = await fetch(`${GMAIL_BASE_URL}/messages?maxResults=${maxResults}`, {
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
      const detailResponse = await fetch(`${GMAIL_BASE_URL}/messages/${message.id}?format=full`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

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

  return emails.filter(Boolean);
};

const loadWorkspaceContext = async (userId) => {
  const [goals, tasks] = await Promise.all([
    Goal.find({ userId, completed: { $ne: true } })
      .select("title progress targetDate")
      .sort({ targetDate: 1, createdAt: -1 })
      .limit(5)
      .lean(),
    Task.find({
      userId,
      completed: { $ne: true },
      status: { $nin: ["completed", "cancelled"] },
    })
      .select("title priority dueDate status")
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(6)
      .lean(),
  ]);

  return { goals, tasks };
};

const requireAnthropic = () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw createError(500, "Anthropic API key is not configured");
  }
};

router.use(authenticateUser, ensureGoogleAccessToken);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const accessToken = req.user?.accessToken;
    if (!accessToken) {
      throw createError(401, "Google access token is required");
    }

    const maxResults = parseMaxResults(req.query.maxResults, 10);
    const emails = await fetchInboxEmails(accessToken, maxResults);

    await logAiAction({
      userId: req.user.id,
      actionType: "email_inbox_read",
      source: "emails_api",
      status: "succeeded",
      summary: `Fetched ${emails.length} inbox emails`,
      metadata: {
        maxResults,
        count: emails.length,
      },
    });

    return sendList(res, emails);
  })
);

router.get(
  "/inbox-summary",
  asyncHandler(async (req, res) => {
    requireAnthropic();

    const accessToken = req.user?.accessToken;
    if (!accessToken) {
      throw createError(401, "Google access token is required");
    }

    const maxResults = parseMaxResults(req.query.maxResults, 10);
    const emails = await fetchInboxEmails(accessToken, maxResults);
    const workspace = await loadWorkspaceContext(req.user.id);

    if (emails.length === 0) {
      return sendItem(res, {
        emails: [],
        digest: {
          summary: "No recent emails found.",
          actionItems: [],
          urgentEmailIds: [],
          emailsNeedingReply: [],
        },
      });
    }

    const completion = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1200,
      system:
        "You summarize inboxes for a productivity assistant. Respond with strict JSON only using keys: summary, actionItems, urgentEmailIds, emailsNeedingReply.",
      messages: [
        {
          role: "user",
          content: `Summarize this inbox and use the user's current goals and tasks when deciding what matters.\n\nEmails: ${JSON.stringify(
            emails
          )}\nGoals: ${JSON.stringify(workspace.goals)}\nTasks: ${JSON.stringify(workspace.tasks)}`,
        },
      ],
    });

    const responseText = getCompletionText(completion);
    if (!responseText) {
      throw createError(500, "Failed to generate inbox summary");
    }

    const digest = parseInboxSummaryPayload(responseText, emails);

    await logAiAction({
      userId: req.user.id,
      actionType: "email_inbox_summary",
      source: "emails_api",
      status: "succeeded",
      summary: digest.summary || "Inbox summary generated",
      metadata: {
        maxResults,
        emailCount: emails.length,
      },
    });

    return sendItem(res, { emails, digest });
  })
);

router.post(
  "/summarize",
  asyncHandler(async (req, res) => {
    requireAnthropic();

    const emailData = req.body;
    if (!emailData || typeof emailData !== "object") {
      throw createError(400, "email data is required");
    }

    const { from, to, subject, date, body } = emailData;
    if (!body || !String(body).trim()) {
      throw createError(400, "body is required");
    }

    const workspace = await loadWorkspaceContext(req.user.id);
    const goals = Array.isArray(emailData.goals) ? emailData.goals : workspace.goals;
    const tasks = Array.isArray(emailData.tasks) ? emailData.tasks : workspace.tasks;

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
          }\nGoals: ${JSON.stringify(goals)}\nTasks: ${JSON.stringify(tasks)}`,
        },
      ],
    });

    const responseText = getCompletionText(completion);
    if (!responseText) {
      throw createError(500, "Failed to generate email summary");
    }

    const summary = parseSummaryPayload(responseText);

    await logAiAction({
      userId: req.user.id,
      actionType: "email_summary",
      source: "emails_api",
      status: "succeeded",
      summary: summary.summary || `Email summary generated for ${subject || "untitled email"}`,
      metadata: {
        subject: subject || "",
        needsReply: summary.needsReply,
        urgency: summary.urgency,
      },
    });

    return sendItem(res, summary);
  })
);

router.post(
  "/send",
  asyncHandler(async (req, res) => {
    const {
      to,
      subject,
      text,
      html,
      instructions,
      context,
      cc,
      bcc,
      replyTo,
      dryRun,
    } = req.body || {};

    const safeTo = String(to || "").trim().toLowerCase();
    if (!safeTo) {
      throw createError(400, "to is required");
    }

    let draft = {
      subject: String(subject || "").trim(),
      text: String(text || "").trim(),
      html: String(html || "").trim(),
    };

    if ((!draft.subject || (!draft.text && !draft.html)) && instructions) {
      requireAnthropic();

      const completion = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 1200,
        system:
          "You draft professional outbound emails. Respond with strict JSON only using keys: subject, text, html.",
        messages: [
          {
            role: "user",
            content: `Draft an email for the following request.\n\nRecipient: ${safeTo}\nInstructions: ${String(
              instructions
            )}\nContext: ${JSON.stringify(context || {})}`,
          },
        ],
      });

      const responseText = getCompletionText(completion);
      if (!responseText) {
        throw createError(500, "Failed to generate automated email draft");
      }

      draft = parseEmailDraftPayload(responseText);
    }

    if (!draft.subject) {
      throw createError(400, "subject is required");
    }

    if (!draft.text && !draft.html) {
      throw createError(400, "text or html is required");
    }

    if (dryRun === true) {
      await logAiAction({
        userId: req.user.id,
        actionType: "email_draft",
        source: "emails_api",
        status: "succeeded",
        summary: `Drafted email to ${safeTo}`,
        metadata: {
          subject: draft.subject,
          dryRun: true,
        },
      });

      return sendItem(res, {
        sent: false,
        dryRun: true,
        draft,
      });
    }

    const emailResult = await sendCustomEmail({
      to: safeTo,
      subject: draft.subject,
      text: draft.text,
      html: draft.html,
      cc,
      bcc,
      replyTo,
    });

    if (!emailResult?.sent) {
      throw createError(503, "Could not send automated email");
    }

    await logAiAction({
      userId: req.user.id,
      actionType: "email_send",
      source: "emails_api",
      status: "succeeded",
      summary: `Sent email to ${safeTo}`,
      metadata: {
        subject: draft.subject,
        cc: cc || null,
        bcc: bcc ? true : false,
      },
    });

    return sendItem(res, {
      sent: true,
      draft,
    });
  })
);

export default router;
