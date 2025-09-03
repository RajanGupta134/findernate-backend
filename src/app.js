import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middlewares/errorHandler.js';
import { redisHealthCheck } from './config/redis.config.js';

const app = express();


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
        origin: [
                "*",
                "https://findernate-frontend-pq94.vercel.app",
                "https://findernate.netlify.app/",
                "https://findernate1.vercel.app",
                "https://findernate-test.vercel.app",
                "https://findernate.vercel.app",
                "http://localhost:3000",

        ],
        credentials: true
}));

app.use(cookieParser());

// Health check endpoint for monitoring
app.get('/', (req, res) => {
        res.status(200).json({
                message: 'FinderNate Backend API is running!',
                status: 'healthy',
                timestamp: new Date().toISOString()
        });
});

app.get('/health', async (req, res) => {
        try {
                const redisStatus = await redisHealthCheck();
                const memoryUsage = process.memoryUsage();
                const cpuUsage = process.cpuUsage();
                
                res.status(200).json({
                        status: 'healthy',
                        uptime: process.uptime(),
                        timestamp: new Date().toISOString(),
                        services: {
                                redis: redisStatus ? 'connected' : 'disconnected'
                        },
                        system: {
                                memory: {
                                        used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                                        total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
                                        external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB'
                                },
                                cpu: {
                                        user: cpuUsage.user,
                                        system: cpuUsage.system
                                },
                                platform: process.platform,
                                nodeVersion: process.version,
                                pid: process.pid
                        }
                });
        } catch (error) {
                res.status(503).json({
                        status: 'unhealthy',
                        error: error.message,
                        timestamp: new Date().toISOString()
                });
        }
});

//import route
import userRouter from './routes/user.routes.js';
import postRouter from './routes/post.routes.js';
import storyRouter from './routes/story.routes.js';
import reelRouter from "./routes/reel.routes.js";
import exploreRouter from "./routes/explore.routes.js";
import businessRouter from "./routes/business.routes.js";
import chatRouter from "./routes/chat.routes.js";
import mediaRouter from "./routes/media.routes.js";
import suggestedForYouRouter from "./routes/suggestedForYou.routes.js";
import trendingBusinessOwnersRouter from "./routes/trendingBusinessOwners.routes.js";
import contactRequestRouter from "./routes/contactRequest.routes.js";
import notificationRouter from "./routes/notification.routes.js";
import pushNotificationRouter from "./routes/pushNotification.routes.js";
import callRouter from "./routes/call.routes.js";
import adminRouter from "./routes/admin.routes.js";
import productRouter from "./routes/product.routes.js";
import categoryRouter from "./routes/category.routes.js";


app.use("/api/v1/users", userRouter);
app.use("/api/v1/posts", postRouter);
app.use("/api/v1/stories", storyRouter);
app.use("/api/v1/reels", reelRouter);
app.use("/api/v1/explore", exploreRouter);
app.use("/api/v1/business", businessRouter);
app.use("/api/v1/chats", chatRouter);
app.use("/api/v1/media", mediaRouter);
app.use("/api/v1/suggestions", suggestedForYouRouter);
app.use("/api/v1/business-owners", trendingBusinessOwnersRouter);
app.use("/api/v1/contact-requests", contactRequestRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/push", pushNotificationRouter);
app.use("/api/v1/calls", callRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/categories", categoryRouter);

app.use(errorHandler);

export { app };
