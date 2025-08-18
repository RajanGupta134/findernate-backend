import SearchSuggestion from '../models/searchSuggestion.models.js';
import { User } from '../models/user.models.js';
import Post from '../models/userPost.models.js';
import Reel from '../models/reels.models.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { ApiError } from '../utlis/ApiError.js';
import { asyncHandler } from '../utlis/asyncHandler.js';

export const getSearchSuggestions = asyncHandler(async (req, res) => {
    const { q, limit = 10, includeUserPosts } = req.query;



    if (!q || q.trim().length < 2) {
        throw new ApiError(400, "Search query must be at least 2 characters long");
    }

    const keyword = q.trim().toLowerCase();
    const searchRegex = new RegExp(keyword, 'i');

    // Get keyword suggestions from search history
    const suggestions = await SearchSuggestion.find({
        keyword: { $regex: `^${keyword}`, $options: 'i' }
    })
        .sort({ searchCount: -1, lastSearched: -1 })
        .limit(parseInt(limit))
        .select('keyword');

    const keywords = suggestions.map(s => s.keyword);

    // Check if we should include user posts - either explicitly requested OR if no users found in suggestions, search for users
    const shouldIncludePosts = includeUserPosts === 'true' || includeUserPosts === true || includeUserPosts === '1';

    // Also check if there are any matching users - if yes, always include posts for better search results
    const potentialUsers = await User.find({
        $or: [
            { username: searchRegex },
            { fullName: searchRegex }
        ]
    }).limit(1);

    const hasMatchingUsers = potentialUsers.length > 0;
    const finalShouldIncludePosts = shouldIncludePosts || hasMatchingUsers;

    if (finalShouldIncludePosts) {
        console.log('✅ Including user posts in search...');
        // Find users matching the search query
        const users = await User.find({
            $or: [
                { username: searchRegex },
                { fullName: searchRegex }
            ]
        })
            .limit(parseInt(limit))
            .select('username fullName profileImageUrl bio location');



        // Fetch posts for each user found - exactly like searchAllContent
        const usersWithPosts = await Promise.all(users.map(async (user) => {
            const userPosts = await Post.find({ userId: user._id })
                .sort({ createdAt: -1 })
                .limit(10) // Limit to 10 recent posts per user (same as searchAllContent)
                .lean();

            const userReels = await Reel.find({ userId: user._id })
                .sort({ createdAt: -1 })
                .limit(5) // Limit to 5 recent reels per user (same as searchAllContent)
                .lean();

            return {
                ...user.toObject(),
                posts: userPosts,
                reels: userReels,
                totalPosts: await Post.countDocuments({ userId: user._id }),
                totalReels: await Reel.countDocuments({ userId: user._id })
            };
        }));

        // Now get all posts/reels from matching users for the main results array with population and scoring
        const allUserPosts = await Post.find({
            userId: { $in: users.map(u => u._id) }
        })
            .populate('userId', 'username profileImageUrl bio location')
            .sort({ createdAt: -1 })
            .lean();

        const allUserReels = await Reel.find({
            userId: { $in: users.map(u => u._id) }
        })
            .populate('userId', 'username profileImageUrl bio location')
            .sort({ createdAt: -1 })
            .lean();

        // Add scoring system like searchAllContent
        const scoredPosts = allUserPosts.map(post => {
            const engagement = post.engagement || {};
            const score =
                (engagement.likes || 0) * 1 +
                (engagement.comments || 0) * 0.7 +
                (engagement.views || 0) * 0.5 +
                (engagement.shares || 0) * 0.5;

            let base = 0;
            switch (post.contentType) {
                case 'product': base = 1.5; break;
                case 'service': base = 1.2; break;
                case 'business': base = 1.0; break;
                case 'normal': base = 0.8; break;
            }

            return {
                ...post,
                _score: base + score + (new Date(post.createdAt).getTime() / 10000000000000),
                _type: 'post'
            };
        });

        const scoredReels = allUserReels.map(reel => {
            const engagement = reel.engagement || {};
            const score =
                (engagement.likes || 0) * 1 +
                (engagement.comments || 0) * 0.7 +
                (engagement.views || 0) * 1.5 +
                (engagement.shares || 0) * 0.5;

            return {
                ...reel,
                _score: 2 + score + (new Date(reel.createdAt).getTime() / 10000000000000),
                _type: 'reel'
            };
        });

        // Create combined results array like searchAllContent
        const combinedResults = [...scoredPosts, ...scoredReels]
            .sort((a, b) => b._score - a._score);


        return res.status(200).json(
            new ApiResponse(200, {
                results: combinedResults,
                users: usersWithPosts,
                pagination: {
                    page: 1,
                    limit: parseInt(limit),
                    total: combinedResults.length,
                    totalPages: Math.ceil(combinedResults.length / parseInt(limit))
                }
            }, "Search results retrieved successfully")
        );
    }

    // Default behavior - return just keywords
    return res.status(200).json(
        new ApiResponse(200, keywords, "Search suggestions retrieved successfully")
    );
});

