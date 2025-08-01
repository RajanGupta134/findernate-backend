import Post from '../models/userPost.models.js';
import { User } from '../models/user.models.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { ApiError } from '../utlis/ApiError.js';
import Comment from '../models/comment.models.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import Like from '../models/like.models.js';

export const getHomeFeed = asyncHandler(async (req, res) => {
    try {
        const userId = req.user?._id;
        const userLocation = req.user?.location && req.user.location.coordinates && Array.isArray(req.user.location.coordinates)
            ? req.user.location
            : null;

        const FEED_LIMIT = 100;
        const NEARBY_DISTANCE_KM = 20;
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // ✅ 1. Get following and followers (only if user is authenticated)
        let feedUserIds = [];
        if (userId) {
            const user = await User.findById(userId).select('following followers');
            const following = user?.following || [];
            const followers = user?.followers || [];

            feedUserIds = [...new Set([
                ...following.map(id => id.toString()),
                ...followers.map(id => id.toString())
            ])];
        }

        // ✅ 2. Base post filter
        const allowedTypes = ['normal', 'service', 'product', 'business'];
        const baseQuery = { contentType: { $in: allowedTypes } };

        // ✅ 3a. Posts from followed/follower users
        const followedPosts = await Post.find({
            ...baseQuery,
            userId: { $in: feedUserIds }
        })
            .sort({ createdAt: -1 })
            .limit(FEED_LIMIT)
            .populate('userId', 'username profileImageUrl');

        // ✅ 3b. Trending posts
        const trendingPosts = await Post.find({
            ...baseQuery,
            createdAt: { $gte: yesterday }
        })
            .sort({
                'engagement.likes': -1,
                'engagement.comments': -1,
                'engagement.shares': -1,
                'engagement.views': -1,
                createdAt: -1
            })
            .limit(FEED_LIMIT)
            .populate('userId', 'username profileImageUrl');

        // ✅ 3c. Nearby posts
        let nearbyPosts = [];
        if (userLocation && userLocation.coordinates) {
            nearbyPosts = await Post.find({
                ...baseQuery,
                $or: [
                    { 'customization.normal.location.coordinates': { $near: { $geometry: { type: 'Point', coordinates: userLocation.coordinates }, $maxDistance: NEARBY_DISTANCE_KM * 1000 } } },
                    { 'customization.service.location.coordinates': { $near: { $geometry: { type: 'Point', coordinates: userLocation.coordinates }, $maxDistance: NEARBY_DISTANCE_KM * 1000 } } },
                    { 'customization.product.location.coordinates': { $near: { $geometry: { type: 'Point', coordinates: userLocation.coordinates }, $maxDistance: NEARBY_DISTANCE_KM * 1000 } } },
                    { 'customization.business.location.coordinates': { $near: { $geometry: { type: 'Point', coordinates: userLocation.coordinates }, $maxDistance: NEARBY_DISTANCE_KM * 1000 } } }
                ]
            })
                .limit(FEED_LIMIT)
                .populate('userId', 'username profileImageUrl');
        }

        //  3d. Non-followed users' posts
        const excludeUserIds = userId ? [...feedUserIds, userId] : feedUserIds;
        const nonFollowedPosts = await Post.find({
            ...baseQuery,
            userId: { $nin: excludeUserIds }
        })
            .sort({ createdAt: -1 })
            .limit(FEED_LIMIT)
            .populate('userId', 'username profileImageUrl');

        //  4. Define content-type weight
        const getContentTypeWeight = (type) => {
            switch (type) {
                case 'product': return 0.5;
                case 'service': return 0.4;
                case 'business': return 0.3;
                case 'normal': return 0.1;
                default: return 0;
            }
        };

        // ✅ 5. Score & tag posts
        const scoredPosts = [
            ...followedPosts.map(p => ({ ...p.toObject(), _score: 4 + getContentTypeWeight(p.contentType) })),
            ...nearbyPosts.map(p => ({ ...p.toObject(), _score: 3 + getContentTypeWeight(p.contentType) })),
            ...trendingPosts.map(p => ({ ...p.toObject(), _score: 2 + getContentTypeWeight(p.contentType) })),
            ...nonFollowedPosts.map(p => ({ ...p.toObject(), _score: 1 + getContentTypeWeight(p.contentType) })),
        ];

        // ✅ 6. Deduplicate and sort
        const seen = new Set();
        const deduplicated = scoredPosts
            .filter(post => {
                const id = post._id.toString();
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            });

        // Shuffle all posts together
        function shuffleArray(arr) {
            return arr
                .map(value => ({ value, sort: Math.random() }))
                .sort((a, b) => a.sort - b.sort)
                .map(({ value }) => value);
        }

        const rankedFeed = shuffleArray(deduplicated);

        // --- Pagination logic ---
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const skip = (page - 1) * limit;
        const paginatedFeed = rankedFeed.slice(skip, skip + limit);

        // Fetch likes for paginated posts by current user (only if authenticated)
        const postIds = paginatedFeed.map(post => post._id);
        let likedPostIds = new Set();
        if (userId) {
            const userLikes = await Like.find({
                userId: userId,
                postId: { $in: postIds }
            }).select('postId');
            likedPostIds = new Set(userLikes.map(like => like.postId.toString()));
        }

        // Fetch comments for each post in the paginated feed
        const feedWithComments = await Promise.all(
            paginatedFeed.map(async post => {
                // Top-level comments
                const comments = await Comment.find({
                    postId: post._id,
                    parentCommentId: null,
                    isDeleted: false
                })
                    .sort({ createdAt: 1 })
                    .populate('userId', 'username profileImageUrl')
                    .select('_id content userId createdAt');

                // For each comment, fetch replies
                const commentsWithReplies = await Promise.all(
                    comments.map(async c => {
                        const replies = await Comment.find({
                            parentCommentId: c._id,
                            isDeleted: false
                        })
                            .sort({ createdAt: 1 })
                            .populate('userId', 'username profileImageUrl')
                            .select('_id content userId createdAt');
                        return {
                            commentId: c._id,
                            content: c.content,
                            createdAt: c.createdAt,
                            user: c.userId ? {
                                _id: c.userId._id,
                                username: c.userId.username,
                                profileImageUrl: c.userId.profileImageUrl
                            } : null,
                            replies: replies.map(r => ({
                                commentId: r._id,
                                content: r.content,
                                createdAt: r.createdAt,
                                user: r.userId ? {
                                    _id: r.userId._id,
                                    username: r.userId.username,
                                    profileImageUrl: r.userId.profileImageUrl
                                } : null
                            }))
                        };
                    })
                );
                return {
                    ...post,
                    comments: commentsWithReplies,
                    isLikedBy: likedPostIds.has(post._id.toString())
                };
            })
        );


        return res.status(200).json(
            new ApiResponse(200, {
                // stories,
                feed: feedWithComments,
                pagination: {
                    page,
                    limit,
                    total: rankedFeed.length,
                    totalPages: Math.ceil(rankedFeed.length / limit)
                }
            }, "Home feed generated successfully")
        );

    } catch (error) {
        console.error(error);
        throw new ApiError(500, 'Failed to generate home feed');
    }
});
