import { Goal } from "../models/goal.model.js";

const parseDate = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const parsed = parseDate(value);
  if (!parsed) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
};

const addSuggestion = (suggestions, value) => {
  if (!value || suggestions.includes(value)) return;
  suggestions.push(value);
};

const compareGoals = (left, right) => {
  const leftTargetDate = parseDate(left?.targetDate);
  const rightTargetDate = parseDate(right?.targetDate);

  if (leftTargetDate && rightTargetDate && leftTargetDate.getTime() !== rightTargetDate.getTime()) {
    return leftTargetDate.getTime() - rightTargetDate.getTime();
  }

  if (leftTargetDate && !rightTargetDate) return -1;
  if (!leftTargetDate && rightTargetDate) return 1;

  const leftProgress = Number(left?.progress ?? 0);
  const rightProgress = Number(right?.progress ?? 0);
  if (leftProgress !== rightProgress) {
    return rightProgress - leftProgress;
  }

  const leftCreatedAt = parseDate(left?.createdAt);
  const rightCreatedAt = parseDate(right?.createdAt);
  if (leftCreatedAt && rightCreatedAt) {
    return leftCreatedAt.getTime() - rightCreatedAt.getTime();
  }

  return 0;
};

const getActiveGoalCandidates = async (userId, excludedGoalId) => {
  const excludedId = excludedGoalId ? String(excludedGoalId) : null;
  const goals = await Goal.find({
    userId,
    completed: { $ne: true },
  })
    .select("title targetDate progress completed createdAt")
    .lean();

  return goals
    .filter((goal) => !excludedId || String(goal._id) !== excludedId)
    .sort(compareGoals)
    .slice(0, 3);
};

const buildNextGoalSuggestion = (goal) => {
  if (!goal) return null;

  const targetDate = formatDate(goal.targetDate);
  if (targetDate) {
    return `Recenter on "${goal.title}" next because its target date is ${targetDate}.`;
  }

  return `Recenter on "${goal.title}" next so another active goal keeps moving.`;
};

const buildCreateSuggestions = (goal, nextGoal) => {
  const suggestions = [];
  const targetDate = formatDate(goal.targetDate);
  const milestones = Array.isArray(goal.milestones) ? goal.milestones : [];
  const hasDescription = String(goal.description || "").trim().length > 0;

  if (!targetDate) {
    addSuggestion(suggestions, `Add a target date for "${goal.title}" so the goal has a real horizon.`);
  }

  if (milestones.length === 0) {
    addSuggestion(
      suggestions,
      `Break "${goal.title}" into one or two milestones so progress is easier to protect.`
    );
  }

  if (!hasDescription) {
    addSuggestion(
      suggestions,
      `Write a short success definition for "${goal.title}" so the outcome stays concrete.`
    );
  }

  addSuggestion(
    suggestions,
    `Choose the next measurable action for "${goal.title}" so the goal starts moving immediately.`
  );

  addSuggestion(suggestions, buildNextGoalSuggestion(nextGoal));

  return suggestions.slice(0, 3);
};

const buildCompletedSuggestions = (goal, nextGoal) => {
  const suggestions = [];

  addSuggestion(suggestions, buildNextGoalSuggestion(nextGoal));
  addSuggestion(
    suggestions,
    `Capture what worked while finishing "${goal.title}" so you can reuse that approach on the next goal.`
  );
  addSuggestion(
    suggestions,
    `Decide whether "${goal.title}" should lead to a maintenance habit, recurring task, or new stretch goal.`
  );

  return suggestions.slice(0, 3);
};

const buildReopenedSuggestions = (goal, nextGoal) => {
  const suggestions = [];
  const targetDate = formatDate(goal.targetDate);

  addSuggestion(
    suggestions,
    `Clarify what changed for "${goal.title}" so reopening it leads to action instead of drift.`
  );

  if (targetDate) {
    addSuggestion(
      suggestions,
      `Check whether "${goal.title}" can still land by ${targetDate}, and adjust the target date if needed.`
    );
  }

  addSuggestion(
    suggestions,
    `Pick the next measurable checkpoint for "${goal.title}" before leaving this update.`
  );

  addSuggestion(suggestions, buildNextGoalSuggestion(nextGoal));

  return suggestions.slice(0, 3);
};

