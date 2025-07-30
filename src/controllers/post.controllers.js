import { asyncHandler } from "../utlis/asyncHandler.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import Post from "../models/userPost.models.js";
import { uploadBufferToCloudinary } from "../utlis/cloudinary.js";
import { getCoordinates } from "../utlis/getCoordinates.js";
import Like from "../models/like.models.js";
// import Comment from "../models/comment.models.mjs";

const extractMediaFiles = (files) => {
    const allFiles = [];
    ["image", "video", "reel", "story"].forEach((field) => {
        if (files?.[field]) {
            allFiles.push(...files[field]);
        }
    });
    return allFiles;
};


export const createNormalPost = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId) throw new ApiError(400, "User ID is required");

    const {
        postType,
        caption,
        description,
        mentions,
        mood,
        activity,
        location,
        tags,
        settings,
        scheduledAt,
        publishedAt,
        status,
    } = req.body;
    if (!postType || !["photo", "reel", "video", "story"].includes(postType)) {
        throw new ApiError(400, "postType must be one of 'photo', 'reel', 'video', or 'story'");
    }


    const parsedMentions = typeof mentions === "string" ? JSON.parse(mentions) : mentions;
    const parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    const parsedSettings = typeof settings === "string" ? JSON.parse(settings) : settings;
    const parsedLocation = typeof location === "string" ? JSON.parse(location) : location;

    let resolvedLocation = parsedLocation || {};
    if (resolvedLocation.name && !resolvedLocation.coordinates) {
        const coords = await getCoordinates(resolvedLocation.name);
        if (coords?.latitude && coords?.longitude) {
            resolvedLocation.coordinates = {
                type: "Point",
                coordinates: [coords.longitude, coords.latitude]
            };
        } else {
            throw new ApiError(400, `Could not resolve coordinates for location: ${resolvedLocation.name}`);
        }
    }

    const files = extractMediaFiles(req.files);
    if (!files.length) throw new ApiError(400, "Media file is required");

    let uploadedMedia = [];

    for (const file of files) {
        try {
            const result = await uploadBufferToCloudinary(file.buffer, "posts");
            if (result.resource_type === "image") {
                const thumbnailUrl = result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/');
                uploadedMedia.push({
                    type: result.resource_type,
                    url: result.secure_url,
                    thumbnailUrl,
                    fileSize: result.bytes,
                    format: result.format,
                    duration: result.duration || null,
                    dimensions: {
                        width: result.width,
                        height: result.height,
                    },
                });
            } else if (result.resource_type === "video") {
                let thumbnailUrl;
                const customThumbnail = req.files?.thumbnail?.[0];
                if (customThumbnail) {
                    const thumbResult = await uploadBufferToCloudinary(customThumbnail.buffer, "posts");
                    thumbnailUrl = thumbResult.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/');
                } else {
                    // Generate Cloudinary thumbnail from video URL (first frame, 300x300 crop)
                    thumbnailUrl = result.secure_url
                        .replace('/upload/', '/upload/w_300,h_300,c_fill,so_1/')
                        .replace(/\.(mp4|mov|webm)$/i, '.jpg');
                }
                uploadedMedia.push({
                    type: result.resource_type,
                    url: result.secure_url,
                    thumbnailUrl,
                    fileSize: result.bytes,
                    format: result.format,
                    duration: result.duration || null,
                    dimensions: {
                        width: result.width,
                        height: result.height,
                    },
                });
            }
        } catch {
            throw new ApiError(500, "Cloudinary upload failed");
        }
    }

    const post = await Post.create({
        userId,
        postType,
        contentType: "normal",
        caption,
        description,
        mentions: parsedMentions || [],
        media: uploadedMedia,
        customization: {
            normal: {
                mood,
                activity,
                location: resolvedLocation,
                tags: parsedTags || [],
            },
        },
        settings: parsedSettings || {},
        scheduledAt,
        publishedAt,
        status: status || (scheduledAt ? "scheduled" : "published"),
        isPromoted: false,
        isFeatured: false,
        isReported: false,
        reportCount: 0,
        engagement: {},
        analytics: {},
    });

    return res.status(201).json(new ApiResponse(201, post, "Normal post created successfully"));
});

