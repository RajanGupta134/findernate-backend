import Post from "../models/userPost.models.js";
import Reel from "../models/reels.models.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";

export const getExploreFeed = asyncHandler(async (req, res) => {
    let { types = "all", sortBy = "time", page = 1, limit = 10 } = req.query;
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 10;

    // Calculate how many reels and posts per page (default: 2 reels, rest posts)
    const reelsPerPage = Math.min(2, limit);
    const postsPerPage = limit - reelsPerPage;

    // If types=all, fetch all types; otherwise, use the provided types
    let postMatch = { postType: { $ne: "reel" } };
    if (types !== "all") {
        const typeArray = types.split(",").map(t => t.trim().toLowerCase());
        postMatch.contentType = { $in: typeArray };
    }

    // 1. Get up to 2 random reels
    const reels = await Reel.aggregate([
        { $match: { isPublic: true } },
        { $sample: { size: reelsPerPage } }
    ]);

    // 2. Get up to (limit - reels.length) random posts
    let postsSampleSize = postsPerPage;
    if (postsSampleSize < 1) postsSampleSize = 1; // always try to get at least 1 post if limit > 0

    let posts = await Post.aggregate([
        { $match: postMatch },
        { $sample: { size: postsSampleSize * 5 } } // sample more for sorting
    ]);

    // Sorting logic
    posts = posts.sort((a, b) => {
        switch (sortBy) {
            case "likes":
                return (b.engagement?.likes || 0) - (a.engagement?.likes || 0);
            case "comments":
                return (b.engagement?.comments || 0) - (a.engagement?.comments || 0);
            case "shares":
                return (b.engagement?.shares || 0) - (a.engagement?.shares || 0);
            case "views":
                return (b.engagement?.views || 0) - (a.engagement?.views || 0);
            case "engagement":
                const aEng = (a.engagement?.likes || 0) + (a.engagement?.comments || 0) + (a.engagement?.shares || 0) + (a.engagement?.views || 0);
                const bEng = (b.engagement?.likes || 0) + (b.engagement?.comments || 0) + (b.engagement?.shares || 0) + (b.engagement?.views || 0);
                return bEng - aEng;
            case "time":
            default:
                return new Date(b.createdAt) - new Date(a.createdAt);
        }
    });

    // Paginate posts
    posts = posts.slice(0, postsPerPage);

    // Combine and shuffle
    const feed = [
        ...reels.map(r => ({ ...r, _type: "reel" })),
        ...posts.map(p => ({ ...p, _type: "post" }))
    ];
    for (let i = feed.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [feed[i], feed[j]] = [feed[j], feed[i]];
    }

    // Pagination info (approximate, since it's randomized)
    res.status(200).json(new ApiResponse(200, {
        feed,
        pagination: {
            page,
            limit,
            reelsCount: reels.length,
            postsCount: posts.length,
            total: reels.length + posts.length,
            hasNextPage: feed.length === limit // If we return less than limit, probably no more data
        }
    }, "Explore feed generated"));
});