const buildProgressSuggestions = (goal, nextGoal) => {
  const suggestions = [];
  const progress = Number(goal.progress ?? 0);

  addSuggestion(
    suggestions,
    `Lock in the next milestone for "${goal.title}" so progress continues past ${progress}%.`
  );
  addSuggestion(
    suggestions,
    `Make sure your next action for "${goal.title}" is specific enough to complete in one focused session.`
  );
  addSuggestion(suggestions, buildNextGoalSuggestion(nextGoal));

  return suggestions.slice(0, 3);
};

const buildGeneralUpdateSuggestions = (goal, nextGoal) => {
  const suggestions = [];

  addSuggestion(
    suggestions,
    `Review whether "${goal.title}" still has a clear next checkpoint after this update.`
  );
  addSuggestion(
    suggestions,
    `Keep the scope of "${goal.title}" realistic enough that progress can stay visible each week.`
  );
  addSuggestion(suggestions, buildNextGoalSuggestion(nextGoal));

  return suggestions.slice(0, 3);
};

const buildDeleteSuggestions = (goal, nextGoal) => {
  const suggestions = [];

  addSuggestion(suggestions, buildNextGoalSuggestion(nextGoal));
  addSuggestion(
    suggestions,
    `Make sure removing "${goal.title}" does not erase an outcome that should live in a task, note, or different goal.`
  );
  addSuggestion(
    suggestions,
    "Use the freed capacity to recommit to one active goal instead of scattering attention."
  );

  return suggestions.slice(0, 3);
};

const resolveUpdateMode = (previousGoal, goal, updates) => {
  if (previousGoal?.completed !== true && goal?.completed === true) return "completed";
  if (previousGoal?.completed === true && goal?.completed !== true) return "reopened";
  if (updates?.progress !== undefined && Number(previousGoal?.progress ?? 0) !== Number(goal?.progress ?? 0)) {
    return "progress";
  }
  if (updates?.milestones !== undefined) return "milestones";
  return "updated";
};

const buildSummary = (action, goal, mode) => {
  if (action === "create") {
    return `"${goal.title}" was added. Here are a few smart next moves.`;
  }

  if (action === "delete") {
    return `"${goal.title}" was removed. Here are a few ways to keep your direction clear.`;
  }

  if (mode === "completed") {
    return `"${goal.title}" is complete. Here is the best next follow-through.`;
  }

  if (mode === "reopened") {
    return `"${goal.title}" is active again. These suggestions can help you restart cleanly.`;
  }

  if (mode === "progress") {
    return `"${goal.title}" moved forward. These suggestions can help you keep momentum.`;
  }

  return `"${goal.title}" was updated. Here are a few useful follow-ups.`;
};

export const buildGoalAssistantSuggestions = async ({
  action,
  goal,
  previousGoal = null,
  updates = null,
  userId,
}) => {
  if (!goal || !userId) {
    return null;
  }

  const nextGoal = (await getActiveGoalCandidates(userId, goal?._id ? String(goal._id) : null))[0] || null;
  const mode = action === "update" ? resolveUpdateMode(previousGoal, goal, updates) : action;

  let suggestions = [];

  if (action === "create") {
    suggestions = buildCreateSuggestions(goal, nextGoal);
  } else if (action === "delete") {
    suggestions = buildDeleteSuggestions(goal, nextGoal);
  } else if (mode === "completed") {
    suggestions = buildCompletedSuggestions(goal, nextGoal);
  } else if (mode === "reopened") {
    suggestions = buildReopenedSuggestions(goal, nextGoal);
  } else if (mode === "progress" || mode === "milestones") {
    suggestions = buildProgressSuggestions(goal, nextGoal);
  } else {
    suggestions = buildGeneralUpdateSuggestions(goal, nextGoal);
  }

  return {
    summary: buildSummary(action, goal, mode),
    suggestions,
  };
};