export const createProductPost = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId) throw new ApiError(400, "User ID is required");

    const {
        postType,
        caption,
        description,
        mentions,
        mood,
        activity,
        location,
        tags,
        product,
        settings,
        scheduledAt,
        publishedAt,
        status,
    } = req.body;
    if (!postType || !["photo", "reel", "video", "story"].includes(postType)) {
        throw new ApiError(400, "postType must be one of 'photo', 'reel', 'video', or 'story'");
    }

    const parsedMentions = typeof mentions === "string" ? JSON.parse(mentions) : mentions;
    const parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    const parsedProduct = typeof product === "string" ? JSON.parse(product) : product;
    const parsedSettings = typeof settings === "string" ? JSON.parse(settings) : settings;
    const parsedLocation = typeof location === "string" ? JSON.parse(location) : location;

    let resolvedLocation = parsedLocation || {};
    if (resolvedLocation.name && !resolvedLocation.coordinates) {
        const coords = await getCoordinates(resolvedLocation.name);
        if (coords?.latitude && coords?.longitude) {
            resolvedLocation.coordinates = {
                type: "Point",
                coordinates: [coords.longitude, coords.latitude]
            };
        } else {
            throw new ApiError(400, `Could not resolve coordinates for location: ${resolvedLocation.name}`);
        }
    }

    const files = extractMediaFiles(req.files);

    if (!files.length) throw new ApiError(400, "Media file is required");

    let uploadedMedia = [];
    for (const file of files) {
        try {

            const result = await uploadBufferToCloudinary(file.buffer, "posts");
            if (result.resource_type === "image") {
                const thumbnailUrl = result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/');
                uploadedMedia.push({
                    type: result.resource_type,
                    url: result.secure_url,
                    thumbnailUrl,
                    fileSize: result.bytes,
                    format: result.format,
                    duration: result.duration || null,
                    dimensions: {
                        width: result.width,
                        height: result.height,
                    },
                });
            } else if (result.resource_type === "video") {
                let thumbnailUrl;
                const customThumbnail = req.files?.thumbnail?.[0];
                if (customThumbnail) {
                    const thumbResult = await uploadBufferToCloudinary(customThumbnail.buffer, "posts");
                    thumbnailUrl = thumbResult.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/');
                } else {
                    // Generate Cloudinary thumbnail from video URL (first frame, 300x300 crop)
                    thumbnailUrl = result.secure_url
                        .replace('/upload/', '/upload/w_300,h_300,c_fill,so_1/')
                        .replace(/\.(mp4|mov|webm)$/i, '.jpg');
                }
                uploadedMedia.push({
                    type: result.resource_type,
                    url: result.secure_url,
                    thumbnailUrl,
                    fileSize: result.bytes,
                    format: result.format,
                    duration: result.duration || null,
                    dimensions: {
                        width: result.width,
                        height: result.height,
                    },
                });
            }
        } catch (error) {
            console.error("Upload failed for:", file.originalname, error);
            throw new ApiError(500, "Cloudinary upload failed");
        }
    }
    if (!parsedProduct?.link) {
        throw new ApiError(400, "Product post must include a product link");
    }

    const post = await Post.create({
        userId,
        postType,
        contentType: "product",
        caption,
        description,
        mentions: parsedMentions || [],
        media: uploadedMedia,
        customization: {
            product: parsedProduct,
            normal: {
                mood,
                activity,
                location: resolvedLocation,
                tags: parsedTags || [],
            },
        },
        settings: parsedSettings || {},
        scheduledAt,
        publishedAt,
        status: status || (scheduledAt ? "scheduled" : "published"),
        isPromoted: false,
        isFeatured: false,
        isReported: false,
        reportCount: 0,
        engagement: {},
        analytics: {},
    });

    return res.status(201).json(new ApiResponse(201, post, "Product post created successfully"));
});

