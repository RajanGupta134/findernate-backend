import { User } from "../models/user.models.js";
import Follower from "../models/follower.models.js";
import ExpensiveOperationsCache from "../utlis/expensiveOperationsCache.js";

/**
 * Privacy middleware to check if a user can view another user's content
 * based on account privacy settings and following relationship
 */
export const checkContentVisibility = async (viewerId, targetUserId) => {
    // If viewing own content, always allow
    if (viewerId?.toString() === targetUserId?.toString()) {
        return true;
    }

    // Get the target user's privacy setting
    const targetUser = await User.findById(targetUserId).select('privacy');
    if (!targetUser) {
        return false;
    }

    // If target user has public account, allow viewing
    if (targetUser.privacy === 'public') {
        return true;
    }

    // If target user has private account, check if viewer is following
    if (!viewerId) {
        return false; // No viewer (anonymous), can't view private content
    }

    const isFollowing = await Follower.exists({ 
        userId: targetUserId, 
        followerId: viewerId 
    });

    return !!isFollowing;
};

/**
 * Middleware to filter posts/reels based on privacy settings
 * Adds privacy filtering to query conditions
 */
export const addPrivacyFilter = async (req, res, next) => {
    const viewerId = req.user?._id;
    
    // If no viewer, only show public content
    if (!viewerId) {
        req.privacyFilter = {
            'userId.privacy': 'public'
        };
        return next();
    }

    // Get list of users the viewer is following
    const following = await Follower.find({ followerId: viewerId }).select('userId');
    const followingIds = following.map(f => f.userId);

    // Add viewer's own ID to see their own content
    followingIds.push(viewerId);

    // Filter: show public posts OR posts from followed users
    req.privacyFilter = {
        $or: [
            { userId: { $in: followingIds } }, // Content from followed users or own content
            { 'userInfo.privacy': 'public' } // Public content from any user
        ]
    };

    next();
};

/**
 * Get users that the current user can view content from
 * (themselves + users they follow + public users)
 * OPTIMIZED: Uses Redis caching for 5 minutes
 */
export const getViewableUserIds = async (viewerId) => {
    // OPTIMIZED: Try to get from cache first
    const cached = await ExpensiveOperationsCache.getViewableUserIds(viewerId);
    if (cached) {
        return cached;
    }

    // Cache miss - compute viewable user IDs
    let userIds;

    if (!viewerId) {
        // Anonymous users can only see public content
        const publicUsers = await User.find({ privacy: 'public' }).select('_id').lean();
        userIds = publicUsers.map(u => u._id);
    } else {
        // OPTIMIZED: Run queries in parallel
        const [following, publicUsers] = await Promise.all([
            Follower.find({ followerId: viewerId }).select('userId').lean(),
            User.find({ privacy: 'public' }).select('_id').lean()
        ]);

        const followingIds = following.map(f => f.userId);

        // Add viewer's own ID
        followingIds.push(viewerId);

        // Get all public users not already in the following list
        const followingIdStrings = followingIds.map(id => id.toString());
        const additionalPublicUsers = publicUsers
            .filter(u => !followingIdStrings.includes(u._id.toString()))
            .map(u => u._id);

        // Combine following + own + public users
        userIds = [...followingIds, ...additionalPublicUsers];
    }

    // OPTIMIZED: Cache the result for 5 minutes
    await ExpensiveOperationsCache.cacheViewableUserIds(viewerId, userIds, 300);

    return userIds;
};