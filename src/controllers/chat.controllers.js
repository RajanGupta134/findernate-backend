import Chat from '../models/chat.models.js';
import Message from '../models/message.models.js';
import Follower from '../models/follower.models.js';
import { ApiError } from '../utlis/ApiError.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import { uploadBufferToCloudinary } from '../utlis/cloudinary.js';
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

// Check if user follows another user
const checkFollowStatus = async (followerId, userId) => {
    const followRelation = await Follower.findOne({
        followerId,
        userId
    });

    return !!followRelation;
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
        const existingChat = await Chat.findOne({
            participants: validParticipants,
            chatType: 'direct'
        });

        if (existingChat) {
            // Before returning, make sure we're not showing deleted messages
            // Get the latest non-deleted message
            const lastMessage = await Message.findOne({
                chatId: existingChat._id,
                isDeleted: { $ne: true }
            }).sort({ timestamp: -1 });

            if (lastMessage) {
                existingChat.lastMessage = {
                    sender: lastMessage.sender,
                    message: lastMessage.message,
                    timestamp: lastMessage.timestamp
                };
                existingChat.lastMessageId = lastMessage._id;
                await existingChat.save();
            } else {
                // No non-deleted messages exist
                existingChat.lastMessage = {};
                existingChat.lastMessageId = null;
                await existingChat.save();
            }

            // Now populate and return
            const populatedChat = await Chat.findById(existingChat._id)
                .populate('participants', 'username fullName profileImageUrl')
                .populate('createdBy', 'username fullName profileImageUrl');

            // Get the stats right
            const messageCount = await Message.countDocuments({
                chatId: existingChat._id,
                isDeleted: { $ne: true }
            });

            if (!populatedChat.stats) {
                populatedChat.stats = {};
            }
            populatedChat.stats.totalMessages = messageCount;
            populatedChat.stats.totalParticipants = populatedChat.participants.length;

            return res.status(200).json(
                new ApiResponse(200, populatedChat, 'Existing chat found')
            );
        }
    }

    const chatData = {
        participants: validParticipants,
        chatType,
        createdBy: currentUserId
    };

    // For direct chats, check if recipient follows sender to determine if chat should be a request
    if (chatType === 'direct' && validParticipants.length === 2) {
        const otherUserId = validParticipants.find(id => id.toString() !== currentUserId.toString());

        // Check if the recipient follows the sender
        const recipientFollowsSender = await checkFollowStatus(otherUserId, currentUserId);

        // If recipient doesn't follow sender, mark as requested chat
        if (!recipientFollowsSender) {
            chatData.status = 'requested';
        }
    }

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
    const { page = 1, limit = 20, chatStatus = 'active' } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 20;
    const skip = (pageNum - 1) * pageLimit;

    // Filter by chat status (active or requested)
    const statusFilter = ['active', 'requested'].includes(chatStatus) ? chatStatus : 'active';

    const [chats, total] = await Promise.all([
        Chat.find({
            participants: currentUserId,
            status: statusFilter
        })
            .sort({ lastMessageAt: -1 })
            .skip(skip)
            .limit(pageLimit)
            .lean(),
        Chat.countDocuments({
            participants: currentUserId,
            status: statusFilter
        })
    ]);

    // Get all chat IDs
    const chatIds = chats.map(chat => chat._id);

    // For each chat, find the last non-deleted message
    const lastMessagesPromises = chatIds.map(chatId =>
        Message.findOne({
            chatId,
            isDeleted: { $ne: true }
        })
            .sort({ timestamp: -1 })
            .populate('sender', 'username fullName profileImageUrl')
    );

    const lastMessages = await Promise.all(lastMessagesPromises);

    // Create a map for quick lookup
    const lastMessageMap = lastMessages.reduce((acc, message, index) => {
        if (message) {
            acc[chatIds[index].toString()] = {
                message,
                lastMessage: {
                    sender: message.sender,
                    message: message.message,
                    timestamp: message.timestamp
                }
            };
        }
        return acc;
    }, {});

    // Get unread counts for all chats efficiently
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

    // Populate the chats with participants
    const populatedChatsPromise = Promise.all(chats.map(async (chat) => {
        const chatWithUsers = await Chat.populate(chat, [
            { path: 'participants', select: 'username fullName profileImageUrl' },
            { path: 'createdBy', select: 'username fullName profileImageUrl' }
        ]);

        // Update lastMessage with non-deleted message if available
        const chatId = chat._id.toString();
        if (lastMessageMap[chatId]) {
            chatWithUsers.lastMessage = lastMessageMap[chatId].lastMessage;
            chatWithUsers.lastMessageId = lastMessageMap[chatId].message._id;
        } else {
            chatWithUsers.lastMessage = {};
            chatWithUsers.lastMessageId = null;
        }

        // Add message count stats
        if (!chatWithUsers.stats) {
            chatWithUsers.stats = {};
        }
        const messageCount = await Message.countDocuments({
            chatId: chat._id,
            isDeleted: { $ne: true }
        });
        chatWithUsers.stats.totalMessages = messageCount;
        chatWithUsers.stats.totalParticipants = chatWithUsers.participants.length;

        // Add unread count
        chatWithUsers.unreadCount = unreadCountMap[chatId] || 0;

        return chatWithUsers;
    }));

    const populatedChats = await populatedChatsPromise;

    return res.status(200).json(
        new ApiResponse(200, {
            chats: populatedChats,
            chatStatus: statusFilter,
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

// Accept a chat request
export const acceptChatRequest = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId } = req.params;

    // Find the chat and verify it's a request to the current user
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId,
        status: 'requested'
    });

    if (!chat) {
        throw new ApiError(404, 'Chat request not found or already processed');
    }

    // Ensure current user is receiving the request, not sending it
    const otherUserId = chat.participants.find(p => p.toString() !== currentUserId.toString());
    if (chat.createdBy.toString() === currentUserId.toString()) {
        throw new ApiError(400, 'You cannot accept your own chat request');
    }

    // Update chat status to active
    chat.status = 'active'
    await chat.save();

    const populatedChat = await Chat.findById(chat._id)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('createdBy', 'username fullName profileImageUrl');

    // Notify the other user via socket
    safeEmitToChat(chatId, 'chat_request_accepted', {
        chatId,
        acceptedBy: {
            _id: currentUserId,
            username: req.user.username,
            fullName: req.user.fullName
        },
        chat: populatedChat
    });

    return res.status(200).json(
        new ApiResponse(200, populatedChat, 'Chat request accepted successfully')
    );
});

