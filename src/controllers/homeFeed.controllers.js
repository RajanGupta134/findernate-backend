import Post from '../models/userPost.models.js';
import { User } from '../models/user.models.js';
import Business from '../models/business.models.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { ApiError } from '../utlis/ApiError.js';
import Comment from '../models/comment.models.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import Like from '../models/like.models.js';
import PostInteraction from '../models/postInteraction.models.js';
import { setCache } from '../middlewares/cache.middleware.js';
import { redisClient } from '../config/redis.config.js';
import { getViewableUserIds } from '../middlewares/privacy.middleware.js';
import { batchFetchUsers } from '../utlis/batchUserLookup.js';
import ExpensiveOperationsCache from '../utlis/expensiveOperationsCache.js';

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

        // ✅ 1. Get viewable user IDs based on privacy settings and following relationships
        // For logged-out users (userId is null), this returns only users with public privacy
        // For logged-in users, this returns their following + their own posts + public users
        const viewableUserIds = await getViewableUserIds(userId);
        
        // ✅ 2. Get following and followers for prioritization (only if user is authenticated)
        // OPTIMIZED: Use cache for following/followers lists
        let feedUserIds = [];
        if (userId) {
            // Try cache first
            let following = await ExpensiveOperationsCache.getFollowingList(userId);
            let followers = await ExpensiveOperationsCache.getFollowersList(userId);

            if (!following || !followers) {
                // Cache miss - fetch from DB
                const user = await User.findById(userId)
                    .select('following followers')
                    .lean();
                following = user?.following || [];
                followers = user?.followers || [];

                // Cache for future requests
                await ExpensiveOperationsCache.cacheFollowingList(userId, following);
                await ExpensiveOperationsCache.cacheFollowersList(userId, followers);
            }

            feedUserIds = [...new Set([
                ...following.map(id => id.toString()),
                ...followers.map(id => id.toString())
            ])];
        }

        // ✅ 3. OPTIMIZED: Single aggregation query with privacy filtering
        const aggregationPipeline = [
            {
                $match: {
                    contentType: { $in: ['normal', 'service', 'product', 'business'] },
                    userId: { $in: viewableUserIds, $nin: blockedUsers },
                    // For logged-out users, only show posts with public visibility
                    ...(userId ? {} : {
                        $or: [
                            { 'settings.visibility': 'public' },
                            { 'settings.visibility': { $exists: false } }, // Default to public if no setting
                            { 'settings.visibility': null } // Null means public
                        ]
                    })
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
                $project: {
                    _id: 1,
                    userId: 1,
                    postType: 1,
                    contentType: 1,
                    caption: 1,
                    media: 1,
                    engagement: 1,
                    createdAt: 1,
                    feedScore: 1,
                    settings: 1
                }
            }
        ];

        // OPTIMIZED: Execute aggregation and get lean results
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

        // OPTIMIZED: Batch fetch user data instead of populate
        const userIds = [...new Set(posts.map(post => post.userId))];
        const userMap = await batchFetchUsers(userIds, 'username profileImageUrl');

        // Attach user data to posts
        posts.forEach(post => {
            const userId = post.userId.toString();
            post.userId = userMap[userId] || { _id: userId, username: 'Unknown' };
        });

        // ✅ 3. OPTIMIZED: Get user likes with caching
        const postIds = posts.map(post => post._id);
        let likedPostIds = new Set();
        if (userId) {
            // Try to get from cache first
            likedPostIds = await ExpensiveOperationsCache.getUserLikedPosts(userId, postIds);

            if (!likedPostIds) {
                // Cache miss - fetch from database
                const userLikes = await Like.find({
                    userId: userId,
                    postId: { $in: postIds }
                }).select('postId').lean();
                likedPostIds = new Set(userLikes.map(like => like.postId.toString()));

                // Cache the user's likes
                await ExpensiveOperationsCache.cacheUserLikes(userId, Array.from(likedPostIds));
            }
        }

        // ✅ 4. OPTIMIZED: Get top comments with batch user lookup
        const allComments = await Comment.find({
            postId: { $in: postIds },
            parentCommentId: null,
            isDeleted: false
        })
        .sort({ createdAt: -1 })
        .limit(postIds.length * 3) // Max 3 comments per post
        .select('_id content userId createdAt postId')
        .lean();

        // Batch fetch comment users
        const commentUserIds = [...new Set(allComments.map(c => c.userId).filter(id => id))];
        const commentUserMap = await batchFetchUsers(commentUserIds, 'username profileImageUrl');

        // Group comments by postId with batch-fetched user data
        const commentsByPost = new Map();
        allComments.forEach(comment => {
            const commentUserId = comment.userId?.toString();
            const commentUser = commentUserMap[commentUserId];

            if (commentUser) { // Filter out comments from deleted users
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
                            _id: commentUser._id,
                            username: commentUser.username,
                            profileImageUrl: commentUser.profileImageUrl
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

        // OPTIMIZED: Use estimatedDocumentCount for pagination (faster)
        // For exact counts, only query on first page
        let totalCount = posts.length;
        if (page === 1 && posts.length === limit) {
            // Try to get cached count first
            const countCacheKey = `fn:posts:count:${userId || 'public'}`;
            let cachedCount = await redisClient.get(countCacheKey);

            if (cachedCount) {
                totalCount = parseInt(cachedCount);
            } else {
                // Use estimatedDocumentCount for speed (acceptable approximation)
                try {
                    totalCount = await Post.estimatedDocumentCount();
                    // Cache count for 5 minutes
                    await redisClient.setex(countCacheKey, 300, totalCount.toString());
                } catch (error) {
                    totalCount = posts.length; // Fallback
                }
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
