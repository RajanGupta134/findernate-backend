import Follower from "../models/follower.models.js";
import { User } from "../models/user.models.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { ApiError } from "../utlis/ApiError.js";
import { createFollowNotification } from "./notification.controllers.js";

// Follow a user
export const followUser = asyncHandler(async (req, res) => {
    const followerId = req.user._id;
    const { userId } = req.body; // userId to follow

    if (followerId.toString() === userId) {
        throw new ApiError(400, "You cannot follow yourself");
    }

    // Prevent duplicate
    const exists = await Follower.findOne({ userId, followerId });
    if (exists) throw new ApiError(400, "Already following");

    await Follower.create({ userId, followerId });

    // Update User model arrays
    await User.findByIdAndUpdate(userId, { $addToSet: { followers: followerId } });
    await User.findByIdAndUpdate(followerId, { $addToSet: { following: userId } });

    // Create notification
    await createFollowNotification({ recipientId: userId, sourceUserId: followerId });

    // Get the followed user's info to return in response
    const followedUser = await User.findById(userId).select('username fullName profileImageUrl');

    res.status(200).json(new ApiResponse(200, {
        followedUser: {
            _id: userId,
            username: followedUser.username,
            fullName: followedUser.fullName,
            profileImageUrl: followedUser.profileImageUrl
        },
        isFollowing: true,
        timestamp: new Date()
    }, "Followed successfully"));
});

// Unfollow a user
export const unfollowUser = asyncHandler(async (req, res) => {
    const followerId = req.user._id;
    const { userId } = req.body; // userId to unfollow

    await Follower.findOneAndDelete({ userId, followerId });

    // Update User model arrays
    await User.findByIdAndUpdate(userId, { $pull: { followers: followerId } });
    await User.findByIdAndUpdate(followerId, { $pull: { following: userId } });

    // Get the unfollowed user's info to return in response
    const unfollowedUser = await User.findById(userId).select('username fullName profileImageUrl');

    res.status(200).json(new ApiResponse(200, {
        unfollowedUser: {
            _id: userId,
            username: unfollowedUser.username,
            fullName: unfollowedUser.fullName,
            profileImageUrl: unfollowedUser.profileImageUrl
        },
        isFollowing: false,
        timestamp: new Date()
    }, "Unfollowed successfully"));
});

// Get followers of a user
export const getFollowers = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const followers = await Follower.find({ userId }).populate("followerId", "username profileImageUrl");
    res.status(200).json(new ApiResponse(200, followers.map(f => f.followerId), "Followers fetched successfully"));
});

// Get following of a user
export const getFollowing = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const following = await Follower.find({ followerId: userId }).populate("userId", "username profileImageUrl");
    res.status(200).json(new ApiResponse(200, following.map(f => f.userId), "Following fetched successfully"));
}); 