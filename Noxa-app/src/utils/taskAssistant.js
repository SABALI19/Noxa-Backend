import { Task } from "../models/task.model.js";

const PRIORITY_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
};

const parseDate = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDueDate = (value) => {
  const dueDate = parseDate(value);
  if (!dueDate) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dueDate);
};

const isTaskCompleted = (task = {}) => task?.completed === true || task?.status === "completed";

const isTaskClosed = (task = {}) => isTaskCompleted(task) || task?.status === "cancelled";

const getPriorityRank = (priority) => PRIORITY_ORDER[String(priority || "").toLowerCase()] ?? 99;

const compareTasks = (left, right) => {
  const leftDueDate = parseDate(left?.dueDate);
  const rightDueDate = parseDate(right?.dueDate);

  if (leftDueDate && rightDueDate && leftDueDate.getTime() !== rightDueDate.getTime()) {
    return leftDueDate.getTime() - rightDueDate.getTime();
  }

  if (leftDueDate && !rightDueDate) return -1;
  if (!leftDueDate && rightDueDate) return 1;

  const priorityDiff = getPriorityRank(left?.priority) - getPriorityRank(right?.priority);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const leftCreatedAt = parseDate(left?.createdAt);
  const rightCreatedAt = parseDate(right?.createdAt);

  if (leftCreatedAt && rightCreatedAt) {
    return leftCreatedAt.getTime() - rightCreatedAt.getTime();
  }

  return 0;
};

const addSuggestion = (suggestions, value) => {
  if (!value || suggestions.includes(value)) return;
  suggestions.push(value);
};

const getPendingTaskCandidates = async (userId, excludedTaskId) => {
  const excludedId = excludedTaskId ? String(excludedTaskId) : null;

  const tasks = await Task.find({
    userId,
    completed: { $ne: true },
    status: { $nin: ["completed", "cancelled"] },
  })
    .select("title dueDate priority status completed createdAt")
    .lean();

  return tasks
    .filter((task) => !excludedId || String(task._id) !== excludedId)
    .sort(compareTasks)
    .slice(0, 3);
};

const buildNextTaskSuggestion = (nextTask) => {
  if (!nextTask) return null;

  const dueDate = formatDueDate(nextTask.dueDate);
  if (dueDate) {
    return `Move to "${nextTask.title}" next because it is due on ${dueDate}.`;
  }

  return `Move to "${nextTask.title}" next while your momentum is still high.`;
};

const buildCreateSuggestions = (task, nextTask) => {
  const suggestions = [];
  const dueDate = formatDueDate(task.dueDate);
  const hasDescription = String(task.description || "").trim().length > 0;
  const reminderEnabled = task?.reminderSettings?.enabled === true;

  if (!dueDate) {
    addSuggestion(suggestions, `Add a due date for "${task.title}" so it has a clear finish line.`);
  }

  if (dueDate && !reminderEnabled) {
    addSuggestion(
      suggestions,
      `Turn on a reminder before ${dueDate} so "${task.title}" does not get lost.`
    );
  }

  if (!hasDescription) {
    addSuggestion(
      suggestions,
      `Add a short definition of done for "${task.title}" so the finish line is obvious.`
    );
  }

  if (task.priority === "high") {
    addSuggestion(
      suggestions,
      `Block focused time for "${task.title}" soon so a high-priority task does not stay theoretical.`
    );
  }

  addSuggestion(
    suggestions,
    `Write the first concrete step for "${task.title}" so you can start it without re-planning later.`
  );

  addSuggestion(suggestions, buildNextTaskSuggestion(nextTask));

  return suggestions.slice(0, 3);
};

const buildCompletedSuggestions = (task, nextTask) => {
  const suggestions = [];

  addSuggestion(suggestions, buildNextTaskSuggestion(nextTask));

  if (task.recurrence && task.recurrence !== "none") {
    addSuggestion(
      suggestions,
      `Schedule the next recurring instance of "${task.title}" now so the habit stays intact.`
    );
  }

  addSuggestion(
    suggestions,
    `Capture one quick note about what helped you finish "${task.title}" so it is easier to repeat.`
  );

  addSuggestion(
    suggestions,
    "Review your remaining task list and choose the next important win before you switch context."
  );

  return suggestions.slice(0, 3);
};

