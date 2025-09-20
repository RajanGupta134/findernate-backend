import rateLimit from 'express-rate-limit';

// Rate limiting for HMS token generation - more restrictive
export const hmsTokenLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 token requests per windowMs
    message: {
        error: 'Too many token requests from this IP, please try again after 15 minutes.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: 'Too many HMS token requests from this IP, please try again after 15 minutes.',
            retryAfter: '15 minutes'
        });
    }
});

// Rate limiting for room creation - moderate
export const roomCreationLimit = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5, // limit each IP to 5 room creation requests per windowMs
    message: {
        error: 'Too many room creation requests from this IP, please try again after 10 minutes.',
        retryAfter: '10 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: 'Too many room creation requests from this IP, please try again after 10 minutes.',
            retryAfter: '10 minutes'
        });
    }
});

// Rate limiting for session analytics - less restrictive
export const analyticsLimit = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // limit each IP to 20 analytics requests per windowMs
    message: {
        error: 'Too many analytics requests from this IP, please try again after 5 minutes.',
        retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: 'Too many analytics requests from this IP, please try again after 5 minutes.',
            retryAfter: '5 minutes'
        });
    }
});

// Rate limiting for general HMS operations
export const hmsGeneralLimit = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 30, // limit each IP to 30 general HMS requests per windowMs
    message: {
        error: 'Too many HMS requests from this IP, please try again after 5 minutes.',
        retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: 'Too many HMS requests from this IP, please try again after 5 minutes.',
            retryAfter: '5 minutes'
        });
    }
});