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
    const { postId, page = 1, limit = 20 } = req.query;
    if (!postId) throw new ApiError(400, "postId is required");
    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 20;
    const skip = (pageNum - 1) * pageLimit;

    const [comments, total] = await Promise.all([
        Comment.find({ postId, isDeleted: false })
            .populate('userId', 'username fullName bio location')
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(pageLimit),
        Comment.countDocuments({ postId, isDeleted: false })
    ]);

    return res.status(200).json(
        new ApiResponse(200, {
            totalComments: total,
            page: pageNum,
            totalPages: Math.ceil(total / pageLimit),
            comments
        }, "Comments fetched successfully")
    );
});

// Get a single comment by ID
export const getCommentById = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 10;
    const skip = (pageNum - 1) * pageLimit;

    const comment = await Comment.findById(commentId)
        .populate('userId', 'username fullName bio location');
    if (!comment || comment.isDeleted) throw new ApiError(404, "Comment not found");

    // Paginate replies (child comments)
    const [replies, totalReplies] = await Promise.all([
        Comment.find({ parentCommentId: commentId, isDeleted: false })
            .populate('userId', 'username fullName bio location')
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(pageLimit),
        Comment.countDocuments({ parentCommentId: commentId, isDeleted: false })
    ]);

    return res.status(200).json(
        new ApiResponse(200, {
            comment,
            replies: {
                totalReplies,
                page: pageNum,
                totalPages: Math.ceil(totalReplies / pageLimit),
                comments: replies
            }
        }, "Comment fetched successfully")
    );
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