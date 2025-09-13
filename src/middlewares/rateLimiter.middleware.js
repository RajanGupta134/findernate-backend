import rateLimit from 'express-rate-limit';
import { redisClient } from '../config/redis.config.js';

// Store for rate limiter using Redis
const redisStore = {
    async incr(key) {
        const current = await redisClient.incr(key);
        if (current === 1) {
            await redisClient.expire(key, this.windowMs / 1000);
        }
        return { totalHits: current, resetTime: new Date(Date.now() + this.windowMs) };
    },
    
    async decrement(key) {
        return redisClient.decr(key);
    },
    
    async resetKey(key) {
        return redisClient.del(key);
    }
};

// General rate limiter for most endpoints
export const generalRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: 15 * 60 // 15 minutes in seconds
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: process.env.NODE_ENV === 'production' ? redisStore : undefined
});

// Strict rate limiter for notification endpoints
export const notificationRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // Limit to 20 requests per minute per IP
    message: {
        error: 'Too many notification requests, please try again later.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: process.env.NODE_ENV === 'production' ? redisStore : undefined,
    keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise IP
        return req.user?._id || req.ip;
    }
});

// Very strict rate limiter for unread counts endpoint
export const unreadCountsRateLimit = rateLimit({
    windowMs: 30 * 1000, // 30 seconds
    max: 5, // Only 5 requests per 30 seconds
    message: {
        error: 'Too many unread count requests. Consider using WebSocket events instead of polling.',
        retryAfter: 30,
        suggestion: 'Use real-time Socket.IO events for live updates instead of frequent API calls.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: process.env.NODE_ENV === 'production' ? redisStore : undefined,
    keyGenerator: (req) => {
        return req.user?._id || req.ip;
    }
});

// Rate limiter for chat endpoints
export const chatRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 50, // 50 requests per minute
    message: {
        error: 'Too many chat requests, please try again later.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: process.env.NODE_ENV === 'production' ? redisStore : undefined,
    keyGenerator: (req) => {
        return req.user?._id || req.ip;
    }
});

// Health check rate limiter (more lenient)
export const healthCheckRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 health checks per 5 minutes
    message: {
        error: 'Too many health check requests.',
        retryAfter: 300
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: process.env.NODE_ENV === 'production' ? redisStore : undefined
});