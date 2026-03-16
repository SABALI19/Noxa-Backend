import { WordOfDay } from "../models/wordOfDay.model.js";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem, sendList } from "../utils/http.js";

const DEFAULT_WORD = {
  word: "Momentum",
  meaning: "The energy that builds when you keep moving toward a goal.",
  example: "Protect your momentum by finishing one meaningful task before noon.",
  updatedAt: new Date().toISOString(),
};

const normalizeWordPayload = (payload = {}) => {
  const word = String(payload.word || "").trim();
  const meaning = String(payload.meaning || "").trim();
  const example = String(payload.example || "").trim();

  if (!word) {
    throw createError(400, "word is required");
  }

  if (!meaning) {
    throw createError(400, "meaning is required");
  }

  return {
    word,
    normalizedWord: word.toLowerCase(),
    meaning,
    example,
  };
};

const mapWordDocument = (entry) => ({
  id: String(entry._id),
  word: entry.word,
  meaning: entry.meaning,
  example: entry.example || "",
  status: entry.status || "pending",
  submittedBy: entry.submittedBy
    ? {
        id: String(entry.submittedBy._id || entry.submittedBy),
        name: entry.submittedBy.name || entry.submittedBy.username || "Community user",
      }
    : null,
  moderatedBy: entry.moderatedBy
    ? {
        id: String(entry.moderatedBy._id || entry.moderatedBy),
        name: entry.moderatedBy.name || entry.moderatedBy.username || "Moderator",
      }
    : null,
  moderatedAt: entry.moderatedAt || null,
  moderationNote: entry.moderationNote || "",
  updatedAt: entry.updatedAt || entry.createdAt,
  createdAt: entry.createdAt,
});

const buildFeaturedWord = (entries) => {
  if (!entries.length) {
    return DEFAULT_WORD;
  }

  const selectedIndex = Math.floor(Math.random() * entries.length);
  return mapWordDocument(entries[selectedIndex]);
};

export const listCommunityWords = asyncHandler(async (_req, res) => {
  const entries = await WordOfDay.find()
    .where({ status: "approved" })
    .populate("submittedBy", "name username")
    .sort({ createdAt: -1 })
    .limit(200);

  return sendList(res, entries.map(mapWordDocument));
});

export const getFeaturedCommunityWord = asyncHandler(async (_req, res) => {
  const entries = await WordOfDay.find()
    .where({ status: "approved" })
    .populate("submittedBy", "name username")
    .sort({ createdAt: -1 })
    .limit(200);

  return sendItem(res, buildFeaturedWord(entries));
});

export const createCommunityWord = asyncHandler(async (req, res) => {
  const payload = normalizeWordPayload(req.body);
  const existingEntry = await WordOfDay.findOne({ normalizedWord: payload.normalizedWord });

  if (existingEntry) {
    throw createError(
      409,
      `The word "${payload.word}" has already been submitted and is currently ${existingEntry.status}.`
    );
  }

  const entry = await WordOfDay.create({
    ...payload,
    submittedBy: req.user.id,
    status: "pending",
  });

  const createdEntry = await WordOfDay.findById(entry._id).populate("submittedBy", "name username");
  return sendItem(res, mapWordDocument(createdEntry), 201);
});

export const listPendingCommunityWords = asyncHandler(async (_req, res) => {
  const entries = await WordOfDay.find({ status: "pending" })
    .populate("submittedBy", "name username")
    .populate("moderatedBy", "name username")
    .sort({ createdAt: 1 })
    .limit(200);

  return sendList(res, entries.map(mapWordDocument));
});

export const moderateCommunityWord = asyncHandler(async (req, res) => {
  const status = String(req.body?.status || "").trim().toLowerCase();
  const moderationNote = String(req.body?.moderationNote || "").trim();

  if (!["approved", "rejected"].includes(status)) {
    throw createError(400, "status must be either approved or rejected");
  }

  const moderator = await User.findById(req.user.id).select("name username role");
  if (!moderator) {
    throw createError(401, "Moderator account not found");
  }

  const entry = await WordOfDay.findById(req.params.id)
    .populate("submittedBy", "name username")
    .populate("moderatedBy", "name username");

  if (!entry) {
    throw createError(404, "Word submission not found");
  }

  entry.status = status;
  entry.moderationNote = moderationNote;
  entry.moderatedBy = moderator._id;
  entry.moderatedAt = new Date();
  await entry.save();

  await entry.populate("moderatedBy", "name username");

  return sendItem(res, mapWordDocument(entry));
});
