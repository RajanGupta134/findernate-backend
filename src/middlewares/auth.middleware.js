import { asyncHandler } from "../utlis/asyncHandler.js";
import { ApiError } from "../utlis/ApiError.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.models.js";


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

        const user = await User.findById(decodedToken?._id).select("-password -refreshToken");

        if (!user) {
            throw new ApiError(401, "Invalid Access Token");
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
        const user = await User.findById(decodedToken?._id).select("-password -refreshToken");

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

