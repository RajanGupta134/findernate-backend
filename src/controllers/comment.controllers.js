import { asyncHandler } from "../utlis/asyncHandler.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import Comment from "../models/comment.models.js";

// Create a new comment (or reply)
export const createComment = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { postId, content, parentCommentId } = req.body;
    if (!postId || !content) throw new ApiError(400, "postId and content are required");
    const comment = await Comment.create({
        postId,
        userId,
        content,
        parentCommentId: parentCommentId || null
    });
    return res.status(201).json(new ApiResponse(201, comment, "Comment created successfully"));
});

// Get all comments for a post
export const getCommentsByPost = asyncHandler(async (req, res) => {
    const { postId } = req.query;
    if (!postId) throw new ApiError(400, "postId is required");
    const comments = await Comment.find({ postId, isDeleted: false }).sort({ createdAt: 1 });
    return res.status(200).json(new ApiResponse(200, comments, "Comments fetched successfully"));
});

// Get a single comment by ID
export const getCommentById = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const comment = await Comment.findById(commentId);
    if (!comment || comment.isDeleted) throw new ApiError(404, "Comment not found");
    return res.status(200).json(new ApiResponse(200, comment, "Comment fetched successfully"));
});

// Update a comment
export const updateComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const { content } = req.body;
    if (!content) throw new ApiError(400, "content is required");
    const comment = await Comment.findByIdAndUpdate(
        commentId,
        { content, isEdited: true },
        { new: true }
    );
    if (!comment || comment.isDeleted) throw new ApiError(404, "Comment not found");
    return res.status(200).json(new ApiResponse(200, comment, "Comment updated successfully"));
});

// Delete a comment (soft delete)
export const deleteComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const comment = await Comment.findByIdAndUpdate(
        commentId,
        { isDeleted: true },
        { new: true }
    );
    if (!comment) throw new ApiError(404, "Comment not found");
    return res.status(200).json(new ApiResponse(200, null, "Comment deleted successfully"));
}); 