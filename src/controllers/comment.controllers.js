import { asyncHandler } from "../utlis/asyncHandler.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import Comment from "../models/comment.models.js";
import Post from "../models/userPost.models.js";
import Like from "../models/like.models.js";
import { createCommentNotification } from "./notification.controllers.js";

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

    // Send notification to post owner (if not commenting on own post)
    try {
        const post = await Post.findById(postId).select("userId");
        if (post && post.userId.toString() !== userId.toString()) {
            await createCommentNotification({
                recipientId: post.userId,
                sourceUserId: userId,
                postId,
                commentId: comment._id
            });
        }

        // If this is a reply to another comment, also notify the comment owner
        if (parentCommentId) {
            const parentComment = await Comment.findById(parentCommentId).select("userId");
            if (parentComment && parentComment.userId.toString() !== userId.toString()) {
                await createCommentNotification({
                    recipientId: parentComment.userId,
                    sourceUserId: userId,
                    postId,
                    commentId: comment._id
                });
            }
        }
    } catch (error) {
        // Log error but don't fail the comment creation
        console.error("Error sending comment notification:", error);
    }

    return res.status(201).json(new ApiResponse(201, comment, "Comment created successfully"));
});

// Get all comments for a post
export const getCommentsByPost = asyncHandler(async (req, res) => {
    const { postId, page = 1, limit = 20 } = req.query;
    if (!postId) throw new ApiError(400, "postId is required");

    // ✅ FIXED: Handle both Mongoose document and plain object from cache
    const userId = req.user?._id ? req.user._id.toString() : null;
    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 20;
    const skip = (pageNum - 1) * pageLimit;

    // ✅ OPTIMIZED: Only fetch top-level comments (parentCommentId: null)
    const [comments, total] = await Promise.all([
        Comment.find({ postId, parentCommentId: null, isDeleted: false })
            .populate('userId', 'username fullName profileImageUrl bio location')
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(pageLimit)
            .lean(),
        Comment.countDocuments({ postId, parentCommentId: null, isDeleted: false })
    ]);

    // Populate likes from Like collection for each comment
    const commentIds = comments.map(c => c._id);
    const [likes, replyCounts] = await Promise.all([
        Like.find({ commentId: { $in: commentIds } })
            .populate('userId', 'username profileImageUrl fullName')
            .lean(),
        // Get reply counts for each comment
        Comment.aggregate([
            { $match: { parentCommentId: { $in: commentIds }, isDeleted: false } },
            { $group: { _id: '$parentCommentId', count: { $sum: 1 } } }
        ])
    ]);

    // Group likes by commentId
    const likesByComment = {};
    likes.forEach(like => {
        const commentId = like.commentId.toString();
        if (!likesByComment[commentId]) {
            likesByComment[commentId] = [];
        }
        likesByComment[commentId].push(like.userId);
    });

    // Group reply counts by commentId
    const replyCountMap = {};
    replyCounts.forEach(item => {
        replyCountMap[item._id.toString()] = item.count;
    });

    // Add likes and isLikedBy to each comment
    const enrichedComments = comments.map(comment => {
        const commentLikes = likesByComment[comment._id.toString()] || [];
        const isLikedBy = userId ? commentLikes.some(u => u._id.toString() === userId) : false;

        return {
            ...comment,
            likes: commentLikes,
            isLikedBy,
            likesCount: commentLikes.length,
            replyCount: replyCountMap[comment._id.toString()] || 0
        };
    });

    return res.status(200).json(
        new ApiResponse(200, {
            totalComments: total,
            page: pageNum,
            totalPages: Math.ceil(total / pageLimit),
            comments: enrichedComments
        }, "Comments fetched successfully")
    );
});

// Get a single comment by ID
export const getCommentById = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // ✅ FIXED: Handle both Mongoose document and plain object from cache
    const userId = req.user?._id ? req.user._id.toString() : null;
    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 10;
    const skip = (pageNum - 1) * pageLimit;

    const comment = await Comment.findById(commentId)
        .populate('userId', 'username fullName profileImageUrl bio location')
        .lean();
    if (!comment || comment.isDeleted) throw new ApiError(404, "Comment not found");

    // Paginate replies (child comments)
    const [replies, totalReplies] = await Promise.all([
        Comment.find({ parentCommentId: commentId, isDeleted: false })
            .populate('userId', 'username fullName profileImageUrl bio location')
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(pageLimit)
            .lean(),
        Comment.countDocuments({ parentCommentId: commentId, isDeleted: false })
    ]);

    // Get likes for the main comment and all replies
    const allCommentIds = [commentId, ...replies.map(r => r._id)];
    const replyIds = replies.map(r => r._id);

    const [likes, replyCountsForReplies] = await Promise.all([
        Like.find({ commentId: { $in: allCommentIds } })
            .populate('userId', 'username profileImageUrl fullName')
            .lean(),
        // Get reply counts for nested replies
        replyIds.length > 0
            ? Comment.aggregate([
                { $match: { parentCommentId: { $in: replyIds }, isDeleted: false } },
                { $group: { _id: '$parentCommentId', count: { $sum: 1 } } }
            ])
            : Promise.resolve([])
    ]);

    // Group likes by commentId
    const likesByComment = {};
    likes.forEach(like => {
        const cId = like.commentId.toString();
        if (!likesByComment[cId]) {
            likesByComment[cId] = [];
        }
        likesByComment[cId].push(like.userId);
    });

    // Group reply counts by commentId
    const replyCountMap = {};
    replyCountsForReplies.forEach(item => {
        replyCountMap[item._id.toString()] = item.count;
    });

    // Enrich main comment with likes and total reply count
    const commentLikes = likesByComment[commentId.toString()] || [];
    const isLikedBy = userId ? commentLikes.some(u => u._id.toString() === userId) : false;
    const enrichedComment = {
        ...comment,
        likes: commentLikes,
        isLikedBy,
        likesCount: commentLikes.length,
        replyCount: totalReplies
    };

    // Enrich replies with likes and reply counts
    const enrichedReplies = replies.map(reply => {
        const replyLikes = likesByComment[reply._id.toString()] || [];
        const isReplyLikedBy = userId ? replyLikes.some(u => u._id.toString() === userId) : false;

        return {
            ...reply,
            likes: replyLikes,
            isLikedBy: isReplyLikedBy,
            likesCount: replyLikes.length,
            replyCount: replyCountMap[reply._id.toString()] || 0
        };
    });

    return res.status(200).json(
        new ApiResponse(200, {
            comment: enrichedComment,
            replies: {
                totalReplies,
                page: pageNum,
                totalPages: Math.ceil(totalReplies / pageLimit),
                comments: enrichedReplies
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