export const createServicePost = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId) throw new ApiError(400, "User ID is required");

    const {
        postType,
        caption,
        description,
        mentions,
        mood,
        activity,
        location,
        tags,
        service,
        settings,
        scheduledAt,
        publishedAt,
        status,
    } = req.body;
    if (!postType || !["photo", "reel", "video", "story"].includes(postType)) {
        throw new ApiError(400, "postType must be one of 'photo', 'reel', 'video', or 'story'");
    }

    const parsedMentions = typeof mentions === "string" ? JSON.parse(mentions) : mentions;
    const parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    const parsedService = typeof service === "string" ? JSON.parse(service) : service;
    const parsedSettings = typeof settings === "string" ? JSON.parse(settings) : settings;
    const parsedLocation = typeof location === "string" ? JSON.parse(location) : location;

    let resolvedLocation = parsedLocation || {};
    if (resolvedLocation.name && !resolvedLocation.coordinates) {
        const coords = await getCoordinates(resolvedLocation.name);
        if (coords?.latitude && coords?.longitude) {
            resolvedLocation.coordinates = {
                type: "Point",
                coordinates: [coords.longitude, coords.latitude]
            };
        } else {
            throw new ApiError(400, `Could not resolve coordinates for location: ${resolvedLocation.name}`);
        }
    }

    const files = extractMediaFiles(req.files);
    if (!files.length) throw new ApiError(400, "Media file is required");

    let uploadedMedia = [];
    for (const file of files) {
        try {
            const result = await uploadBufferToCloudinary(file.buffer, "posts");
            if (result.resource_type === "image") {
                const thumbnailUrl = result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/');
                uploadedMedia.push({
                    type: result.resource_type,
                    url: result.secure_url,
                    thumbnailUrl,
                    fileSize: result.bytes,
                    format: result.format,
                    duration: result.duration || null,
                    dimensions: {
                        width: result.width,
                        height: result.height,
                    },
                });
            } else if (result.resource_type === "video") {
                let thumbnailUrl;
                const customThumbnail = req.files?.thumbnail?.[0];
                if (customThumbnail) {
                    const thumbResult = await uploadBufferToCloudinary(customThumbnail.buffer, "posts");
                    thumbnailUrl = thumbResult.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/');
                } else {
                    // Generate Cloudinary thumbnail from video URL (first frame, 300x300 crop)
                    thumbnailUrl = result.secure_url
                        .replace('/upload/', '/upload/w_300,h_300,c_fill,so_1/')
                        .replace(/\.(mp4|mov|webm)$/i, '.jpg');
                }
                uploadedMedia.push({
                    type: result.resource_type,
                    url: result.secure_url,
                    thumbnailUrl,
                    fileSize: result.bytes,
                    format: result.format,
                    duration: result.duration || null,
                    dimensions: {
                        width: result.width,
                        height: result.height,
                    },
                });
            }
        } catch {
            throw new ApiError(500, "Cloudinary upload failed");
        }
    }
    if (!parsedService?.link) {
        throw new ApiError(400, "Service post must include a service link");
    }

    const post = await Post.create({
        userId,
        postType,
        contentType: "service",
        caption,
        description,
        mentions: parsedMentions || [],
        media: uploadedMedia,
        customization: {
            service: parsedService,
            normal: {
                mood,
                activity,
                location: resolvedLocation,
                tags: parsedTags || [],
            },
        },
        settings: parsedSettings || {},
        scheduledAt,
        publishedAt,
        status: status || (scheduledAt ? "scheduled" : "published"),
        isPromoted: false,
        isFeatured: false,
        isReported: false,
        reportCount: 0,
        engagement: {},
        analytics: {},
    });

    return res.status(201).json(new ApiResponse(201, post, "Service post created successfully"));
});