// Decline a chat request
export const declineChatRequest = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { chatId } = req.params;

    // Find the chat and verify it's a request to the current user
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId,
        status: 'requested'
    });

    if (!chat) {
        throw new ApiError(404, 'Chat request not found or already processed');
    }

    // Ensure current user is receiving the request, not sending it
    const otherUserId = chat.participants.find(p => p.toString() !== currentUserId.toString());
    if (chat.createdBy.toString() === currentUserId.toString()) {
        throw new ApiError(400, 'You cannot decline your own chat request');
    }

    // Option 1: Mark chat as declined
    chat.status = 'declined';
    await chat.save();

    // Option 2 (alternative): Delete the chat completely
    // await Chat.deleteOne({ _id: chatId });

    // Notify the other user via socket
    safeEmitToChat(chatId, 'chat_request_declined', {
        chatId,
        declinedBy: {
            _id: currentUserId,
            username: req.user.username,
            fullName: req.user.fullName
        }
    });

    return res.status(200).json(
        new ApiResponse(200, { chatId }, 'Chat request declined successfully')
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

    // Check if the chat is a request and not yet accepted
    if (chat.status === 'requested') {
        // If the current user is the recipient (not the creator), they can only see that there's a request
        if (chat.createdBy.toString() !== currentUserId.toString()) {
            return res.status(200).json(
                new ApiResponse(200, {
                    messages: [],
                    chatStatus: 'requested',
                    requestedBy: chat.createdBy,
                    pagination: {
                        currentPage: 1,
                        totalPages: 0,
                        totalMessages: 0,
                        hasNextPage: false,
                        hasPrevPage: false
                    }
                }, 'Chat request pending acceptance')
            );
        }
    } else if (chat.status === 'declined') {
        throw new ApiError(403, 'This chat request has been declined');
    }

    // Get messages with pagination using Message model
    const [messages, totalMessages] = await Promise.all([
        Message.find({
            chatId,
            isDeleted: { $ne: true } // Exclude deleted messages
        })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(pageLimit)
            .populate('sender', 'username fullName profileImageUrl')
            .populate('replyTo', 'message sender')
            .lean(),
        Message.countDocuments({
            chatId,
            isDeleted: { $ne: true } // Exclude deleted messages when counting
        })
    ]);

    // If this is the first page, update chat's last message if needed
    if (pageNum === 1 && messages.length > 0) {
        const latestMessage = messages[0];

        // Update chat's last message if it's out of sync
        if (!chat.lastMessageId ||
            (latestMessage._id.toString() !== chat.lastMessageId.toString())) {

            chat.lastMessage = {
                sender: latestMessage.sender._id,
                message: latestMessage.message,
                timestamp: latestMessage.timestamp
            };
            chat.lastMessageId = latestMessage._id;
            await chat.save();
        }
    }

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

    // Handle both FormData and JSON body
    const body = req.body || {};
    const message = body.message;
    const messageType = body.messageType || 'text';
    const replyTo = body.replyTo;
    const mediaFile = req.file; // File uploaded via FormData



    // For media messages, allow empty message if file is present
    if ((!message || message.trim().length === 0) && !mediaFile) {
        throw new ApiError(400, 'Message content or media file is required');
    }

    // Set default message for media files if no message provided
    const finalMessage = message && message.trim().length > 0
        ? message.trim()
        : mediaFile
            ? `📎 ${mediaFile.originalname}`
            : '';

    // Verify user is participant in the chat
    const chat = await Chat.findOne({
        _id: chatId,
        participants: currentUserId
    });

    if (!chat) {
        throw new ApiError(404, 'Chat not found or access denied');
    }

    // Check if the chat is a request and not yet accepted
    if (chat.status === 'requested') {
        // Only the recipient (non-creator) is blocked from sending messages
        if (chat.createdBy.toString() !== currentUserId.toString()) {
            throw new ApiError(403, 'You must accept the chat request before sending messages');
        }
    } else if (chat.status === 'declined') {
        throw new ApiError(403, 'This chat request has been declined');
    }

    // Create message data object
    const messageData = {
        chatId,
        sender: currentUserId,
        message: finalMessage,
        messageType, // ✅ Use the actual messageType from request
        timestamp: new Date(),
        readBy: [currentUserId],
        replyTo: replyTo || null
    };

    // ✅ Handle file upload if present
    if (mediaFile) {
        try {
            // Upload file to Cloudinary
            const uploadResult = await uploadBufferToCloudinary(mediaFile.buffer, 'chat_media');

            // Add media fields to message data
            messageData.mediaUrl = uploadResult.secure_url;
            messageData.fileName = mediaFile.originalname;
            messageData.fileSize = mediaFile.size;

            // For videos, try to get duration from Cloudinary response
            if (uploadResult.duration) {
                messageData.duration = uploadResult.duration;
            }

            // Auto-detect message type if not provided
            if (messageType === 'text') {
                if (mediaFile.mimetype.startsWith('image/')) {
                    messageData.messageType = 'image';
                } else if (mediaFile.mimetype.startsWith('video/')) {
                    messageData.messageType = 'video';
                } else if (mediaFile.mimetype.startsWith('audio/')) {
                    messageData.messageType = 'audio';
                } else {
                    messageData.messageType = 'file';
                }
            }
        } catch (uploadError) {
            throw new ApiError(500, `Failed to upload media file: ${uploadError.message}`);
        }
    }

    // Create new message using Message model
    const newMessage = await Message.create(messageData);

    // Update chat's last message info
    chat.lastMessageAt = new Date();
    chat.lastMessage = {
        sender: currentUserId,
        message: finalMessage,
        timestamp: new Date()
    };
    chat.lastMessageId = newMessage._id;

    await chat.save();

    // ✅ Ensure populatedMessage has ALL fields
    const populatedMessage = await Message.findById(newMessage._id)
        .populate('sender', 'username fullName profileImageUrl')
        .populate('replyTo', 'message sender');
    // Don't use .lean() if it strips fields

    // ✅ Emit complete message
    safeEmitToChat(chatId, 'new_message', {
        chatId,
        message: populatedMessage // This MUST include mediaUrl, fileName, etc.
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

    // If this was the last message in chat, update the lastMessage
    if (chat.lastMessageId && chat.lastMessageId.toString() === messageId) {
        // Find the next most recent non-deleted message
        const lastMessage = await Message.findOne({
            chatId,
            isDeleted: { $ne: true }
        }).sort({ timestamp: -1 });

        if (lastMessage) {
            // Update chat with new last message
            chat.lastMessage = {
                sender: lastMessage.sender,
                message: lastMessage.message,
                timestamp: lastMessage.timestamp
            };
            chat.lastMessageId = lastMessage._id;
        } else {
            // No messages left, clear last message
            chat.lastMessage = {};
            chat.lastMessageId = null;
        }
        await chat.save();
    }

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
    let userIds = req.query.userIds;

    // Handle different formats of userIds in query
    if (typeof userIds === 'string') {
        // If it's a comma-separated string
        if (userIds.includes(',')) {
            userIds = userIds.split(',');
        }
        // If it's a single value
        else {
            userIds = [userIds];
        }
    }

    if (!userIds || !Array.isArray(userIds)) {
        throw new ApiError(400, "User IDs array is required");
    }

    // Rest of the function remains the same
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