import mongoose from 'mongoose';
import { asyncHandler } from '../utlis/asyncHandler.js';
import { ApiError } from '../utlis/ApiError.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import SavedPost from '../models/savedPost.models.js';

/**
 * Save a post to the user's saved posts collection
 * @route POST /api/posts/save
 * @access Private
 */
const savePost = asyncHandler(async (req, res) => {
    const { postId, privacy } = req.body;
    const userId = req.user._id;

    if (!postId) {
        throw new ApiError(400, "Post ID is required");
    }

    try {
        // Check if post is already saved
        const existingSave = await SavedPost.findOne({ userId, postId, privacy });

        if (existingSave) {
            return res.status(200).json(
                new ApiResponse(200, existingSave, "Post already saved")
            );
        }

        // Save post
        const savedPost = await SavedPost.create({
            userId,
            postId,
            privacy
        });

        // Update save count in the post (optional)
        // await Post.findByIdAndUpdate(postId, { $inc: { 'engagement.saves': 1 } });

        return res.status(201).json(
            new ApiResponse(201, savedPost, "Post saved successfully")
        );
    } catch (error) {
        if (error.name === 'CastError') {
            throw new ApiError(400, "Invalid post ID format");
        }
        throw new ApiError(500, "Error saving post", [error.message]);
    }
});

/**
 * Unsave/remove a post from user's saved posts collection
 * @route DELETE /api/posts/save/:postId
 * @access Private
 */
const unsavePost = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    const userId = req.user._id;

    if (!postId) {
        throw new ApiError(400, "Post ID is required");
    }

    try {
        const result = await SavedPost.findOneAndDelete({ userId, postId });

        if (!result) {
            return res.status(404).json(
                new ApiResponse(404, null, "Post not found in saved items")
            );
        }

        // Update save count in the post (optional)
        // await Post.findByIdAndUpdate(postId, { $inc: { 'engagement.saves': -1 } });

        return res.status(200).json(
            new ApiResponse(200, null, "Post removed from saved items")
        );
    } catch (error) {
        if (error.name === 'CastError') {
            throw new ApiError(400, "Invalid post ID format");
        }
        throw new ApiError(500, "Error removing saved post", [error.message]);
    }
});


export const toggleSavedPostVisibility = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    try {
        const user = await User.findById(userId);

        if (!user) {
            throw new ApiError(404, "User not found");
        }

        // Toggle: private -> public, public -> private
        user.privacy =
            user.privacy === "private" ? "public" : "private";
        await user.save();

        // Boolean: true = private, false = public
        const isPrivate = user.privacy === "private";

        return res
            .status(200)
            .json(
                new ApiResponse(
                    200,
                    isPrivate,
                    `Saved posts visibility is now ${user.privacy}`
                )
            );
    } catch (error) {
        throw new ApiError(500, "Error toggling saved post visibility", [
            error.message,
        ]);
    }
});

/**
 * Get all saved posts for the current user
 * @route GET /api/posts/saved
 * @access Private
 */
const getPrivateSavedPosts = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    try {
        // Find all saved posts and populate the post details
        const savedPosts = await SavedPost.find({ userId, privacy:'private' })
            .sort({ savedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate({
                path: 'postId',
                select: 'caption media customization userId createdAt engagement',
                populate: {
                    path: 'userId',
                    select: 'username fullName profileImageUrl'
                }
            });

        // Get total count for pagination
        const totalSavedPosts = await SavedPost.countDocuments({ userId, privacy:'private'});

        return res.status(200).json(
            new ApiResponse(200, {
                savedPosts,
                pagination: {
                    totalPosts: totalSavedPosts,
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalSavedPosts / limit),
                    postsPerPage: parseInt(limit)
                }
            }, "Private Saved posts retrieved successfully")
        );
    } catch (error) {
        throw new ApiError(500, "Error retrieving saved posts", [error.message]);
    }
});

const getPublicSavedPosts = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    try {
        // Find all saved posts and populate the post details
        const savedPosts = await SavedPost.find({ userId, privacy: 'public' })
            .sort({ savedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate({
                path: 'postId',
                select: 'caption media customization userId createdAt engagement',
                populate: {
                    path: 'userId',
                    select: 'username fullName profileImageUrl'
                }
            });

        // Get total count for pagination
        const totalSavedPosts = await SavedPost.countDocuments({ userId, privacy: 'public' });

        return res.status(200).json(
            new ApiResponse(200, {
                savedPosts,
                pagination: {
                    totalPosts: totalSavedPosts,
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalSavedPosts / limit),
                    postsPerPage: parseInt(limit)
                }
            }, "Public Saved posts retrieved successfully")
        );
    } catch (error) {
        throw new ApiError(500, "Error retrieving saved posts", [error.message]);
    }
});


/**
 * Check if a post is saved by the current user
 * @route GET /api/posts/saved/check/:postId
 * @access Private
 */
const checkPostSaved = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    const userId = req.user._id;

    if (!postId) {
        throw new ApiError(400, "Post ID is required");
    }

    try {
        const isSaved = await SavedPost.exists({ userId, postId });

        return res.status(200).json(
            new ApiResponse(200, { isSaved: !!isSaved }, "Post saved status retrieved")
        );
    } catch (error) {
        if (error.name === 'CastError') {
            throw new ApiError(400, "Invalid post ID format");
        }
        throw new ApiError(500, "Error checking saved post status", [error.message]);
    }
});

export {
    savePost,
    unsavePost,
    toggleSavedPostVisibility,
    getPrivateSavedPosts,
    getPublicSavedPosts,
    checkPostSaved
};
