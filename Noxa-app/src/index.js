import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './config/database.js';
import app from './app.js';

dotenv.config({ path: './.env' });

const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const startServer = async () => {
  try {
    await connectDB();

    const httpServer = createServer(app);

    const io = new Server(httpServer, {
      cors: {
        origin: CLIENT_URL,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        credentials: true
      }
    });

    app.set('io', io);

    io.on('connection', (socket) => {
      console.log('Socket connected:', socket.id);
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
