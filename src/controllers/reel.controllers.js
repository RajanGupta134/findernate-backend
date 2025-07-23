import Reel from "../models/reels.models.js";
import { User } from "../models/user.models.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";

// 1. Get suggested reels (random + following)
export const getSuggestedReels = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 10, type = "all" } = req.query;

    // Get following user IDs
    const user = await User.findById(userId).select("following");
    const following = user?.following || [];

    let filter = { isPublic: true };
    if (type === "following") {
        filter.userId = { $in: following };
    } else if (type === "random") {
        filter.userId = { $nin: [userId, ...following] };
    }

    // Always randomize output
    const reels = await Reel.aggregate([
        { $match: filter },
        { $sample: { size: Number(limit) } }
    ]);

    res.status(200).json(new ApiResponse(200, {
        reels,
        pagination: {
            page: Number(page),
            limit: Number(limit),
            // total is not accurate with $sample, so you may omit or estimate
        }
    }, "Reels fetched successfully"));
});