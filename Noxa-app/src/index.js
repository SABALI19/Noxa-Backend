import "dotenv/config";
import { createServer } from 'http';
import jwt from "jsonwebtoken";
import { Server } from 'socket.io';
import connectDB from './config/database.js';
import app from './app.js';
import { JWT_SECRET } from "./config/constants.js";
import { getUserRoom } from "./utils/emitNotification.js";

const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const resolveSocketToken = (socket) => {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const authorizationHeader = socket.handshake?.headers?.authorization;
  if (typeof authorizationHeader === "string") {
    const [scheme, token] = authorizationHeader.split(" ");
    if (scheme === "Bearer" && token) {
      return token.trim();
    }
  }

  return null;
};

const resolveSocketUserId = (socket) => {
  const token = resolveSocketToken(socket);
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.sub || payload?.type !== "access") {
      return null;
    }

    return String(payload.sub);
  } catch (_error) {
    return null;
  }
};

const startServer = async () => {
  try {
    await connectDB();

    const httpServer = createServer(app);

    const io = new Server(httpServer, {
      cors: {
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        credentials: true
      }
    });

    app.set('io', io);

    io.on('connection', (socket) => {
      const userId = resolveSocketUserId(socket);

      if (userId) {
        const userRoom = getUserRoom(userId);
        socket.join(userRoom);
        socket.data.userId = userId;
        console.log(`Socket connected: ${socket.id} (user: ${userId})`);
      } else {
        console.log(`Socket connected: ${socket.id} (no auth token)`);
      }

      socket.on('disconnect', () => {
        console.log('Socket disconnected:', socket.id);
      });
    });

    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the other process or set a different PORT.`);
        process.exit(1);
      }

      console.error('Server error:', error);
      process.exit(1);
    });
  } catch (error) {
    console.error('MongoDB connection failed!!', error);
    process.exit(1);
  }
};

startServer();
