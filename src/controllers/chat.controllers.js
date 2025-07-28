import Chat from '../models/chat.models.js';
import Message from '../models/message.models.js';
import { ApiError } from '../utlis/ApiError.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import mongoose from 'mongoose';
import socketManager from '../config/socket.js';

// Helper function to safely emit socket events
const safeEmitToChat = (chatId, event, data) => {
    if (socketManager.isReady()) {
        socketManager.emitToChat(chatId, event, data);
    } else {
        console.warn(`Socket not ready, skipping ${event} for chat ${chatId}`);
    }
};

// Create a new chat (1-on-1 or group)
export const createChat = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { participants, chatType = 'direct', groupName, groupDescription } = req.body;

    if (!participants || !Array.isArray(participants) || participants.length < 2) {
        throw new ApiError(400, 'At least two participants required');
    }

    // Ensure current user is included in participants
    if (!participants.includes(currentUserId.toString())) {
        participants.push(currentUserId.toString());
    }

    // Validate participants exist
    const validParticipants = participants.filter(p => mongoose.Types.ObjectId.isValid(p));
    if (validParticipants.length !== participants.length) {
        throw new ApiError(400, 'Invalid participant IDs');
    }

    // Sort participants for consistent ordering (fixes duplication check)
    validParticipants.sort();

    // Prevent duplicate 1-on-1 chats
    if (chatType === 'direct' && validParticipants.length === 2) {
        const existing = await Chat.findOne({
            participants: validParticipants,
            chatType: 'direct'
        }).populate('participants', 'username fullName profileImageUrl');

        if (existing) {
            return res.status(200).json(
                new ApiResponse(200, existing, 'Existing chat found')
            );
        }
    }

    const chatData = {
        participants: validParticipants,
        chatType,
        createdBy: currentUserId
    };

    if (chatType === 'group') {
        if (!groupName) {
            throw new ApiError(400, 'Group name is required for group chats');
        }
        chatData.groupName = groupName;
        chatData.groupDescription = groupDescription;
        chatData.admins = [currentUserId];
    }

    const chat = await Chat.create(chatData);
    const populatedChat = await Chat.findById(chat._id)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('createdBy', 'username fullName profileImageUrl');

    return res.status(201).json(
        new ApiResponse(201, populatedChat, 'Chat created successfully')
    );
});

// Get all chats for a user
export const getUserChats = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 20;
    const skip = (pageNum - 1) * pageLimit;

    const [chats, total] = await Promise.all([
        Chat.find({ participants: currentUserId })
            .sort({ lastMessageAt: -1 })
            .populate('participants', 'username fullName profileImageUrl')
            .populate('lastMessage.sender', 'username fullName profileImageUrl')
            .populate('createdBy', 'username fullName profileImageUrl')
            .skip(skip)
            .limit(pageLimit)
            .lean(),
        Chat.countDocuments({ participants: currentUserId })
    ]);

    // Get unread counts for all chats efficiently
    const chatIds = chats.map(chat => chat._id);
    const unreadCounts = await Message.aggregate([
        {
            $match: {
                chatId: { $in: chatIds },
                isDeleted: { $ne: true },
                readBy: { $ne: currentUserId }
            }
        },
        {
            $group: {
                _id: '$chatId',
                unreadCount: { $sum: 1 }
            }
        }
    ]);

    // Create a map for quick lookup
    const unreadCountMap = unreadCounts.reduce((acc, item) => {
        acc[item._id.toString()] = item.unreadCount;
        return acc;
    }, {});

    // Add unread count to each chat
    const chatsWithUnreadCount = chats.map(chat => ({
        ...chat,
        unreadCount: unreadCountMap[chat._id.toString()] || 0
    }));

    return res.status(200).json(
        new ApiResponse(200, {
            chats: chatsWithUnreadCount,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(total / pageLimit),
                totalChats: total,
                hasNextPage: pageNum < Math.ceil(total / pageLimit),
                hasPrevPage: pageNum > 1
            }
        }, 'Chats fetched successfully')
    );
});