export const createBusinessPost = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId) throw new ApiError(400, "User ID is required");

    const {
        postType,
        caption,
        description,
        mentions,
        mood,
        activity,
        location,
        tags,
        business,
        settings,
        scheduledAt,
        publishedAt,
        status,
    } = req.body;
    if (!postType || !["photo", "reel", "video", "story"].includes(postType)) {
        throw new ApiError(400, "postType must be one of 'photo', 'reel', 'video', or 'story'");
    }

    const parsedMentions = typeof mentions === "string" ? JSON.parse(mentions) : mentions;
    const parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    const parsedBusiness = typeof business === "string" ? JSON.parse(business) : business;
    const parsedSettings = typeof settings === "string" ? JSON.parse(settings) : settings;
    const parsedLocation = typeof location === "string" ? JSON.parse(location) : location;

    let resolvedLocation = parsedLocation || {};
    if (resolvedLocation.name && !resolvedLocation.coordinates) {
        const coords = await getCoordinates(resolvedLocation.name);
        if (coords?.latitude && coords?.longitude) {
            resolvedLocation.coordinates = {
                type: "Point",
                coordinates: [coords.longitude, coords.latitude]
            };
        } else {
            throw new ApiError(400, `Could not resolve coordinates for location: ${resolvedLocation.name}`);
        }
    }

    const files = extractMediaFiles(req.files);
    if (!files.length) throw new ApiError(400, "Media file is required");

    let uploadedMedia = [];
    for (const file of files) {
        try {
            const result = await uploadBufferToCloudinary(file.buffer, "posts");
            if (result.resource_type === "image") {
                const thumbnailUrl = result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/');
                uploadedMedia.push({
                    type: result.resource_type,
                    url: result.secure_url,
                    thumbnailUrl,
                    fileSize: result.bytes,
                    format: result.format,
                    duration: result.duration || null,
                    dimensions: {
                        width: result.width,
                        height: result.height,
                    },
                });
            } else if (result.resource_type === "video") {
                let thumbnailUrl;
                const customThumbnail = req.files?.thumbnail?.[0];
                if (customThumbnail) {
                    const thumbResult = await uploadBufferToCloudinary(customThumbnail.buffer, "posts");
                    thumbnailUrl = thumbResult.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/');
                } else {
                    // Generate Cloudinary thumbnail from video URL (first frame, 300x300 crop)
                    thumbnailUrl = result.secure_url
                        .replace('/upload/', '/upload/w_300,h_300,c_fill,so_1/')
                        .replace(/\.(mp4|mov|webm)$/i, '.jpg');
                }
                uploadedMedia.push({
                    type: result.resource_type,
                    url: result.secure_url,
                    thumbnailUrl,
                    fileSize: result.bytes,
                    format: result.format,
                    duration: result.duration || null,
                    dimensions: {
                        width: result.width,
                        height: result.height,
                    },
                });
            }
        } catch {
            throw new ApiError(500, "Cloudinary upload failed");
        }
    }

    if (!parsedBusiness?.link) {
        throw new ApiError(400, "Business post must include a business link");
    }

    const post = await Post.create({
        userId,
        postType,
        contentType: "business",
        caption,
        description,
        mentions: parsedMentions || [],
        media: uploadedMedia,
        customization: {
            business: parsedBusiness,
            normal: {
                mood,
                activity,
                location: resolvedLocation,
                tags: parsedTags || [],
            },
        },
        settings: parsedSettings || {},
        scheduledAt,
        publishedAt,
        status: status || (scheduledAt ? "scheduled" : "published"),
        isPromoted: false,
        isFeatured: false,
        isReported: false,
        reportCount: 0,
        engagement: {},
        analytics: {},
    });

    return res.status(201).json(new ApiResponse(201, post, "Business post created successfully"));
});


// Get all posts
export const getAllPosts = asyncHandler(async (req, res) => {
    const filter = { ...req.query };
    const posts = await Post.find(filter).sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, posts, "Posts fetched successfully"));
});

// Get post by ID
export const getPostById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const post = await Post.findById(id);
    if (!post) throw new ApiError(404, "Post not found");
    return res.status(200).json(new ApiResponse(200, post, "Post fetched successfully"));
});

// Update post
export const updatePost = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    updates.updatedAt = new Date();

    const post = await Post.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (!post) throw new ApiError(404, "Post not found");

    return res.status(200).json(new ApiResponse(200, post, "Post updated successfully"));
});

// Delete post
export const deletePost = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const post = await Post.findByIdAndDelete(id);
    if (!post) throw new ApiError(404, "Post not found");

    return res.status(200).json(new ApiResponse(200, {}, "Post deleted successfully"));
});

