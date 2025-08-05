import { asyncHandler } from "../utlis/asyncHandler.js";
import Post from "../models/userPost.models.js";
import { ApiResponse } from "../utlis/ApiResponse.js";


// Simple in-memory cache
const cache = {
    reels: {
        data: null,
        timestamp: null,
        cacheKey: null,
        expiry: 5 * 60 * 1000 // 5 minutes
    }
};

// Unified function to get reels with comprehensive data and filtering
export const getSuggestedReels = asyncHandler(async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            userId,
            contentType,
            postType,
            sortBy = 'latest',
            location,
            tag,
            suggested = false
        } = req.query;

        const currentUserId = req.user?._id || userId;
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const skip = (pageNum - 1) * limitNum;

        // Build match criteria
        const matchCriteria = {
            status: { $in: ["published", "scheduled"] }
        };

        // Filter by postType if specified (reel, photo, video, story)
        if (postType) {
            matchCriteria.postType = postType;
        } else {
            // Default to reels and videos for better reel experience
            matchCriteria.postType = { $in: ["reel", "video", "photo"] };
        }

        // Filter by contentType if specified (normal, product, business)
        if (contentType) {
            matchCriteria.contentType = contentType;
        }

        // Filter by location if specified
        if (location) {
            matchCriteria.$or = [
                { "location": { $regex: location, $options: "i" } },
                { "customization.normal.location.name": { $regex: location, $options: "i" } },
                { "customization.product.location.name": { $regex: location, $options: "i" } },
                { "customization.business.location.city": { $regex: location, $options: "i" } }
            ];
        }

        // Filter by tag if specified
        if (tag) {
            matchCriteria.$or = [
                ...(matchCriteria.$or || []),
                { "hashtags": { $in: [tag] } },
                { "customization.normal.tags": { $in: [tag] } },
                { "customization.product.tags": { $in: [tag] } },
                { "customization.business.tags": { $in: [tag] } }
            ];
        }

        // Build sort criteria
        let sortCriteria = {};
        switch (sortBy) {
            case 'popular':
                sortCriteria = { "engagement.likes": -1, "engagement.views": -1, createdAt: -1 };
                break;
            case 'trending':
                sortCriteria = { "engagement.shares": -1, "engagement.comments": -1, createdAt: -1 };
                break;
            case 'oldest':
                sortCriteria = { createdAt: 1 };
                break;
            case 'latest':
            default:
                sortCriteria = { createdAt: -1, _id: -1 };
                break;
        }

        // Check cache first
        const cacheKey = `${pageNum}_${limitNum}_${currentUserId || 'anonymous'}_${postType || 'all'}_${contentType || 'all'}_${sortBy}_${location || ''}_${tag || ''}_${suggested}`;
        if (cache.reels.data &&
            cache.reels.timestamp &&
            cache.reels.cacheKey === cacheKey &&
            (Date.now() - cache.reels.timestamp < cache.reels.expiry)) {

            return res.status(200).json(
                new ApiResponse(200, cache.reels.data, "Reels fetched from cache")
            );
        }

        // Build aggregation pipeline for comprehensive data
        const pipeline = [
            // Match criteria
            { $match: matchCriteria },

            // Sort by specified criteria
            { $sort: sortCriteria },

            // Add pagination
            { $skip: skip },
            { $limit: limitNum },

            // Populate user data (excluding sensitive fields)
            {
                $lookup: {
                    from: "users",
                    localField: "userId",
                    foreignField: "_id",
                    as: "userDetails",
                    pipeline: [
                        {
                            $project: {
                                password: 0,
                                email: 0,
                                followers: 0,
                                following: 0,
                                phoneNumber: 0,
                                createdAt: 0,
                                updatedAt: 0,
                                isAccountVerified: 0,
                                isPhoneVerified: 0,
                                refreshToken: 0,
                                bio: 0,
                                link: 0,
                                emailVerificationToken: 0,
                                emailOTP: 0,
                                emailOTPExpiry: 0,
                                passwordResetOTP: 0,
                                passwordResetOTPExpiry: 0,
                                phoneVerificationCode: 0,
                                phoneVerificationExpiry: 0,
                                posts: 0,
                                dateOfBirth: 0,
                                gender: 0,
                                uid: 0,
                                __v: 0
                            }
                        }
                    ]
                }
            },

            // Add computed fields and enhance with Cloudinary details
            {
                $addFields: {
                    isLikedBy: false, // Will be updated based on user context
                    isFollowed: false, // Will be updated based on user context

                    // Enhanced media with Cloudinary details
                    media: {
                        $map: {
                            input: "$media",
                            as: "mediaItem",
                            in: {
                                $mergeObjects: [
                                    "$$mediaItem",
                                    {
                                        // Add Cloudinary metadata
                                        cloudinaryId: {
                                            $let: {
                                                vars: {
                                                    urlParts: { $split: ["$$mediaItem.url", "/"] }
                                                },
                                                in: {
                                                    $let: {
                                                        vars: {
                                                            filename: { $arrayElemAt: ["$$urlParts", -1] }
                                                        },
                                                        in: { $arrayElemAt: [{ $split: ["$$filename", "."] }, 0] }
                                                    }
                                                }
                                            }
                                        },
                                        cloudinaryFolder: {
                                            $let: {
                                                vars: {
                                                    urlParts: { $split: ["$$mediaItem.url", "/"] }
                                                },
                                                in: {
                                                    $arrayElemAt: ["$$urlParts", -2]
                                                }
                                            }
                                        },
                                        isCloudinaryHosted: {
                                            $regexMatch: {
                                                input: { $ifNull: ["$$mediaItem.url", ""] },
                                                regex: "cloudinary"
                                            }
                                        },
                                        quality: { $ifNull: ["$$mediaItem.quality", "auto"] },
                                        publicId: {
                                            $let: {
                                                vars: {
                                                    urlParts: { $split: ["$$mediaItem.url", "/"] }
                                                },
                                                in: {
                                                    $let: {
                                                        vars: {
                                                            filename: { $arrayElemAt: ["$$urlParts", -1] },
                                                            folder: { $arrayElemAt: ["$$urlParts", -2] }
                                                        },
                                                        in: {
                                                            $concat: [
                                                                "$$folder",
                                                                "/",
                                                                { $arrayElemAt: [{ $split: ["$$filename", "."] }, 0] }
                                                            ]
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        ];

        // Add user-specific fields if currentUserId is available
        if (currentUserId) {
            pipeline.push({
                $lookup: {
                    from: "likes",
                    let: { postId: "$_id", userId: currentUserId },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$postId", "$$postId"] },
                                        { $eq: ["$userId", "$$userId"] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "userLike"
                }
            });

            // Add lookup for following relationship
            pipeline.push({
                $lookup: {
                    from: "followings",
                    let: { postUserId: "$userId", currentUserId: currentUserId },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$userId", "$$currentUserId"] },
                                        { $eq: ["$followingId", "$$postUserId"] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "userFollow"
                }
            });

            pipeline.push({
                $addFields: {
                    isLikedBy: { $gt: [{ $size: "$userLike" }, 0] },
                    isFollowed: { $gt: [{ $size: "$userFollow" }, 0] }
                }
            });

            // Clean up temporary lookup fields
            pipeline.push({
                $project: {
                    userLike: 0,
                    userFollow: 0
                }
            });
        }

        // Remove analytics field from all responses
        pipeline.push({
            $project: {
                analytics: 0,
                customization: 0
            }
        });

        // Execute aggregation
        const reels = await Post.aggregate(pipeline);

        // Get total count for pagination
        const totalReels = await Post.countDocuments(matchCriteria);

        const responseData = {
            reels,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalReels,
                totalPages: Math.ceil(totalReels / limitNum),
                hasNext: pageNum < Math.ceil(totalReels / limitNum),
                hasPrev: pageNum > 1
            },
            filters: {
                postType: postType || 'all',
                contentType: contentType || 'all',
                sortBy: sortBy,
                location: location || null,
                tag: tag || null,
                suggested: suggested
            },
            metadata: {
                totalResults: totalReels,
                currentQuery: req.query,
                timestamp: new Date().toISOString()
            }
        };

        // Save to cache
        cache.reels.data = responseData;
        cache.reels.timestamp = Date.now();
        cache.reels.cacheKey = cacheKey;

        return res.status(200).json(
            new ApiResponse(200, responseData, "Reels fetched successfully")
        );
    } catch (error) {
        console.error("Error fetching reels:", error);
        return res.status(500).json(
            new ApiResponse(500, {}, "Error fetching reels from database")
        );
    }
});