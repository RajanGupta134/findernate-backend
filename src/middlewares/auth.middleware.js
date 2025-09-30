import { asyncHandler } from "../utlis/asyncHandler.js";
import { ApiError } from "../utlis/ApiError.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.models.js";
import { redisClient } from "../config/redis.config.js";


export const verifyJWT = asyncHandler(async (req, _, next) => {
    try {
        let token;

        if (req.cookies?.accessToken) {
            token = req.cookies.accessToken;
        }

        else if (req.headers?.authorization && req.headers.authorization.startsWith("Bearer ")) {
            token = req.headers.authorization.split(" ")[1];
        }

        if (!token) {
            throw new ApiError(401, "Unauthorized request");
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

        // OPTIMIZED: Cache user data in Redis for 15 minutes
        const cacheKey = `fn:user:${decodedToken._id}:auth`;
        let user;

        try {
            const cachedUser = await redisClient.get(cacheKey);
            if (cachedUser) {
                user = JSON.parse(cachedUser);
            }
        } catch (cacheError) {
            console.error('Redis cache error in auth:', cacheError);
            // Continue without cache if Redis fails
        }

        // If not in cache, fetch from database
        if (!user) {
            user = await User.findById(decodedToken._id)
                .select("-password -refreshToken")
                .lean(); // Use lean() for faster query

            if (!user) {
                throw new ApiError(401, "Invalid Access Token");
            }

            // Cache for 15 minutes (900 seconds)
            try {
                await redisClient.setex(cacheKey, 900, JSON.stringify(user));
            } catch (cacheError) {
                console.error('Redis cache set error in auth:', cacheError);
                // Continue even if caching fails
            }
        }

        req.user = user;
        next();
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid access token");
    }
});

// Optional JWT verification - continues without error if no token or invalid token
export const optionalVerifyJWT = asyncHandler(async (req, _, next) => {
    try {
        let token;

        if (req.cookies?.accessToken) {
            token = req.cookies.accessToken;
        }
        else if (req.headers?.authorization && req.headers.authorization.startsWith("Bearer ")) {
            token = req.headers.authorization.split(" ")[1];
        }

        // If no token is provided, continue without setting req.user
        if (!token) {
            return next();
        }

        // Try to verify the token
        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

        // OPTIMIZED: Cache optional auth too
        const cacheKey = `fn:user:${decodedToken._id}:auth`;
        let user;

        try {
            const cachedUser = await redisClient.get(cacheKey);
            if (cachedUser) {
                user = JSON.parse(cachedUser);
            }
        } catch (cacheError) {
            // Silently fail for optional auth
        }

        if (!user) {
            user = await User.findById(decodedToken._id)
                .select("-password -refreshToken")
                .lean();

            if (user) {
                try {
                    await redisClient.setex(cacheKey, 900, JSON.stringify(user));
                } catch (cacheError) {
                    // Silently fail
                }
            }
        }

        // If user is found, set req.user
        if (user) {
            req.user = user;
        }

        next();
    } catch (error) {
        // If token verification fails, continue without setting req.user
        next();
    }
});

