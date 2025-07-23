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
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24hr expiry
    });

    res.status(201).json(new ApiResponse(201, story, "Story uploaded successfully"));
});

// 2. Fetch Stories from followed users (and self)
export const fetchStoriesFeed = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const user = await User.findById(userId).select("following");
    const following = user?.following || [];
    const storyUserIds = [userId, ...following];

    const now = new Date();
    const stories = await Story.find({
        userId: { $in: storyUserIds },
        isArchived: false,
        expiresAt: { $gt: now }
    })
        .sort({ createdAt: -1 })
        .populate("userId", "username profileImageUrl");

    res.status(200).json(new ApiResponse(200, stories, "Stories feed fetched"));
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

    res.status(200).json(new ApiResponse(200, stories, "User's stories fetched"));
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
    const story = await Story.findById(storyId).populate("viewers", "username profileImageUrl");
    if (!story) throw new ApiError(404, "Story not found");

    res.status(200).json(new ApiResponse(200, story.viewers, "Story viewers fetched"));
});


export const fetchArchivedStoriesByUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const stories = await Story.find({
        userId,
        isArchived: true
    }).sort({ createdAt: -1 });

    res.status(200).json(new ApiResponse(200, stories, "User's archived stories fetched"));
});