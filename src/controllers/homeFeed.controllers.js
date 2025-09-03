import Post from '../models/userPost.models.js';
import { User } from '../models/user.models.js';
import Business from '../models/business.models.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { ApiError } from '../utlis/ApiError.js';
import Comment from '../models/comment.models.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import Like from '../models/like.models.js';
import PostInteraction from '../models/postInteraction.models.js';
import { setCache, redisClient } from '../middlewares/cache.middleware.js';

export const getHomeFeed = asyncHandler(async (req, res) => {
    try {
        const userId = req.user?._id;
        const blockedUsers = req.blockedUsers || [];
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const skip = (page - 1) * limit;

        // Check cache first
        if (res.locals.cacheKey) {
            const cachedData = await redisClient.get(res.locals.cacheKey);
            if (cachedData) {
                return res.status(200).json(JSON.parse(cachedData));
            }
        }

        const FEED_LIMIT = 50; // Reduced from 100
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // ✅ 1. Get following and followers (only if user is authenticated) - OPTIMIZED
        let feedUserIds = [];
        if (userId) {
            const user = await User.findById(userId)
                .select('following followers')
                .lean(); // Use lean() for better performance
            const following = user?.following || [];
            const followers = user?.followers || [];

            feedUserIds = [...new Set([
                ...following.map(id => id.toString()),
                ...followers.map(id => id.toString())
            ])];
        }

        // ✅ 2. OPTIMIZED: Single aggregation query instead of multiple queries
        const aggregationPipeline = [
            {
                $match: {
                    contentType: { $in: ['normal', 'service', 'product', 'business'] },
                    userId: { $nin: blockedUsers }
                }
            },
            {
                $addFields: {
                    // Score posts by priority
                    feedScore: {
                        $add: [
                            // Followed users get highest priority
                            { $cond: [{ $in: ['$userId', feedUserIds] }, 100, 0] },
                            // Recent posts get boost
                            { $cond: [{ $gte: ['$createdAt', yesterday] }, 20, 0] },
                            // Engagement boost (capped at 30)
                            { $min: [
                                { $add: [
                                    { $multiply: [{ $ifNull: ['$engagement.likes', 0] }, 1] },
                                    { $multiply: [{ $ifNull: ['$engagement.comments', 0] }, 2] },
                                    { $multiply: [{ $ifNull: ['$engagement.shares', 0] }, 3] }
                                ]},
                                30
                            ]},
                            // Content type boost
                            { $switch: {
                                branches: [
                                    { case: { $eq: ['$contentType', 'product'] }, then: 15 },
                                    { case: { $eq: ['$contentType', 'service'] }, then: 12 },
                                    { case: { $eq: ['$contentType', 'business'] }, then: 10 }
                                ],
                                default: 8
                            }}
                        ]
                    }
                }
            },
            {
                $sort: { feedScore: -1, createdAt: -1 }
            },
            {
                $skip: skip
            },
            {
                $limit: limit
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userId',
                    pipeline: [
                        { $project: { username: 1, profileImageUrl: 1 } }
                    ]
                }
            },
            {
                $unwind: '$userId'
            }
        ];

        const posts = await Post.aggregate(aggregationPipeline);

        if (posts.length === 0) {
            const emptyResponse = new ApiResponse(200, {
                feed: [],
                pagination: { page, limit, total: 0, totalPages: 0 }
            }, "No posts found");
            
            // Cache empty response for shorter time
            if (res.locals.cacheKey) {
                await setCache(res.locals.cacheKey, emptyResponse, 60);
            }
            return res.status(200).json(emptyResponse);
        }

        // ✅ 3. Get user likes in a single optimized query
        const postIds = posts.map(post => post._id);
        let likedPostIds = new Set();
        if (userId) {
            const userLikes = await Like.find({
                userId: userId,
                postId: { $in: postIds }
            }).select('postId').lean();
            likedPostIds = new Set(userLikes.map(like => like.postId.toString()));
        }

        // ✅ 4. Get top comments efficiently (no nested queries)
        const allComments = await Comment.find({
            postId: { $in: postIds },
            parentCommentId: null,
            isDeleted: false
        })
        .sort({ createdAt: -1 })
        .limit(postIds.length * 3) // Max 3 comments per post
        .populate('userId', 'username profileImageUrl')
        .select('_id content userId createdAt postId')
        .lean();

        // Group comments by postId
        const commentsByPost = new Map();
        allComments.forEach(comment => {
            if (comment.userId) { // Filter out comments from deleted users
                const postId = comment.postId.toString();
                if (!commentsByPost.has(postId)) {
                    commentsByPost.set(postId, []);
                }
                if (commentsByPost.get(postId).length < 3) { // Limit to 3 comments per post
                    commentsByPost.get(postId).push({
                        commentId: comment._id,
                        content: comment.content,
                        createdAt: comment.createdAt,
                        user: {
                            _id: comment.userId._id,
                            username: comment.userId.username,
                            profileImageUrl: comment.userId.profileImageUrl
                        },
                        replies: [] // Don't load replies for performance - load on demand
                    });
                }
            }
        });

        // ✅ 5. Format final response
        const feedData = posts.map(post => ({
            ...post,
            comments: commentsByPost.get(post._id.toString()) || [],
            isLikedBy: likedPostIds.has(post._id.toString())
        }));

        // Get total count for pagination (cached to avoid expensive count queries)
        let totalCount = posts.length; // Simplified - use actual count for better pagination
        if (page === 1 && posts.length === limit) {
            // Only do count query for first page if it's full
            try {
                totalCount = await Post.countDocuments({
                    contentType: { $in: ['normal', 'service', 'product', 'business'] },
                    userId: { $nin: blockedUsers }
                });
            } catch (error) {
                totalCount = posts.length; // Fallback
            }
        }

        const response = new ApiResponse(200, {
            feed: feedData,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        }, "Home feed generated successfully");

        // Cache the response
        if (res.locals.cacheKey && res.locals.cacheTTL) {
            await setCache(res.locals.cacheKey, response, res.locals.cacheTTL);
        }

        return res.status(200).json(response);

    } catch (error) {
        console.error(error);
        throw new ApiError(500, 'Failed to generate home feed');
    }
});
