import { AiChatHistory } from "../models/aiChatHistory.model.js";
import { Goal } from "../models/goal.model.js";
import { Note } from "../models/note.model.js";
import { Reminder } from "../models/reminder.model.js";
import { Task } from "../models/task.model.js";

const parseDate = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value, withTime = false) => {
  const parsed = parseDate(value);
  if (!parsed) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(parsed);
};

const truncate = (value, maxLength = 160) => {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
};

const sortTasks = (left, right) => {
  const priorityRank = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const leftDueDate = parseDate(left?.dueDate);
  const rightDueDate = parseDate(right?.dueDate);
  if (leftDueDate && rightDueDate && leftDueDate.getTime() !== rightDueDate.getTime()) {
    return leftDueDate.getTime() - rightDueDate.getTime();
  }
  if (leftDueDate && !rightDueDate) return -1;
  if (!leftDueDate && rightDueDate) return 1;

  const priorityDiff =
    (priorityRank[String(left?.priority || "").toLowerCase()] ?? 99) -
    (priorityRank[String(right?.priority || "").toLowerCase()] ?? 99);
  if (priorityDiff !== 0) return priorityDiff;

  const leftCreatedAt = parseDate(left?.createdAt);
  const rightCreatedAt = parseDate(right?.createdAt);
  if (leftCreatedAt && rightCreatedAt) {
    return leftCreatedAt.getTime() - rightCreatedAt.getTime();
  }

  return 0;
};

const sortGoals = (left, right) => {
  const leftTargetDate = parseDate(left?.targetDate);
  const rightTargetDate = parseDate(right?.targetDate);
  if (leftTargetDate && rightTargetDate && leftTargetDate.getTime() !== rightTargetDate.getTime()) {
    return leftTargetDate.getTime() - rightTargetDate.getTime();
  }
  if (leftTargetDate && !rightTargetDate) return -1;
  if (!leftTargetDate && rightTargetDate) return 1;

  return Number(right?.progress ?? 0) - Number(left?.progress ?? 0);
};

const sortReminders = (left, right) => {
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
  return 0;
};

const formatTaskLine = (task) => {
  const dueDate = formatDate(task.dueDate);
  return `- ${task.title} | priority: ${task.priority || "medium"} | status: ${task.status || "pending"}${
    dueDate ? ` | due: ${dueDate}` : ""
  }`;
};

const formatGoalLine = (goal) => {
  const targetDate = formatDate(goal.targetDate);
  return `- ${goal.title} | progress: ${Number(goal.progress ?? 0)}%${
    targetDate ? ` | target: ${targetDate}` : ""
  }`;
};

const formatReminderLine = (reminder) => {
  const reminderTime = formatDate(reminder.reminderTime, true);
  return `- ${reminder.title} | status: ${reminder.status || "pending"}${
    reminderTime ? ` | reminder: ${reminderTime}` : ""
  }`;
};

const formatNoteLine = (note) => `- ${note.title}: ${truncate(note.content, 120)}`;

const buildRecentMemoryBlock = (history) => {
  const sessions = Array.isArray(history?.sessions) ? [...history.sessions] : [];
  const recentSessions = sessions
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 3);

  if (recentSessions.length === 0) {
    return {
      text: "",
      used: false,
    };
  }

  const lines = ["Recent conversation memory:"];

  for (const session of recentSessions) {
    lines.push(`Session: ${truncate(session.title || "New conversation", 80)}`);
    const messages = Array.isArray(session.messages) ? session.messages.slice(-4) : [];
    for (const message of messages) {
      lines.push(`${message.role}: ${truncate(message.content, 220)}`);
    }
  }

  return {
    text: lines.join("\n"),
    used: true,
  };
};

const buildWorkspaceBlock = ({ tasks, goals, reminders, notes }) => {
  const lines = ["Workspace snapshot:"];

  lines.push("Open tasks:");
  lines.push(...(tasks.length > 0 ? tasks.map(formatTaskLine) : ["- None"]));

  lines.push("Active goals:");
  lines.push(...(goals.length > 0 ? goals.map(formatGoalLine) : ["- None"]));

  lines.push("Upcoming reminders:");
  lines.push(...(reminders.length > 0 ? reminders.map(formatReminderLine) : ["- None"]));

  lines.push("Pinned or recent notes:");
  lines.push(...(notes.length > 0 ? notes.map(formatNoteLine) : ["- None"]));

  return lines.join("\n");
};

const buildFollowUpSuggestions = ({ tasks, goals, reminders, notes }) => {
  const suggestions = [];

  const topTask = tasks[0];
  if (topTask) {
    const dueDate = formatDate(topTask.dueDate);
    suggestions.push(
      dueDate
        ? `Prioritize "${topTask.title}" because it is due on ${dueDate}.`
        : `Prioritize "${topTask.title}" because it is one of the most urgent open tasks.`
    );
  }

  const topGoal = goals.find((goal) => Number(goal.progress ?? 0) >= 60) || goals[0];
  if (topGoal) {
    suggestions.push(
      `Keep "${topGoal.title}" moving by defining the next measurable step beyond ${Number(
        topGoal.progress ?? 0
      )}%.`
    );
  }

  const topReminder = reminders[0];
  if (topReminder) {
    const reminderTime = formatDate(topReminder.reminderTime, true);
    suggestions.push(
      reminderTime
        ? `Resolve "${topReminder.title}" before it comes back at ${reminderTime}.`
        : `Resolve "${topReminder.title}" before it becomes another open loop.`
    );
  }

  const pinnedNote = notes[0];
  if (pinnedNote && suggestions.length < 3) {
    suggestions.push(`Use "${pinnedNote.title}" as supporting context if you need to make a decision.`);
  }

  return suggestions.slice(0, 3);
};

export const getAiWorkspaceContext = async (userId) => {
  const [tasks, goals, reminders, notes, history] = await Promise.all([
    Task.find({
      userId,
      completed: { $ne: true },
      status: { $nin: ["completed", "cancelled"] },
    })
      .select("title priority status dueDate createdAt")
      .lean(),
    Goal.find({
      userId,
      completed: { $ne: true },
    })
      .select("title progress targetDate createdAt")
      .lean(),
    Reminder.find({
      userId,
      status: { $in: ["pending", "snoozed"] },
    })
      .select("title status reminderTime dueDate createdAt")
      .lean(),
    Note.find({ userId })
      .select("title content isPinned createdAt")
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(3)
      .lean(),
    AiChatHistory.findOne({ userId }).lean(),
  ]);

  const sortedTasks = [...tasks].sort(sortTasks).slice(0, 5);
  const sortedGoals = [...goals].sort(sortGoals).slice(0, 4);
  const sortedReminders = [...reminders].sort(sortReminders).slice(0, 4);
  const recentNotes = notes.slice(0, 3);
  const memory = buildRecentMemoryBlock(history);

  return {
    promptBlock: [buildWorkspaceBlock({
      tasks: sortedTasks,
      goals: sortedGoals,
      reminders: sortedReminders,
      notes: recentNotes,
    }), memory.text]
      .filter(Boolean)
      .join("\n\n"),
    workspaceSummary: {
      tasks: sortedTasks,
      goals: sortedGoals,
      reminders: sortedReminders,
      notes: recentNotes,
    },
    followUpSuggestions: buildFollowUpSuggestions({
      tasks: sortedTasks,
      goals: sortedGoals,
      reminders: sortedReminders,
      notes: recentNotes,
    }),
    memoryUsed: memory.used,
  };
};
