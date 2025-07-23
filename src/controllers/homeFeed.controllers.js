import Post from '../models/userPost.models.js';
import { User } from '../models/user.models.js';
import Story from '../models/story.models.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { ApiError } from '../utlis/ApiError.js';
import Comment from '../models/comment.models.js';

// Helper function to shuffle array
function shuffleArray(arr) {
    return arr
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);
}

export const getHomeFeed = async (req, res) => {
    try {
        const userId = req.user._id;
        const userLocation = req.user.location && req.user.location.coordinates && Array.isArray(req.user.location.coordinates)
            ? req.user.location
            : null;

        const FEED_LIMIT = 100;
        const NEARBY_DISTANCE_KM = 20;
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const user = await User.findById(userId).select('following followers');
        const following = user?.following || [];
        const followers = user?.followers || [];

        const feedUserIds = [...new Set([
            ...following.map(id => id.toString()),
            ...followers.map(id => id.toString())
        ])];

        const allowedTypes = ['normal', 'service', 'product', 'business'];
        const baseQuery = { contentType: { $in: allowedTypes } };

        const followedPosts = await Post.find({
            ...baseQuery,
            userId: { $in: feedUserIds }
        })
            .sort({ createdAt: -1 })
            .limit(FEED_LIMIT)
            .populate('userId', 'username profileImageUrl');

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

        const nonFollowedPosts = await Post.find({
            ...baseQuery,
            userId: { $nin: [...feedUserIds, userId] }
        })
            .sort({ createdAt: -1 })
            .limit(FEED_LIMIT)
            .populate('userId', 'username profileImageUrl');

        const getContentTypeWeight = (type) => {
            switch (type) {
                case 'product': return 0.5;
                case 'service': return 0.4;
                case 'business': return 0.3;
                case 'normal': return 0.1;
                default: return 0;
            }
        };

        const scoredPosts = [
            ...followedPosts.map(p => Object.assign(p, { _score: 4 + getContentTypeWeight(p.contentType) })),
            ...nearbyPosts.map(p => Object.assign(p, { _score: 3 + getContentTypeWeight(p.contentType) })),
            ...trendingPosts.map(p => Object.assign(p, { _score: 2 + getContentTypeWeight(p.contentType) })),
            ...nonFollowedPosts.map(p => Object.assign(p, { _score: 1 + getContentTypeWeight(p.contentType) })),
        ];

        const seen = new Set();
        const deduplicated = scoredPosts
            .filter(post => {
                const id = post._id.toString();
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            });

        const rankedFeed = shuffleArray(deduplicated);

        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const skip = (page - 1) * limit;
        const paginatedFeed = rankedFeed.slice(skip, skip + limit);

        const feedWithComments = await Promise.all(
            paginatedFeed.map(async post => {
                const comments = await Comment.find({
                    postId: post._id,
                    parentCommentId: null,
                    isDeleted: false
                })
                    .sort({ createdAt: 1 })
                    .populate('userId', 'username profileImageUrl')
                    .select('_id content userId createdAt');

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
                    comments: commentsWithReplies
                };
            })
        );

        const storyUserIds = [userId, ...following];
        const stories = await Story.find({
            userId: { $in: storyUserIds },
            isArchived: false,
            expiresAt: { $gt: now }
        })
            .sort({ createdAt: -1 })
            .populate('userId', 'username profileImageUrl');

        return res.status(200).json(
            new ApiResponse(200, {
                stories,
                feed: feedWithComments,
                pagination: {
                    page,
                    limit,
                    total: rankedFeed.length,
                    totalPages: Math.ceil(rankedFeed.length / limit)
                }
            }, "Home feed and stories generated successfully")
        );

    } catch (error) {
        console.error(error);
        throw new ApiError(500, 'Failed to generate home feed');
    }
};
