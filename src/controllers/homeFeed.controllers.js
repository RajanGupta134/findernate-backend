import Post from '../models/userPost.models.js';
import { User } from '../models/user.models.js';
import Business from '../models/business.models.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { ApiError } from '../utlis/ApiError.js';
import Comment from '../models/comment.models.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import Like from '../models/like.models.js';
import PostInteraction from '../models/postInteraction.models.js';

export const getHomeFeed = asyncHandler(async (req, res) => {
    try {
        const userId = req.user?._id;
        const blockedUsers = req.blockedUsers || [];
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

        // ✅ 3a. Posts from followed/follower users (excluding blocked users)
        const followedPostsRaw = await Post.find({
            ...baseQuery,
            userId: {
                $in: feedUserIds,
                $nin: blockedUsers
            }
        })
            .sort({ createdAt: -1 })
            .limit(FEED_LIMIT)
            .populate('userId', 'username profileImageUrl');

        // Filter out posts from deleted users (where userId is null after population)
        const followedPosts = followedPostsRaw.filter(post => post.userId);

        // ✅ 3b. Trending posts (excluding blocked users)
        const trendingPostsRaw = await Post.find({
            ...baseQuery,
            createdAt: { $gte: yesterday },
            userId: { $nin: blockedUsers }
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

        // Filter out posts from deleted users (where userId is null after population)
        const trendingPosts = trendingPostsRaw.filter(post => post.userId);

        // ✅ 3c. Nearby posts (enhanced with business profile locations)
        let nearbyPosts = [];
        if (userLocation && userLocation.coordinates) {
            // Get posts with location data (excluding blocked users)
            const locationBasedPostsRaw = await Post.find({
                ...baseQuery,
                userId: { $nin: blockedUsers },
                $or: [
                    { 'customization.normal.location.coordinates': { $near: { $geometry: { type: 'Point', coordinates: userLocation.coordinates }, $maxDistance: NEARBY_DISTANCE_KM * 1000 } } },
                    { 'customization.service.location.coordinates': { $near: { $geometry: { type: 'Point', coordinates: userLocation.coordinates }, $maxDistance: NEARBY_DISTANCE_KM * 1000 } } },
                    { 'customization.product.location.coordinates': { $near: { $geometry: { type: 'Point', coordinates: userLocation.coordinates }, $maxDistance: NEARBY_DISTANCE_KM * 1000 } } },
                    { 'customization.business.location.coordinates': { $near: { $geometry: { type: 'Point', coordinates: userLocation.coordinates }, $maxDistance: NEARBY_DISTANCE_KM * 1000 } } }
                ]
            })
                .populate('userId', 'username profileImageUrl');

            // Filter out posts from deleted users (where userId is null after population)
            const locationBasedPosts = locationBasedPostsRaw.filter(post => post.userId);

            // Get nearby businesses with live location enabled
            const nearbyBusinesses = await Business.find({
                'location.coordinates': {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: userLocation.coordinates
                        },
                        $maxDistance: NEARBY_DISTANCE_KM * 1000
                    }
                },
                'location.isLiveLocationEnabled': true,
                subscriptionStatus: 'active'
            }).select('userId');

            // Get posts from nearby business owners (excluding blocked users)
            const nearbyBusinessUserIds = nearbyBusinesses.map(business => business.userId);
            const businessOwnerPostsRaw = nearbyBusinessUserIds.length > 0 ? await Post.find({
                ...baseQuery,
                userId: {
                    $in: nearbyBusinessUserIds,
                    $nin: blockedUsers
                }
            })
                .populate('userId', 'username profileImageUrl') : [];

            // Filter out posts from deleted users (where userId is null after population)
            const businessOwnerPosts = businessOwnerPostsRaw.filter(post => post.userId);

            // Combine location-based posts and business posts, avoiding duplicates
            const allNearbyPosts = [...locationBasedPosts, ...businessOwnerPosts];
            const seenPostIds = new Set();
            nearbyPosts = allNearbyPosts
                .filter(post => {
                    const id = post._id.toString();
                    if (seenPostIds.has(id)) return false;
                    seenPostIds.add(id);
                    return true;
                })
                .slice(0, FEED_LIMIT); // Limit to FEED_LIMIT posts
        }

        //  3d. Non-followed users' posts (excluding blocked users)
        const excludeUserIds = userId ? [...feedUserIds, userId, ...blockedUsers] : [...feedUserIds, ...blockedUsers];
        const nonFollowedPostsRaw = await Post.find({
            ...baseQuery,
            userId: { $nin: excludeUserIds }
        })
            .sort({ createdAt: -1 })
            .limit(FEED_LIMIT)
            .populate('userId', 'username profileImageUrl');

        // Filter out posts from deleted users (where userId is null after population)
        const nonFollowedPosts = nonFollowedPostsRaw.filter(post => post.userId);

        // ✅ 4. Get user's interaction history
        let userInteractions = new Map();
        if (userId) {
            const interactions = await PostInteraction.find({
                userId,
                lastInteracted: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
            }).select('postId interactionType interactionCount lastInteracted isHidden');

            interactions.forEach(interaction => {
                const postId = interaction.postId.toString();
                if (!userInteractions.has(postId)) {
                    userInteractions.set(postId, []);
                }
                userInteractions.get(postId).push(interaction);
            });
        }

        // ✅ 5. Intelligent scoring algorithm
        const calculatePostScore = (post, source) => {
            const postAge = (now - new Date(post.createdAt)) / (1000 * 60 * 60); // hours
            const postId = post._id.toString();
            const interactions = userInteractions.get(postId) || [];

            // Base scores by source
            let baseScore = 0;
            switch (source) {
                case 'followed': baseScore = 100; break;
                case 'nearby': baseScore = 75; break;
                case 'trending': baseScore = 50; break;
                case 'non-followed': baseScore = 25; break;
            }

            // Relationship weight (higher for followed users)
            const relationshipWeight = source === 'followed' ? 2.0 : 1.0;

            // Recency boost (newer posts get higher scores)
            const recencyBoost = Math.max(0, 20 - (postAge / 24) * 10); // Decreases over days

            // Content type weight
            const contentTypeWeight = {
                'product': 15,
                'service': 12,
                'business': 10,
                'normal': 8
            }[post.contentType] || 5;

            // Engagement score
            const engagement = post.engagement || {};
            const engagementScore = (
                (engagement.likes || 0) * 1.0 +
                (engagement.comments || 0) * 2.0 +
                (engagement.shares || 0) * 3.0 +
                (engagement.views || 0) * 0.1
            );

            // Interaction penalty (reduce score for seen/interacted posts)
            let interactionPenalty = 0;
            if (interactions.length > 0) {
                const hasRecentView = interactions.some(i =>
                    i.interactionType === 'view' &&
                    (now - new Date(i.lastInteracted)) < 24 * 60 * 60 * 1000 // Last 24 hours
                );
                const totalInteractions = interactions.reduce((sum, i) => sum + i.interactionCount, 0);
                const isHidden = interactions.some(i => i.isHidden);

                if (isHidden) interactionPenalty = 90; // Almost eliminate hidden posts
                else if (hasRecentView) interactionPenalty = 60; // Heavy penalty for recent views
                else if (totalInteractions > 3) interactionPenalty = 40; // Penalty for multiple interactions
                else if (totalInteractions > 1) interactionPenalty = 20; // Light penalty for few interactions
            }

            // Calculate final score
            const finalScore = Math.max(0,
                (baseScore * relationshipWeight) +
                recencyBoost +
                contentTypeWeight +
                Math.min(engagementScore, 30) - // Cap engagement boost
                interactionPenalty
            );

            return finalScore;
        };

        // ✅ 6. Score all posts
        const scoredPosts = [
            ...followedPosts.map(p => ({ ...p.toObject(), _score: calculatePostScore(p, 'followed') })),
            ...nearbyPosts.map(p => ({ ...p.toObject(), _score: calculatePostScore(p, 'nearby') })),
            ...trendingPosts.map(p => ({ ...p.toObject(), _score: calculatePostScore(p, 'trending') })),
            ...nonFollowedPosts.map(p => ({ ...p.toObject(), _score: calculatePostScore(p, 'non-followed') })),
        ];

        // ✅ 7. Deduplicate and rank by score
        const seen = new Set();
        const deduplicated = scoredPosts
            .filter(post => {
                const id = post._id.toString();
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            });

        // Sort by score (highest first) with slight randomization for posts with similar scores
        const rankedFeed = deduplicated
            .sort((a, b) => {
                const scoreDiff = b._score - a._score;
                // If scores are very close (within 5 points), add slight randomization
                if (Math.abs(scoreDiff) <= 5) {
                    return Math.random() - 0.5;
                }
                return scoreDiff;
            })
            .filter(post => post._score > 0); // Filter out posts with 0 or negative scores

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
                const commentsRaw = await Comment.find({
                    postId: post._id,
                    parentCommentId: null,
                    isDeleted: false
                })
                    .sort({ createdAt: 1 })
                    .populate('userId', 'username profileImageUrl')
                    .select('_id content userId createdAt');

                // Filter out comments from deleted users (where userId is null after population)
                const comments = commentsRaw.filter(comment => comment.userId);

                // For each comment, fetch replies
                const commentsWithReplies = await Promise.all(
                    comments.map(async c => {
                        const repliesRaw = await Comment.find({
                            parentCommentId: c._id,
                            isDeleted: false
                        })
                            .sort({ createdAt: 1 })
                            .populate('userId', 'username profileImageUrl')
                            .select('_id content userId createdAt');

                        // Filter out replies from deleted users (where userId is null after population)
                        const replies = repliesRaw.filter(reply => reply.userId);
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