const buildReopenedSuggestions = (task, nextTask) => {
  const suggestions = [];
  const dueDate = formatDueDate(task.dueDate);

  addSuggestion(
    suggestions,
    `Clarify what is still unfinished in "${task.title}" so it does not stay half-open.`
  );

  if (dueDate) {
    addSuggestion(
      suggestions,
      `Recheck whether "${task.title}" can still land by ${dueDate}, and adjust the deadline if needed.`
    );
  }

  addSuggestion(
    suggestions,
    `Set the next action for "${task.title}" before leaving this screen so restarting is easy.`
  );

  addSuggestion(suggestions, buildNextTaskSuggestion(nextTask));

  return suggestions.slice(0, 3);
};

const buildInProgressSuggestions = (task, nextTask) => {
  const suggestions = [];
  const dueDate = formatDueDate(task.dueDate);

  addSuggestion(
    suggestions,
    `Define the single next action for "${task.title}" so progress stays visible.`
  );

  if (dueDate && task?.reminderSettings?.enabled !== true) {
    addSuggestion(
      suggestions,
      `Add a reminder ahead of ${dueDate} so "${task.title}" keeps moving while it is in progress.`
    );
  }

  addSuggestion(
    suggestions,
    `Protect a focused work block for "${task.title}" before other tasks start competing for attention.`
  );

  addSuggestion(suggestions, buildNextTaskSuggestion(nextTask));

  return suggestions.slice(0, 3);
};

const buildGeneralUpdateSuggestions = (task, nextTask) => {
  const suggestions = [];
  const dueDate = formatDueDate(task.dueDate);

  if (dueDate && task?.reminderSettings?.enabled !== true) {
    addSuggestion(
      suggestions,
      `Add a reminder before ${dueDate} so "${task.title}" stays visible.`
    );
  }

  addSuggestion(
    suggestions,
    `Review whether "${task.title}" still has a clear next action after this update.`
  );

  addSuggestion(
    suggestions,
    `Keep the scope of "${task.title}" narrow enough to finish in one or two focused sessions.`
  );

  addSuggestion(suggestions, buildNextTaskSuggestion(nextTask));

  return suggestions.slice(0, 3);
};

const buildDeleteSuggestions = (task, nextTask) => {
  const suggestions = [];

  addSuggestion(suggestions, buildNextTaskSuggestion(nextTask));

  addSuggestion(
    suggestions,
    `Make sure deleting "${task.title}" did not remove a commitment that should live in another task or note.`
  );

  addSuggestion(
    suggestions,
    "Use the freed-up time to promote one remaining task into your next priority slot."
  );

  return suggestions.slice(0, 3);
};

const buildSummary = (action, task, mode) => {
  if (action === "create") {
    return `"${task.title}" was added. Here are a few helpful next moves.`;
  }

  if (action === "delete") {
    return `"${task.title}" was removed. Here are a few ways to keep your plan aligned.`;
  }

  if (mode === "completed") {
    return `"${task.title}" is complete. Here is the best next follow-through.`;
  }

  if (mode === "reopened") {
    return `"${task.title}" is back on your list. These suggestions can help you restart cleanly.`;
  }

  if (mode === "in_progress") {
    return `"${task.title}" is in progress. These suggestions can help you keep it moving.`;
  }

  return `"${task.title}" was updated. Here are a few useful follow-ups.`;
};

const resolveUpdateMode = (previousTask, task) => {
  const wasCompleted = isTaskCompleted(previousTask);
  const isCompletedNow = isTaskCompleted(task);

  if (!wasCompleted && isCompletedNow) return "completed";
  if (wasCompleted && !isCompletedNow) return "reopened";
  if (task.status === "in_progress") return "in_progress";
  return "updated";
};

export const buildTaskAssistantSuggestions = async ({
  action,
  task,
  previousTask = null,
  userId,
}) => {
  if (!task || !userId) {
    return null;
  }

  const taskId = task?._id ? String(task._id) : null;
  const pendingTasks = isTaskClosed(task)
    ? await getPendingTaskCandidates(userId, taskId)
    : await getPendingTaskCandidates(userId, taskId);
  const nextTask = pendingTasks[0] || null;

  const mode = action === "update" ? resolveUpdateMode(previousTask, task) : action;

  let suggestions = [];

  if (action === "create") {
    suggestions = buildCreateSuggestions(task, nextTask);
  } else if (action === "delete") {
    suggestions = buildDeleteSuggestions(task, nextTask);
  } else if (mode === "completed") {
    suggestions = buildCompletedSuggestions(task, nextTask);
  } else if (mode === "reopened") {
    suggestions = buildReopenedSuggestions(task, nextTask);
  } else if (mode === "in_progress") {
    suggestions = buildInProgressSuggestions(task, nextTask);
  } else {
    suggestions = buildGeneralUpdateSuggestions(task, nextTask);
  }

  return {
    summary: buildSummary(action, task, mode),
    suggestions,
  };
};
