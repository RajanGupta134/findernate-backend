import dotenv from 'dotenv';
import connectDB from './db/index.js';
import { app } from './app.js';
import http from 'http';
import socketManager from './config/socket.js';

dotenv.config({
    path: './.env'
});

const server = http.createServer(app);

// 5. Connect to MongoDB, then start the server
connectDB()
    .then(() => {
        console.log('✅ Database connected successfully');

        // Initialize Socket.IO with our enhanced manager after DB connection
        socketManager.initialize(server);

        const PORT = process.env.PORT || 8000;
        server.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
            console.log('✅ Socket.IO ready for real-time communication');
        });
    })
    .catch((err) => {
        console.error("❌ MONGODB connection error:", err);
    });
