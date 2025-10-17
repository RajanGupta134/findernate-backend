import { User } from "../models/user.models.js";
import Follower from "../models/follower.models.js";
import Block from "../models/block.models.js";

/**
 * Privacy middleware to check if a user can view another user's content
 * based on account privacy settings, following relationship, and blocking
 */
export const checkContentVisibility = async (viewerId, targetUserId) => {
    // If viewing own content, always allow
    if (viewerId?.toString() === targetUserId?.toString()) {
        return true;
    }

    // Check for blocking relationship (either direction)
    if (viewerId) {
        const isBlocked = await Block.exists({
            $or: [
                { blockerId: viewerId, blockedId: targetUserId },
                { blockerId: targetUserId, blockedId: viewerId }
            ]
        });

        if (isBlocked) {
            return false; // Blocked users cannot view each other's content
        }
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
 */
export const getViewableUserIds = async (viewerId) => {
    if (!viewerId) {
        // Anonymous users can only see public content
        const publicUsers = await User.find({ privacy: 'public' }).select('_id');
        return publicUsers.map(u => u._id);
    }

    // Get users the viewer follows
    const following = await Follower.find({ followerId: viewerId }).select('userId');
    const followingIds = following.map(f => f.userId);

    // Add viewer's own ID
    followingIds.push(viewerId);

    // Get all public users not already in the following list
    const publicUsers = await User.find({ 
        privacy: 'public',
        _id: { $nin: followingIds }
    }).select('_id');

    // Combine following + own + public users
    return [...followingIds, ...publicUsers.map(u => u._id)];
};