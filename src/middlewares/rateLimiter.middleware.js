import rateLimit from 'express-rate-limit';
// Temporarily disable Redis store to fix IPv6 issue

// General rate limiter for most endpoints
export const generalRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10000000, // 10M requests per minute for high traffic
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: 30 // 30 seconds
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for OPTIONS requests (CORS preflight)
    skip: (req) => req.method === 'OPTIONS',
    // In development, don't trust proxy headers for rate limiting
    trustProxy: process.env.NODE_ENV === 'production',
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});

// Rate limiter for notification endpoints
export const notificationRateLimit = rateLimit({
    windowMs: 30 * 1000, // 30 seconds
    max: 100000, // 100k requests per 30 seconds
    message: {
        error: 'Too many notification requests, please try again later.',
        retryAfter: 30
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: process.env.NODE_ENV === 'production',
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});

// Rate limiter for unread counts endpoint
export const unreadCountsRateLimit = rateLimit({
    windowMs: 10 * 1000, // 10 seconds
    max: 500000, // 500k requests per 10 seconds
    message: {
        error: 'Too many unread count requests. Consider using WebSocket events instead of polling.',
        retryAfter: 10,
        suggestion: 'Use real-time Socket.IO events for live updates instead of frequent API calls.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: process.env.NODE_ENV === 'production',
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});

// Rate limiter for chat endpoints
export const chatRateLimit = rateLimit({
    windowMs: 30 * 1000, // 30 seconds
    max: 1000000, // 1M requests per 30 seconds
    message: {
        error: 'Too many chat requests, please try again later.',
        retryAfter: 30
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: process.env.NODE_ENV === 'production',
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});

// Health check rate limiter (more lenient)
export const healthCheckRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100000, // 100k health checks per minute
    message: {
        error: 'Too many health check requests.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for OPTIONS requests (CORS preflight)
    skip: (req) => req.method === 'OPTIONS',
    trustProxy: process.env.NODE_ENV === 'production',
    // Temporarily using memory store instead of Redis to fix IPv6 issue
});