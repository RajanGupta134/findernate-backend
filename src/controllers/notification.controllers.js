import Notification from "../models/notification.models.js";
import Message from "../models/message.models.js";
import Chat from "../models/chat.models.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { ApiError } from "../utlis/ApiError.js";

const sendRealTimeNotification = (recipientId, notification) => {
    const socketId = global.onlineUsers?.get(recipientId);
    if (socketId) {
        global.io.to(socketId).emit("notification", notification);
    }
};

// 🟢 Like Notification
export const createLikeNotification = asyncHandler(async ({ recipientId, sourceUserId, postId, commentId }) => {
    if (!recipientId || !sourceUserId) {
        throw new ApiError(400, "recipientId and sourceUserId are required");
    }

    const type = "like";
    const message = commentId ? "liked your comment" : "liked your post";

    if (!postId && !commentId) {
        throw new ApiError(400, "Either postId or commentId is required");
    }

    const notification = await Notification.create({
        receiverId: recipientId,
        type,
        senderId: sourceUserId,
        postId,
        commentId,
        message
    });

    sendRealTimeNotification(recipientId, notification);
});

// 🟡 Comment Notification
export const createCommentNotification = asyncHandler(async ({ recipientId, sourceUserId, postId, commentId }) => {
    if (!recipientId || !sourceUserId || !postId || !commentId) {
        throw new ApiError(400, "recipientId, sourceUserId, postId, and commentId are required");
    }

    const type = "comment";
    const message = "commented on your post";

    const notification = await Notification.create({
        receiverId: recipientId,
        type,
        senderId: sourceUserId,
        postId,
        commentId,
        message
    });

    sendRealTimeNotification(recipientId, notification);
});

//  Follow Notification
export const createFollowNotification = asyncHandler(async ({ recipientId, sourceUserId }) => {
    if (!recipientId || !sourceUserId) {
        throw new ApiError(400, "recipientId and sourceUserId are required");
    }

    const type = "follow";
    const message = "started following you";

    const notification = await Notification.create({
        receiverId: recipientId,
        type,
        senderId: sourceUserId,
        message
    });

    sendRealTimeNotification(recipientId, notification);
});

// 🔴 Unlike Notification
export const createUnlikeNotification = asyncHandler(async ({ recipientId, sourceUserId, postId, commentId }) => {
    if (!recipientId || !sourceUserId) {
        throw new ApiError(400, "recipientId and sourceUserId are required");
    }

    const type = "unlike";
    const message = commentId ? "unliked your comment" : "unliked your post";

    if (!postId && !commentId) {
        throw new ApiError(400, "Either postId or commentId is required");
    }

    const notification = await Notification.create({
        receiverId: recipientId,
        type,
        senderId: sourceUserId,
        postId,
        commentId,
        message
    });

    sendRealTimeNotification(recipientId, notification);
});

//  Get Logged-in User's Notifications
export const getNotifications = asyncHandler(async (req, res) => {
    const receiverId = req.user._id;

    const notifications = await Notification.find({ receiverId })
        .sort({ createdAt: -1 })
        .populate("senderId", "username profileImageUrl");

    res.status(200).json(new ApiResponse(200, notifications, "Notifications fetched successfully"));
});

// 📤 Mark a Notification as Read
export const markNotificationAsRead = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);
    if (!notification) throw new ApiError(404, "Notification not found");

    notification.isRead = true;
    await notification.save();

    res.status(200).json(new ApiResponse(200, notification, "Notification marked as read"));
});

// 📤 Mark All Notifications as Read
export const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
    const receiverId = req.user._id;

    await Notification.updateMany({ receiverId, isRead: false }, { $set: { isRead: true } });

    res.status(200).json(new ApiResponse(200, {}, "All notifications marked as read"));
});

// ❌ Delete a Notification
export const deleteNotification = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);
    if (!notification) throw new ApiError(404, "Notification not found");

    await notification.deleteOne();

    res.status(200).json(new ApiResponse(200, {}, "Notification deleted successfully"));
});

// 📊 Get Unread Counts (Notifications & Messages)
export const getUnreadCounts = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const userToken = req.headers.authorization?.split(" ")[1] || req.cookies?.accessToken;

    try {
        // Get unread notifications count
        const unreadNotificationsCount = await Notification.countDocuments({
            receiverId: userId,
            isRead: false
        });

        // Get user's chats
        const userChats = await Chat.find({
            participants: userId,
            status: 'active'
        }).select('_id');

        const chatIds = userChats.map(chat => chat._id);

        // Get unread messages count
        // A message is unread if the user is not in the readBy array
        const unreadMessagesCount = await Message.countDocuments({
            chatId: { $in: chatIds },
            sender: { $ne: userId }, // Exclude messages sent by the user
            readBy: { $ne: userId }, // User hasn't read the message
            isDeleted: false
        });

        const response = {
            unreadNotifications: unreadNotificationsCount,
            unreadMessages: unreadMessagesCount,
            userToken: userToken,
            timestamp: new Date().toISOString()
        };

        res.status(200).json(new ApiResponse(200, response, "Unread counts fetched successfully"));
    } catch (error) {
        throw new ApiError(500, "Error fetching unread counts: " + error.message);
    }
});
