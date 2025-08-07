import Post from '../models/userPost.models.js';
import Reel from '../models/reels.models.js';
import { User } from '../models/user.models.js';
import Business from '../models/business.models.js';
import SearchSuggestion from '../models/searchSuggestion.models.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { ApiError } from '../utlis/ApiError.js';
import { getCoordinates } from '../utlis/getCoordinates.js';

export const searchAllContent = async (req, res) => {
    try {
        const {
            q,
            contentType,
            postType,
            startDate,
            endDate,
            coordinates,
            distance,
            near,
            page = 1,
            limit = 20
        } = req.query;

        if (!q) throw new ApiError(400, "Search query 'q' is required");

        // Track search keyword if it's 3+ characters
        if (q.trim().length >= 3) {
            const normalizedKeyword = q.trim().toLowerCase();
            try {
                const existingSuggestion = await SearchSuggestion.findOne({
                    keyword: normalizedKeyword
                });


                if (existingSuggestion) {
                    existingSuggestion.searchCount += 1;
                    existingSuggestion.lastSearched = new Date();
                    await existingSuggestion.save();
                } else {
                    await SearchSuggestion.create({
                        keyword: normalizedKeyword,
                        searchCount: 1,
                        lastSearched: new Date()
                    });
                }
            } catch (error) {

            }
        }

        const searchRegex = new RegExp(q, 'i');
        const skip = (page - 1) * limit;

        // 🔍 Parse postType (can be comma-separated)
        let postTypeArray = [];
        if (postType) {
            postTypeArray = postType.split(',').map(type => type.trim());
        }

        // 🔎 Base Post filters
        const basePostFilters = {
            $or: [
                { caption: searchRegex },
                { description: searchRegex },
                { 'hashtags.text': searchRegex },
                { 'customization.business.businessName': searchRegex },
                { 'customization.business.category': searchRegex },
                { 'customization.business.subcategory': searchRegex },
                { 'customization.business.businessType': searchRegex },
                { 'customization.business.tags': searchRegex },
                { 'customization.product.name': searchRegex },
                { 'customization.product.category': searchRegex },
                { 'customization.product.subcategory': searchRegex },
                { 'customization.service.name': searchRegex },
                { 'customization.service.category': searchRegex },
                { 'customization.service.subcategory': searchRegex },
                { 'customization.normal.location.name': searchRegex },
                { 'customization.product.location.name': searchRegex },
                { 'customization.service.location.city': searchRegex },
                { 'customization.service.location.state': searchRegex },
                { 'customization.service.location.country': searchRegex },
                { 'customization.business.location.city': searchRegex },
                { 'customization.business.location.state': searchRegex },
                { 'customization.business.location.country': searchRegex },
            ],
            contentType: { $in: ['normal', 'service', 'product', 'business'] }
        };

        // Filter by contentType
        if (contentType && contentType !== 'reel') {
            basePostFilters.contentType = contentType;
        }

        // Filter by postType if provided
        if (postTypeArray.length > 0) {
            basePostFilters.postType = { $in: postTypeArray };
        }

        // 📅 Date filtering
        if (startDate || endDate) {
            basePostFilters.createdAt = {};
            if (startDate) basePostFilters.createdAt.$gte = new Date(startDate);
            if (endDate) basePostFilters.createdAt.$lte = new Date(endDate);
        }

        // 📍 Location filtering
        let lng, lat;
        let useLocationFilter = false;
        if (coordinates && distance) {
            [lng, lat] = coordinates.split('|').map(Number);
            useLocationFilter = true;
        } else if (near && distance) {
            const geo = await getCoordinates(near);
            if (geo && geo.longitude && geo.latitude) {
                lng = geo.longitude;
                lat = geo.latitude;
                useLocationFilter = true;
            } else {
                return res.status(400).json(new ApiResponse(400, null, `Could not resolve coordinates for place: ${near}`));
            }
        }

        if (useLocationFilter) {
            const geoFilter = {
                $geoWithin: {
                    $centerSphere: [[lng, lat], distance / 6371]
                }
            };

            basePostFilters.$or = basePostFilters.$or.map(condition => ({
                $and: [
                    condition,
                    {
                        $or: [
                            { 'customization.normal.location.coordinates': geoFilter },
                            { 'customization.service.location.coordinates': geoFilter },
                            { 'customization.product.location.coordinates': geoFilter },
                            { 'customization.business.location.coordinates': geoFilter },
                        ]
                    }
                ]
            }));
        }

        // First, find users that match the search query
        const matchingUsers = await User.find({
            $or: [
                { username: searchRegex },
                { fullName: searchRegex }
            ]
        }).select('_id');

        const matchingUserIds = matchingUsers.map(user => user._id);

        // Find businesses that match the search query by category
        const matchingBusinesses = await Business.find({
            $or: [
                { category: searchRegex },
                { businessName: searchRegex },
                { businessType: searchRegex },
                { tags: searchRegex }
            ]
        }).select('userId');

        const businessUserIds = matchingBusinesses.map(business => business.userId);

        // Add username search to post filters
        if (matchingUserIds.length > 0) {
            basePostFilters.$or.push({ userId: { $in: matchingUserIds } });
        }

        // Add business category search to post filters
        if (businessUserIds.length > 0) {
            basePostFilters.$or.push({ userId: { $in: businessUserIds } });
        }

        //  Fetch Posts
        const rawPosts = await Post.find(basePostFilters)
            .populate('userId', 'username profileImageUrl bio location')
            .lean();

        const scoredPosts = rawPosts.map(post => {
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

        // 📥 Fetch Reels
        let scoredReels = [];
        if (!contentType || contentType === 'reel') {
            const reelFilters = {
                $or: [
                    { caption: searchRegex },
                    { hashtags: searchRegex }
                ]
            };

            // Add username search to reel filters
            if (matchingUserIds.length > 0) {
                reelFilters.$or.push({ userId: { $in: matchingUserIds } });
            }

            // Add business category search to reel filters
            if (businessUserIds.length > 0) {
                reelFilters.$or.push({ userId: { $in: businessUserIds } });
            }

            if (postTypeArray.length > 0) {
                reelFilters.postType = { $in: postTypeArray };
            }

            if (startDate || endDate) {
                reelFilters.createdAt = {};
                if (startDate) reelFilters.createdAt.$gte = new Date(startDate);
                if (endDate) reelFilters.createdAt.$lte = new Date(endDate);
            }

            const rawReels = await Reel.find(reelFilters)
                .populate('userId', 'username profileImageUrl bio location')
                .lean();

            scoredReels = rawReels.map(reel => {
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
        }

        //  Merge + sort
        const combinedContent = [...scoredPosts, ...scoredReels]
            .sort((a, b) => b._score - a._score);

        const paginatedContent = combinedContent.slice(skip, skip + limit);

        //  Search Users
        const users = await User.find({
            $or: [
                { username: searchRegex },
                { fullName: searchRegex },
                { bio: searchRegex }
            ]
        })
            .limit(limit)
            .select('username fullName profileImageUrl bio location');

        // Fetch posts for each user found and include business information
        const usersWithPosts = await Promise.all(users.map(async (user) => {
            const userPosts = await Post.find({ userId: user._id })
                .sort({ createdAt: -1 })
                .limit(10) // Limit to 10 recent posts per user
                .lean();

            const userReels = await Reel.find({ userId: user._id })
                .sort({ createdAt: -1 })
                .limit(5) // Limit to 5 recent reels per user
                .lean();

            // Check if user has a business profile
            const businessProfile = await Business.findOne({ userId: user._id })
                .select('businessName category businessType tags isVerified rating')
                .lean();

            return {
                ...user.toObject(),
                business: businessProfile,
                posts: userPosts,
                reels: userReels,
                totalPosts: await Post.countDocuments({ userId: user._id }),
                totalReels: await Reel.countDocuments({ userId: user._id })
            };
        }));

        return res.status(200).json(
            new ApiResponse(200, {
                results: paginatedContent,
                users: usersWithPosts,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: combinedContent.length,
                    totalPages: Math.ceil(combinedContent.length / limit)
                }
            }, "Search results retrieved successfully")
        );

    } catch (error) {
        console.error(error);
        throw new ApiError(500, "Search failed");
    }
};
