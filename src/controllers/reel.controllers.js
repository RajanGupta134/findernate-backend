import { asyncHandler } from "../utlis/asyncHandler.js";
import { cloudinary } from "../utlis/cloudinary.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";

// Simple in-memory cache
const cache = {
    suggestedReels: {
        data: null,
        timestamp: null,
        expiry: 5 * 60 * 1000 // 5 minutes
    },
    cloudinaryReels: {
        data: null,
        timestamp: null,
        expiry: 5 * 60 * 1000 // 5 minutes
    }
};

// 1. Get suggested reels (from Cloudinary)
export const getSuggestedReels = asyncHandler(async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const max_results = Number(limit);
        const next_cursor = req.query.next_cursor || undefined;

        // Check cache first if no cursor (first page)
        if (!next_cursor &&
            cache.suggestedReels.data &&
            cache.suggestedReels.timestamp &&
            (Date.now() - cache.suggestedReels.timestamp < cache.suggestedReels.expiry)) {

            return res.status(200).json(
                new ApiResponse(200, cache.suggestedReels.data, "Reels fetched from cache")
            );
        }

        // Fetch only videos from Cloudinary
        let search = cloudinary.search
            .expression('resource_type:video')
            .sort_by('created_at', 'desc')
            .max_results(max_results);
        if (next_cursor) search = search.next_cursor(next_cursor);

        const result = await search.execute();

        // Enhanced reels with additional fields
        const enhancedReels = result.resources.map(reel => ({
            ...reel,
            engagement: {
                likes: 0,
                comments: 0,
                shares: 0,
                saves: 0,
                views: 0,
                reach: 0,
                impressions: 0
            },
            settings: {
                visibility: "public",
                allowComments: true,
                allowLikes: true,
                customAudience: []
            },
            status: "published",
            isPromoted: false,
            isFeatured: false,
            isReported: false,
            reportCount: 0
        }));

        const responseData = {
            reels: enhancedReels,
            pagination: {
                page: Number(page),
                limit: max_results,
                next_cursor: result.next_cursor || null
            }
        };

        // Save to cache if it's the first page
        if (!next_cursor) {
            cache.suggestedReels.data = responseData;
            cache.suggestedReels.timestamp = Date.now();
        }

        return res.status(200).json(
            new ApiResponse(200, responseData, "Reels fetched from Cloudinary successfully")
        );
    } catch (error) {
        // Check for rate limit error
        if (error.error && error.error.http_code === 420) {
            const resetTime = error.error.message.match(/Try again on (.*) UTC/);
            const resetTimeString = resetTime ? resetTime[1] : "unknown time";

            return res.status(429).json(
                new ApiResponse(429, {}, `Cloudinary rate limit exceeded. Please try again later. Rate limit resets at ${resetTimeString} UTC`)
            );
        }

        console.error("Error fetching reels:", error);
        return res.status(500).json(
            new ApiResponse(500, {}, "Error fetching reels from Cloudinary")
        );
    }
});

// Fetch reels directly from Cloudinary
export const getCloudinaryReels = asyncHandler(async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const max_results = Number(limit);
        const next_cursor = req.query.next_cursor || undefined;

        // Check cache first if no cursor (first page)
        if (!next_cursor &&
            cache.cloudinaryReels.data &&
            cache.cloudinaryReels.timestamp &&
            (Date.now() - cache.cloudinaryReels.timestamp < cache.cloudinaryReels.expiry)) {

            return res.status(200).json(
                new ApiResponse(200, cache.cloudinaryReels.data, "Reels fetched from cache")
            );
        }

        // Try a broader search: fetch all images and videos
        let search = cloudinary.search
            .expression('resource_type:video OR resource_type:image')
            .sort_by('created_at', 'desc')
            .max_results(max_results);
        if (next_cursor) search = search.next_cursor(next_cursor);

        const result = await search.execute();

        // Enhanced reels with additional fields
        const enhancedReels = result.resources.map(reel => ({
            ...reel,
            engagement: {
                likes: 0,
                comments: 0,
                shares: 0,
                saves: 0,
                views: 0,
                reach: 0,
                impressions: 0
            },
            settings: {
                visibility: "public",
                allowComments: true,
                allowLikes: true,
                customAudience: []
            },
            status: "published",
            isPromoted: false,
            isFeatured: false,
            isReported: false,
            reportCount: 0
        }));

        const responseData = {
            reels: enhancedReels,
            pagination: {
                page: Number(page),
                limit: max_results,
                next_cursor: result.next_cursor || null
            }
        };

        // Save to cache if it's the first page
        if (!next_cursor) {
            cache.cloudinaryReels.data = responseData;
            cache.cloudinaryReels.timestamp = Date.now();
        }

        return res.status(200).json(
            new ApiResponse(200, responseData, "Reels fetched from Cloudinary successfully")
        );
    } catch (error) {
        // Check for rate limit error
        if (error.error && error.error.http_code === 420) {
            const resetTime = error.error.message.match(/Try again on (.*) UTC/);
            const resetTimeString = resetTime ? resetTime[1] : "unknown time";

            return res.status(429).json(
                new ApiResponse(429, {}, `Cloudinary rate limit exceeded. Please try again later. Rate limit resets at ${resetTimeString} UTC`)
            );
        }

        console.error("Error fetching reels:", error);
        return res.status(500).json(
            new ApiResponse(500, {}, "Error fetching reels from Cloudinary")
        );
    }
});