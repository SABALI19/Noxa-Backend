import cors from "cors";
import express from "express";

import aiRouter from "./routes/ai.route.js";
import goalsRouter from "./routes/goals.route.js";
import notesRouter from "./routes/notes.route.js";
import remindersRouter from "./routes/reminders.route.js";
import tasksRouter from "./routes/tasks.route.js";
import trackingRouter from "./routes/tracking.route.js";
import usersRouter from "./routes/users.route.js";

const app = express();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors({
  origin: CLIENT_URL,
  credentials: true
}));
app.use(express.json());

app.use("/api", aiRouter);
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/tasks", tasksRouter);
app.use("/api/v1/reminders", remindersRouter);
app.use("/api/v1/goals", goalsRouter);
app.use("/api/v1/notes", notesRouter);
app.use("/api/v1/tracking", trackingRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    message: statusCode >= 500 ? "Internal server error" : error.message,
  });
});

export default app;
