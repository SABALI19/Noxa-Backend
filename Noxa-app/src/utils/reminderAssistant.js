import { Reminder } from "../models/reminder.model.js";

const parseDate = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value) => {
  const parsed = parseDate(value);
  if (!parsed) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
};

const addSuggestion = (suggestions, value) => {
  if (!value || suggestions.includes(value)) return;
  suggestions.push(value);
};

const compareReminders = (left, right) => {
  const leftReminderTime = parseDate(left?.reminderTime);
  const rightReminderTime = parseDate(right?.reminderTime);

  if (
    leftReminderTime &&
    rightReminderTime &&
    leftReminderTime.getTime() !== rightReminderTime.getTime()
  ) {
    return leftReminderTime.getTime() - rightReminderTime.getTime();
  }

  if (leftReminderTime && !rightReminderTime) return -1;
  if (!leftReminderTime && rightReminderTime) return 1;

  const leftCreatedAt = parseDate(left?.createdAt);
  const rightCreatedAt = parseDate(right?.createdAt);
  if (leftCreatedAt && rightCreatedAt) {
    return leftCreatedAt.getTime() - rightCreatedAt.getTime();
  }

  return 0;
};

const getOpenReminderCandidates = async (userId, excludedReminderId) => {
  const excludedId = excludedReminderId ? String(excludedReminderId) : null;
  const reminders = await Reminder.find({
    userId,
    status: { $in: ["pending", "snoozed"] },
  })
    .select("title reminderTime dueDate status createdAt")
    .lean();

  return reminders
    .filter((reminder) => !excludedId || String(reminder._id) !== excludedId)
    .sort(compareReminders)
    .slice(0, 3);
};

const buildNextReminderSuggestion = (reminder) => {
  if (!reminder) return null;

  const reminderTime = formatDateTime(reminder.reminderTime);
  if (reminderTime) {
    return `Keep an eye on "${reminder.title}" next because it is scheduled for ${reminderTime}.`;
  }

  return `Keep an eye on "${reminder.title}" next so another open reminder does not slip.`;
};

const buildCreateSuggestions = (reminder, nextReminder) => {
  const suggestions = [];
  const reminderTime = formatDateTime(reminder.reminderTime);
  const dueDate = formatDateTime(reminder.dueDate);
  const hasNote = String(reminder.note || "").trim().length > 0;

  if (!hasNote) {
    addSuggestion(
      suggestions,
      `Add a short note to "${reminder.title}" so the reminder still makes sense when it fires.`
    );
  }

  if (reminder.frequency === "once") {
    addSuggestion(
      suggestions,
      `Double-check that ${reminderTime || "the reminder time"} gives you enough buffer before the due moment.`
    );
  }

  if (dueDate && reminderTime) {
    addSuggestion(
      suggestions,
      `Confirm that "${reminder.title}" still gives you enough time to act before ${dueDate}.`
    );
  }

  addSuggestion(suggestions, buildNextReminderSuggestion(nextReminder));

  return suggestions.slice(0, 3);
};

const buildCompletedSuggestions = (reminder, nextReminder) => {
  const suggestions = [];

  addSuggestion(suggestions, buildNextReminderSuggestion(nextReminder));

  if (reminder.frequency && reminder.frequency !== "once") {
    addSuggestion(
      suggestions,
      `Verify the next repeat of "${reminder.title}" is still scheduled the way you expect.`
    );
  }

  addSuggestion(
    suggestions,
    `Decide whether completing "${reminder.title}" should trigger a follow-up task, reminder, or note.`
  );

  return suggestions.slice(0, 3);
};

const buildReopenedSuggestions = (reminder, nextReminder) => {
  const suggestions = [];
  const reminderTime = formatDateTime(reminder.reminderTime);

  addSuggestion(
    suggestions,
    `Clarify why "${reminder.title}" is active again so it does not bounce back unresolved.`
  );

  if (reminderTime) {
    addSuggestion(
      suggestions,
      `Make sure "${reminder.title}" still has the right reminder time at ${reminderTime}.`
    );
  }

  addSuggestion(suggestions, buildNextReminderSuggestion(nextReminder));

  return suggestions.slice(0, 3);
};

