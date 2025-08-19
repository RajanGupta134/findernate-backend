import Block from "../models/block.models.js";
import { asyncHandler } from "../utlis/asyncHandler.js";

/**
 * Middleware to get blocked users for the current user
 * Adds req.blockedUsers array to the request object
 */
export const getBlockedUsers = asyncHandler(async (req, res, next) => {
    if (!req.user?._id) {
        req.blockedUsers = [];
        return next();
    }

    try {
        // Get users that the current user has blocked
        const blockedByMe = await Block.find({ blockerId: req.user._id })
            .select('blockedId')
            .lean();

        // Get users who have blocked the current user
        const blockedByOthers = await Block.find({ blockedId: req.user._id })
            .select('blockerId')
            .lean();

        // Combine both arrays of user IDs
        const blockedUsers = [
            ...blockedByMe.map(block => block.blockedId.toString()),
            ...blockedByOthers.map(block => block.blockerId.toString())
        ];

        req.blockedUsers = blockedUsers;
        next();
    } catch (error) {
        console.error('Error getting blocked users:', error);
        req.blockedUsers = [];
        next();
    }
});

/**
 * Middleware to filter out blocked users from search results
 */
export const filterBlockedUsers = asyncHandler(async (req, res, next) => {
    if (!req.user?._id || !req.blockedUsers) {
        return next();
    }

    // If there are no blocked users, no filtering needed
    if (req.blockedUsers.length === 0) {
        return next();
    }

    // Add blocked users filter to the request for controllers to use
    req.blockedUsersFilter = { _id: { $nin: req.blockedUsers } };
    next();
});

/**
 * Helper function to get blocked users filter object
 * Can be used in controllers to filter queries
 */
export const getBlockedUsersFilter = (userId) => {
    if (!userId) return {};

    return new Promise(async (resolve) => {
        try {
            const blockedByMe = await Block.find({ blockerId: userId })
                .select('blockedId')
                .lean();

            const blockedByOthers = await Block.find({ blockedId: userId })
                .select('blockerId')
                .lean();

            const blockedUsers = [
                ...blockedByMe.map(block => block.blockedId.toString()),
                ...blockedByOthers.map(block => block.blockerId.toString())
            ];

            resolve({ _id: { $nin: blockedUsers } });
        } catch (error) {
            console.error('Error getting blocked users filter:', error);
            resolve({});
        }
    });
};
