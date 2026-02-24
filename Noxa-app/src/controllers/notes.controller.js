import { Note } from "../models/note.model.js";
import { NOTE_CATEGORY_VALUES } from "../config/constants.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem, sendList } from "../utils/http.js";
import { assertEnum, assertObjectId } from "../utils/validation.js";
import { emitNotification } from "../utils/emitNotification.js";

const pickNoteUpdates = (payload) => {
  const allowedFields = ["title", "content", "category", "isPinned", "color"];

  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
  );
};

const validateColor = (color) => {
  if (color === undefined || color === null || color === "") return;

  const hexColorPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  if (!hexColorPattern.test(color)) {
    throw createError(400, "color must be a valid hex value");
  }
};

const validateNotePayload = (payload, isPatch = false) => {
  if (!isPatch) {
    if (!payload.title) throw createError(400, "title is required");
    if (!payload.content) throw createError(400, "content is required");
  }

  assertEnum("category", payload.category, NOTE_CATEGORY_VALUES);
  validateColor(payload.color);
};

export const createNote = asyncHandler(async (req, res) => {
  const payload = pickNoteUpdates(req.body);
  validateNotePayload(payload);

  const note = await Note.create({
    ...payload,
    userId: req.user.id,
  });

  emitNotification(
    req,
    {
      eventId: `note_created_${note._id}`,
      notificationType: "note_created",
      itemType: "note",
      item: {
        id: String(note._id),
        title: note.title,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, note, 201);
});

export const getNotes = asyncHandler(async (req, res) => {
  const notes = await Note.find({ userId: req.user.id }).sort({ isPinned: -1, createdAt: -1 });
  return sendList(res, notes);
});

export const getNoteById = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const note = await Note.findOne({ _id: req.params.id, userId: req.user.id });
  if (!note) {
    throw createError(404, "Note not found");
  }

  return sendItem(res, note);
});

export const updateNote = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const payload = pickNoteUpdates(req.body);
  validateNotePayload(payload, true);

  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: payload },
    { new: true, runValidators: true }
  );

  if (!note) {
    throw createError(404, "Note not found");
  }

  emitNotification(
    req,
    {
      eventId: `note_updated_${note._id}_${Date.now()}`,
      notificationType: "note_updated",
      itemType: "note",
      item: {
        id: String(note._id),
        title: note.title,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, note);
});

export const deleteNote = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id);

  const note = await Note.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!note) {
    throw createError(404, "Note not found");
  }

  emitNotification(
    req,
    {
      eventId: `note_deleted_${note._id}`,
      notificationType: "note_deleted",
      itemType: "note",
      item: {
        id: String(note._id),
        title: note.title,
      },
    },
    { userId: req.user.id }
  );

  return sendItem(res, note);
});