const buildSnoozedSuggestions = (reminder, nextReminder) => {
  const suggestions = [];
  const reminderTime = formatDateTime(reminder.reminderTime);

  if (reminderTime) {
    addSuggestion(
      suggestions,
      `Protect a small action window before ${reminderTime} so "${reminder.title}" does not get snoozed again.`
    );
  }

  addSuggestion(
    suggestions,
    `Use the extra time from snoozing "${reminder.title}" to decide the exact action you will take when it returns.`
  );

  addSuggestion(suggestions, buildNextReminderSuggestion(nextReminder));

  return suggestions.slice(0, 3);
};

const buildGeneralUpdateSuggestions = (reminder, nextReminder) => {
  const suggestions = [];

  addSuggestion(
    suggestions,
    `Review whether "${reminder.title}" still has the right timing and level of urgency after this update.`
  );
  addSuggestion(
    suggestions,
    `Keep the wording of "${reminder.title}" specific enough that future-you knows exactly what to do.`
  );
  addSuggestion(suggestions, buildNextReminderSuggestion(nextReminder));

  return suggestions.slice(0, 3);
};

const buildDeleteSuggestions = (reminder, nextReminder) => {
  const suggestions = [];

  addSuggestion(suggestions, buildNextReminderSuggestion(nextReminder));
  addSuggestion(
    suggestions,
    `Make sure deleting "${reminder.title}" does not remove a commitment that still needs another reminder or task.`
  );
  addSuggestion(
    suggestions,
    "Use the reduced reminder load to keep the remaining reminders sharper and more actionable."
  );

  return suggestions.slice(0, 3);
};

const resolveUpdateMode = (previousReminder, reminder) => {
  if (previousReminder?.status !== "completed" && reminder?.status === "completed") return "completed";
  if (previousReminder?.status === "completed" && reminder?.status !== "completed") return "reopened";
  if (reminder?.status === "snoozed") return "snoozed";
  return "updated";
};

const buildSummary = (action, reminder, mode) => {
  if (action === "create") {
    return `"${reminder.title}" was added. Here are a few helpful follow-ups.`;
  }

  if (action === "delete") {
    return `"${reminder.title}" was removed. Here are a few ways to keep your reminders clean.`;
  }

  if (action === "snooze" || mode === "snoozed") {
    return `"${reminder.title}" was snoozed. These suggestions can help the extra time count.`;
  }

  if (mode === "completed") {
    return `"${reminder.title}" is complete. Here is the best next follow-through.`;
  }

  if (mode === "reopened") {
    return `"${reminder.title}" is active again. These suggestions can help you reset it cleanly.`;
  }

  return `"${reminder.title}" was updated. Here are a few useful follow-ups.`;
};

export const buildReminderAssistantSuggestions = async ({
  action,
  reminder,
  previousReminder = null,
  userId,
}) => {
  if (!reminder || !userId) {
    return null;
  }

  const nextReminder =
    (await getOpenReminderCandidates(userId, reminder?._id ? String(reminder._id) : null))[0] || null;
  const mode = action === "update" || action === "snooze"
    ? resolveUpdateMode(previousReminder, reminder)
    : action;

  let suggestions = [];

  if (action === "create") {
    suggestions = buildCreateSuggestions(reminder, nextReminder);
  } else if (action === "delete") {
    suggestions = buildDeleteSuggestions(reminder, nextReminder);
  } else if (action === "snooze" || mode === "snoozed") {
    suggestions = buildSnoozedSuggestions(reminder, nextReminder);
  } else if (mode === "completed") {
    suggestions = buildCompletedSuggestions(reminder, nextReminder);
  } else if (mode === "reopened") {
    suggestions = buildReopenedSuggestions(reminder, nextReminder);
  } else {
    suggestions = buildGeneralUpdateSuggestions(reminder, nextReminder);
  }

  return {
    summary: buildSummary(action, reminder, mode),
    suggestions,
  };
};