// Get messages for a chat
export const getChatMessages = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 50;
    const skip = (pageNum - 1) * pageLimit;

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    // Get messages with pagination using Message model
    const [messages, totalMessages] = await Promise.all([
        Message.find({
            chatId,
            isDeleted: { $ne: true }
        })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(pageLimit)
            .populate('sender', 'username fullName profileImageUrl')
            .populate('replyTo', 'message sender')
            .lean(),
        Message.countDocuments({
            chatId,
            isDeleted: { $ne: true }
        })
    ]);

    return res.status(200).json(
        new ApiResponse(200, {
            messages: messages.reverse(), // Reverse to get chronological order
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalMessages / pageLimit),
                totalMessages,
                hasNextPage: pageNum < Math.ceil(totalMessages / pageLimit),
                hasPrevPage: pageNum > 1
            }
        }, 'Messages fetched successfully')
    );
});

// Add a message to a chat
export const addMessage = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId } = req.params;
    const { message, messageType = 'text', replyTo } = req.body;

    if (!message || message.trim().length === 0) {
        throw new ApiError(400, 'Message content is required');
    }

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    // Create new message using Message model
    const newMessage = await Message.create({
        chatId,
        sender: currentUserId,
        message: message.trim(),
        messageType,
        timestamp: new Date(),
        readBy: [currentUserId],
        replyTo: replyTo || null
    });

    // Update chat's last message info
    chat.lastMessageAt = new Date();
    chat.lastMessage = {
        sender: currentUserId,
        message: message.trim(),
        timestamp: new Date()
    };
    chat.lastMessageId = newMessage._id;

    await chat.save();

    // Populate sender info for response
    const populatedMessage = await Message.findById(newMessage._id)
        .populate('sender', 'username fullName profileImageUrl')
        .populate('replyTo', 'message sender')
        .lean();

    // Emit real-time event to chat participants
    safeEmitToChat(chatId, 'new_message', {
        chatId,
        message: populatedMessage
    });

    return res.status(201).json(
        new ApiResponse(201, populatedMessage, 'Message sent successfully')
    );
});

// Mark messages as read
export const markMessagesRead = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId } = req.params;
    const { messageIds } = req.body; // Optional: mark specific messages as read

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    if (messageIds && Array.isArray(messageIds)) {
        // Mark specific messages as read
        await Message.updateMany(
            {
                _id: { $in: messageIds },
                chatId,
                readBy: { $ne: currentUserId }
            },
            {
                $addToSet: { readBy: currentUserId }
            }
        );
    } else {
        // Mark all unread messages in the chat as read
        await Message.updateMany(
            {
                chatId,
                readBy: { $ne: currentUserId }
            },
            {
                $addToSet: { readBy: currentUserId }
            }
        );
    }

    // Emit real-time event for messages read
    safeEmitToChat(chatId, 'messages_read', {
        chatId,
        readBy: {
            _id: currentUserId,
            username: req.user.username,
            fullName: req.user.fullName
        }
    });

    return res.status(200).json(
        new ApiResponse(200, {}, 'Messages marked as read')
    );
});

// Delete a message
export const deleteMessage = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId, messageId } = req.params;

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    // Find the message
    const message = await Message.findOne({
        _id: messageId,
        chatId
    });

    if (!message) {
        throw new ApiError(404, 'Message not found');
    }

    // Only message sender or chat admin can delete
    if (message.sender.toString() !== currentUserId.toString() &&
        !chat.admins?.includes(currentUserId)) {
        throw new ApiError(403, 'Not authorized to delete this message');
    }

    // Soft delete the message
    message.deletedAt = new Date();
    message.originalMessage = message.message; // Store original for potential restoration
    message.message = '[Message deleted]';
    message.isDeleted = true;

    await message.save();

    // Emit real-time event for message deletion
    safeEmitToChat(chatId, 'message_deleted', {
        chatId,
        messageId,
        deletedBy: {
            _id: currentUserId,
            username: req.user.username,
            fullName: req.user.fullName
        }
    });

    return res.status(200).json(
        new ApiResponse(200, {}, 'Message deleted successfully')
    );
});

