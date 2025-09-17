import rateLimit from 'express-rate-limit';
// Temporarily disable Redis store to fix IPv6 issue

// General rate limiter for most endpoints
export const generalRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 2500000, // Limit each IP to 2500000 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: 1 * 60 // 1 minute in seconds
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});

// Strict rate limiter for notification endpoints
export const notificationRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20000, // Limit to 20 requests per minute per IP
    message: {
        error: 'Too many notification requests, please try again later.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});

// Rate limiter for unread counts endpoint
export const unreadCountsRateLimit = rateLimit({
    windowMs: 30 * 1000, // 30 seconds
    max: 30000, // 30 requests per 30 seconds
    message: {
        error: 'Too many unread count requests. Consider using WebSocket events instead of polling.',
        retryAfter: 30,
        suggestion: 'Use real-time Socket.IO events for live updates instead of frequent API calls.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});

// Rate limiter for chat endpoints
export const chatRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 50000, // 50 requests per minute
    message: {
        error: 'Too many chat requests, please try again later.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});

// Health check rate limiter (more lenient)
export const healthCheckRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 1000, // 10 health checks per 5 minutes
    message: {
        error: 'Too many health check requests.',
        retryAfter: 300
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});