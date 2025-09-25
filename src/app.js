import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { errorHandler } from './middlewares/errorHandler.js';
import { redisHealthCheck } from './config/redis.config.js';
import { generalRateLimit, healthCheckRateLimit } from './middlewares/rateLimiter.middleware.js';

const app = express();

// Performance middleware - Enable gzip compression
app.use(compression({
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    },
    level: 6, // Compression level 1-9 (6 is good balance)
    threshold: 1024, // Only compress responses > 1KB
}));

// Request parsing middleware
app.use(express.json({ limit: '10mb' })); // Limit JSON payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


const allowedOrigins = [
        "https://eckss0cw0ggco0okoocc4wo4.194.164.151.15.sslip.io",
        "https://p0k804os4c4scowcg488800c.194.164.151.15.sslip.io",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:4000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:4000",
        // Add environment variable for additional origins
        ...(process.env.ADDITIONAL_CORS_ORIGINS ? process.env.ADDITIONAL_CORS_ORIGINS.split(',') : [])
];


app.use(cors({
        origin: function (origin, callback) {
                if (!origin || allowedOrigins.includes(origin)) {
                        callback(null, true);
                } else {
                        callback(new Error("Not allowed by CORS"));
                }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: [
                "Content-Type",
                "Authorization",
                "X-Requested-With",
                "Accept",
                "Origin",
                "Access-Control-Request-Method",
                "Access-Control-Request-Headers"
        ],
        exposedHeaders: ["Set-Cookie"],
        optionsSuccessStatus: 200,
        preflightContinue: false
}));

app.use(cookieParser());

// Trust proxy for production (behind load balancer/reverse proxy)
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Explicit preflight handler for all routes
app.options('*', (req, res) => {
        res.status(200).end();
});

// Apply general rate limiting to all routes
app.use(generalRateLimit);

// Health check endpoint for monitoring
app.get('/', healthCheckRateLimit, (req, res) => {
        res.status(200).json({
                message: 'FinderNate Backend API is running!',
                status: 'healthy',
                timestamp: new Date().toISOString(),
                port: process.env.PORT || 3000,
                host: req.get('host')
        });
});

// Simple debug endpoint
app.get('/debug', (req, res) => {
        res.status(200).json({
                message: 'Debug endpoint working',
                port: process.env.PORT || 3000,
                env: process.env.NODE_ENV,
                timestamp: new Date().toISOString()
        });
});

app.get('/health', healthCheckRateLimit, async (req, res) => {
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
import feedbackRouter from "./routes/feedback.routes.js";
import qrRouter from "./routes/qr.routes.js";


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
app.use("/api/v1/feedback", feedbackRouter);
app.use("/api/v1/qr", qrRouter);

app.use(errorHandler);

export { app };