// Restore a deleted message (admin or sender only)
export const restoreMessage = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId, messageId } = req.params;

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    // Find the deleted message
    const message = await Message.findOne({
        _id: messageId,
        chatId,
        isDeleted: true
    });

    if (!message) {
        throw new ApiError(404, 'Deleted message not found');
    }

    // Only message sender or chat admin can restore
    if (message.sender.toString() !== currentUserId.toString() &&
        !chat.admins?.includes(currentUserId)) {
        throw new ApiError(403, 'Not authorized to restore this message');
    }

    // Check if restoration is within time limit (24 hours)
    const timeLimit = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    if (Date.now() - message.deletedAt.getTime() > timeLimit) {
        throw new ApiError(400, 'Message restoration time limit exceeded (24 hours)');
    }

    // Restore the message
    message.isDeleted = false;
    message.deletedAt = null;
    message.message = message.originalMessage || message.message;
    message.originalMessage = null;

    await message.save();

    // Populate sender info for response
    const populatedMessage = await Message.findById(message._id)
        .populate('sender', 'username fullName profileImageUrl')
        .populate('replyTo', 'message sender')
        .lean();

    // Emit real-time event for message restoration
    safeEmitToChat(chatId, 'message_restored', {
        chatId,
        messageId,
        restoredMessage: populatedMessage,
        restoredBy: {
            _id: currentUserId,
            username: req.user.username,
            fullName: req.user.fullName
        }
    });

    return res.status(200).json(
        new ApiResponse(200, populatedMessage, 'Message restored successfully')
    );
});

// Start typing indicator
export const startTyping = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId } = req.params;

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    // Emit typing event to chat participants
    safeEmitToChat(chatId, 'user_typing', {
        userId: currentUserId,
        username: req.user.username,
        fullName: req.user.fullName,
        chatId
    });

    return res.status(200).json(
        new ApiResponse(200, {}, 'Typing indicator started')
    );
});

// Stop typing indicator
export const stopTyping = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId } = req.params;

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    // Emit stop typing event to chat participants
    safeEmitToChat(chatId, 'user_stopped_typing', {
        userId: currentUserId,
        chatId
    });

    return res.status(200).json(
        new ApiResponse(200, {}, 'Typing indicator stopped')
    );
});

// Get online status of users
export const getOnlineStatus = asyncHandler(async (req, res) => {
    const { userIds } = req.query;

    if (!userIds || !Array.isArray(userIds)) {
        throw new ApiError(400, 'User IDs array is required');
    }

    const onlineStatus = {};
    userIds.forEach(userId => {
        onlineStatus[userId] = socketManager.isReady() ? socketManager.isUserOnline(userId) : false;
    });

    return res.status(200).json(
        new ApiResponse(200, { onlineStatus }, 'Online status fetched successfully')
    );
});

// Search messages in a chat
export const searchMessages = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId } = req.params;
    const { query, page = 1, limit = 20 } = req.query;

    if (!query || query.trim().length === 0) {
        throw new ApiError(400, 'Search query is required');
    }

    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 20;
    const skip = (pageNum - 1) * pageLimit;

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    // Search messages using Message model
    const [searchResults, totalResults] = await Promise.all([
        Message.find({
            chatId,
            message: { $regex: query, $options: 'i' },
            isDeleted: { $ne: true }
        })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(pageLimit)
            .populate('sender', 'username fullName profileImageUrl')
            .populate('replyTo', 'message sender')
            .lean(),
        Message.countDocuments({
            chatId,
            message: { $regex: query, $options: 'i' },
            isDeleted: { $ne: true }
        })
    ]);

    return res.status(200).json(
        new ApiResponse(200, {
            messages: searchResults,
            query,
            totalResults,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalResults / pageLimit),
                hasNextPage: pageNum < Math.ceil(totalResults / pageLimit),
                hasPrevPage: pageNum > 1
            }
        }, 'Search completed successfully')
    );
}); 