// Get nearby posts using 2dsphere index
export const getNearbyPosts = asyncHandler(async (req, res) => {
    const { latitude, longitude, distance = 1000 } = req.query;
    if (!latitude || !longitude) {
        throw new ApiError(400, "Latitude and longitude are required");
    }

    const posts = await Post.find({
        "customization.normal.location.coordinates": {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: [parseFloat(longitude), parseFloat(latitude)]
                },
                $maxDistance: parseInt(distance)
            }
        }
    });

    return res.status(200).json(new ApiResponse(200, posts, "Nearby posts fetched successfully"));
});

// Get trending posts (basic version using likes + comments)
export const getTrendingPosts = asyncHandler(async (req, res) => {
    const posts = await Post.find()
        .sort({
            "engagement.likes": -1,
            "engagement.comments": -1,
            createdAt: -1
        })
        .limit(20);

    return res.status(200).json(new ApiResponse(200, posts, "Trending posts fetched successfully"));
});

// Save post as draft
export const saveDraft = asyncHandler(async (req, res) => {
    const userId = req.user?._id || req.body.userId;
    const postData = req.body;

    const post = await Post.create({
        ...postData,
        userId,
        status: "draft"
    });

    return res.status(201).json(new ApiResponse(201, post, "Post saved as draft"));
});

// Schedule post for future
export const schedulePost = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { scheduledAt } = req.body;
    if (!scheduledAt) throw new ApiError(400, "scheduledAt time is required");

    const post = await Post.findByIdAndUpdate(id, {
        status: "scheduled",
        scheduledAt
    }, { new: true });

    return res.status(200).json(new ApiResponse(200, post, "Post scheduled successfully"));
});

export const getMyPosts = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId) throw new ApiError(401, "Unauthorized: User ID missing");

    const { postType, contentType } = req.query;
    let { page, limit } = req.query;

    page = parseInt(page) > 0 ? parseInt(page) : 1;
    limit = parseInt(limit) > 0 ? parseInt(limit) : 10;

    const filter = { userId };

    if (postType) {
        filter.postType = postType;
    }

    if (contentType) {
        filter.contentType = contentType;
    }

    const posts = await Post.find(filter)
        .populate('userId', 'username profileImageUrl fullName isVerified location bio')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

    const total = await Post.countDocuments(filter);

    const postsWithThumbnails = posts.map(post => {
        const postObj = post.toObject();
        postObj.media = (postObj.media || []).map(media => {
            let thumbnailUrl = media.thumbnailUrl ?? null;
            if (
                media.type === "video" &&
                (!thumbnailUrl || thumbnailUrl === "null") &&
                typeof media.url === "string"
            ) {
                thumbnailUrl = media.url
                    .replace('/upload/', '/upload/w_300,h_300,c_fill,so_1/')
                    .replace(/\.(mp4|mov|webm)$/i, '.jpg');
            }
            return {
                ...media,
                thumbnailUrl
            };
        });
        return postObj;
    });

    // Enhancement: Add isLikedBy and likedBy fields (like getUserProfilePosts)
    const currentUserId = req.user?._id?.toString();
    const postIds = postsWithThumbnails.map(post => post._id.toString());
    const likes = await Like.find({ postId: { $in: postIds } }).lean();
    // Map postId to array of userIds who liked it
    const likesByPost = {};
    likes.forEach(like => {
        const pid = like.postId.toString();
        if (!likesByPost[pid]) likesByPost[pid] = [];
        likesByPost[pid].push(like.userId.toString());
    });
    // Fetch user details for all liked users
    const allLikedUserIds = Array.from(new Set(likes.flatMap(like => like.userId.toString())));
    let likedUsersMap = {};
    if (allLikedUserIds.length > 0) {
        const likedUsers = await Post.db.model('User').find(
            { _id: { $in: allLikedUserIds } },
            'username profileImageUrl fullName isVerified'
        ).lean();
        likedUsersMap = likedUsers.reduce((acc, user) => {
            acc[user._id.toString()] = user;
            return acc;
        }, {});
    }
    postsWithThumbnails.forEach(post => {
        const pid = post._id.toString();
        const likedByIds = likesByPost[pid] || [];
        post.likedBy = likedByIds.map(uid => likedUsersMap[uid]).filter(Boolean); // array of user details
        post.isLikedBy = currentUserId ? likedByIds.includes(currentUserId) : false;
    });

    return res.status(200).json(
        new ApiResponse(200, {
            totalPosts: total,
            page,
            totalPages: Math.ceil(total / limit),
            posts: postsWithThumbnails
        }, "User posts fetched successfully")
    );
});


