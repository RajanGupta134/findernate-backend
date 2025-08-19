import Story from "../models/story.models.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { ApiError } from "../utlis/ApiError.js";
import { uploadBufferToCloudinary } from "../utlis/cloudinary.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import { User } from "../models/user.models.js";

// 1. Upload Story
export const uploadStory = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    if (!req.file) throw new ApiError(400, "Media file is required");

    const result = await uploadBufferToCloudinary(req.file.buffer, "stories");
    if (!result.secure_url) throw new ApiError(500, "Failed to upload story media");

    const story = await Story.create({
        userId,
        mediaUrl: result.secure_url,
        mediaType: result.resource_type === "video" ? "video" : "image",
        caption: req.body.caption || "",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    // Map mediaType to postType, remove mediaType and viewers from response
    const storyObj = story.toObject();
    storyObj.postType = storyObj.mediaType;
    delete storyObj.mediaType;
    delete storyObj.viewers;

    res.status(201).json(new ApiResponse(201, storyObj, "Story uploaded successfully"));
});

// 2. Fetch Stories from followed users (and self) - excluding blocked users
export const fetchStoriesFeed = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const blockedUsers = req.blockedUsers || [];
    const user = await User.findById(userId).select("following");
    const following = user?.following || [];
    const storyUserIds = [userId, ...following].filter(id => !blockedUsers.includes(id.toString()));

    const now = new Date();
    const stories = await Story.find({
        userId: { $in: storyUserIds },
        isArchived: false,
        expiresAt: { $gt: now }
    })
        .sort({ createdAt: -1 })
        .populate("userId", "username profileImageUrl");

    // Map mediaType to postType and remove viewers
    const storiesWithPostType = stories.map(story => {
        const obj = story.toObject();
        obj.postType = obj.mediaType;
        delete obj.mediaType;
        delete obj.viewers;
        return obj;
    });

    res.status(200).json(new ApiResponse(200, storiesWithPostType, "Stories feed fetched"));
});
// 3. Fetch Stories by user id
export const fetchStoriesByUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const now = new Date();
    const stories = await Story.find({
        userId,
        isArchived: false,
        expiresAt: { $gt: now }
    }).sort({ createdAt: -1 });

    // Map mediaType to postType and remove viewers
    const storiesWithPostType = stories.map(story => {
        const obj = story.toObject();
        obj.postType = obj.mediaType;
        delete obj.mediaType;
        delete obj.viewers;
        return obj;
    });

    res.status(200).json(new ApiResponse(200, storiesWithPostType, "User's stories fetched"));
});

// 4. Mark Story as Seen
export const markStorySeen = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { storyId } = req.body;
    const story = await Story.findById(storyId);
    if (!story) throw new ApiError(404, "Story not found");

    if (!story.viewers.includes(userId)) {
        story.viewers.push(userId);
        await story.save();
    }

    res.status(200).json(new ApiResponse(200, {}, "Story marked as seen"));
});

// 5. Fetch list of seen people for a story
export const fetchStoryViewers = asyncHandler(async (req, res) => {
    const { storyId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const story = await Story.findById(storyId).populate("viewers", "username profileImageUrl");
    if (!story) throw new ApiError(404, "Story not found");

    // Pagination logic
    const start = (parseInt(page) - 1) * parseInt(limit);
    const end = start + parseInt(limit);
    const totalViewers = story.viewers.length;
    const paginatedViewers = story.viewers.slice(start, end);

    res.status(200).json(new ApiResponse(200, {
        viewers: paginatedViewers,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalViewers,
            totalPages: Math.ceil(totalViewers / parseInt(limit)),
            hasNextPage: end < totalViewers,
            hasPrevPage: start > 0
        }
    }, "Story viewers fetched"));
});

// 6. Fetch archived stories by user
export const fetchArchivedStoriesByUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [stories, total] = await Promise.all([
        Story.find({ userId, isArchived: true })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .select("-viewers -mediaType") // remove viewers and mediaType from response
            .lean()
            .exec(),
        Story.countDocuments({ userId, isArchived: true })
    ]);

    // Map mediaType to postType in response if needed
    const storiesWithPostType = stories.map(story => {
        story.postType = story.mediaType;
        delete story.mediaType;
        return story;
    });

    res.status(200).json(new ApiResponse(200, {
        stories: storiesWithPostType,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
            hasNextPage: skip + stories.length < total,
            hasPrevPage: skip > 0
        }
    }, "User's archived stories fetched"));
});