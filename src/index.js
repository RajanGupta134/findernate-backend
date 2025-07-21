import dotenv from 'dotenv';
import connectDB from './db/index.js';
import { app } from './app.js';
import { Server } from 'socket.io';
import http from 'http';

dotenv.config({
    path: './.env'
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

global.io = io;

const onlineUsers = new Map();
global.onlineUsers = onlineUsers;

io.on("connection", (socket) => {
    console.log("🔌 New client connected:", socket.id);

    socket.on("register", (userId) => {
        console.log(`✅ User ${userId} registered with socket ${socket.id}`);
        onlineUsers.set(userId, socket.id);
    });

    socket.on("disconnect", () => {
        console.log(`❌ Disconnected socket: ${socket.id}`);
        for (let [key, value] of onlineUsers.entries()) {
            if (value === socket.id) {
                onlineUsers.delete(key);
                break;
            }
        }
    });
});

// 5. Connect to MongoDB, then start the server
connectDB()
    .then(() => {
        const PORT = process.env.PORT || 8000;
        server.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error("❌ MONGODB connection error:", err);
    });