export const getUserProfilePosts = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const {
        postType,
        contentType,
        page,
        limit,
        sortBy = 'createdAt',
        sortOrder = 'desc'
    } = req.query;

    if (!userId) {
        throw new ApiError(400, "User ID is required");
    }

    // Parse pagination values or use defaults
    const currentPage = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 20;
    const skip = (currentPage - 1) * pageLimit;

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sortObj = { [sortBy]: sortDirection };

    // Build filter object
    const filter = {
        userId,
        status: { $in: ['published', 'scheduled'] }
    };

    if (postType) {
        const validPostTypes = ['photo', 'reel', 'video'];
        if (!validPostTypes.includes(postType.toLowerCase())) {
            throw new ApiError(400, "Invalid post type. Must be one of: photo, reel, video");
        }
        filter.postType = postType.toLowerCase();
    }

    if (contentType) {
        const validContentTypes = ['normal', 'business', 'product', 'service'];
        if (!validContentTypes.includes(contentType.toLowerCase())) {
            throw new ApiError(400, "Invalid content type. Must be one of: normal, business, product, service");
        }
        filter.contentType = contentType.toLowerCase();
    }

    try {
        const posts = await Post.find(filter)
            .populate('userId', 'username profileImageUrl fullName isVerified location bio')
            .populate('mentions', 'username fullName profileImageUrl')
            .sort(sortObj)
            .skip(skip)
            .limit(pageLimit)
            .lean();

        const totalPosts = await Post.countDocuments(filter);
        const totalPages = Math.ceil(totalPosts / pageLimit);

        // Enhancement: Add isLikedBy and likedBy fields
        const currentUserId = req.user?._id?.toString();
        const postIds = posts.map(post => post._id);
        // Fetch all likes for these posts
        const likes = await Like.find({ postId: { $in: postIds } }).lean();
        // Map postId to array of userIds who liked it
        const likesByPost = {};
        likes.forEach(like => {
            const pid = like.postId.toString();
            if (!likesByPost[pid]) likesByPost[pid] = [];
            likesByPost[pid].push(like.userId.toString());
        });
        // Add isLikedBy and likedBy to each post
        // Instead of just userIds, fetch user details for likedBy
        const allLikedUserIds = Array.from(new Set(likes.flatMap(like => like.userId.toString())));
        let likedUsersMap = {};
        if (allLikedUserIds.length > 0) {
            const likedUsers = await Post.db.model('User').find(
                { _id: { $in: allLikedUserIds } },
                'username profileImageUrl fullName isVerified'
            ).lean();
            likedUsersMap = likedUsers.reduce((acc, user) => {
                acc[user._id.toString()] = user;
                return acc;
            }, {});
        }
        posts.forEach(post => {
            const pid = post._id.toString();
            const likedByIds = likesByPost[pid] || [];
            post.likedBy = likedByIds.map(uid => likedUsersMap[uid]).filter(Boolean); // array of user details
            post.isLikedBy = currentUserId ? likedByIds.includes(currentUserId) : false;
        });

        return res.status(200).json(
            new ApiResponse(200, {
                posts,
                pagination: {
                    currentPage,
                    totalPages,
                    totalPosts,
                    hasNextPage: currentPage < totalPages,
                    hasPrevPage: currentPage > 1,
                    limit: pageLimit
                },
                filters: {
                    postType: postType || 'all',
                    contentType: contentType || 'all'
                }
            }, "User profile posts fetched successfully")
        );
    } catch (error) {
        console.error("Error fetching user profile posts:", error);
        throw new ApiError(500, "Failed to fetch user profile posts");
    }
});
