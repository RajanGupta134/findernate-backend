import express from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import {
    createChat,
    getUserChats,
    getChatMessages,
    addMessage,
    markMessagesRead,
    deleteMessage,
    restoreMessage,
    startTyping,
    stopTyping,
    getOnlineStatus,
    searchMessages,
    acceptChatRequest,
    declineChatRequest
} from '../controllers/chat.controllers.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

// Create a new chat (1-on-1 or group)
router.post('/', createChat);

// Get all chats for a user
router.get('/', getUserChats);

// Chat request management
router.patch('/:chatId/accept', acceptChatRequest);
router.patch('/:chatId/decline', declineChatRequest);

// Get messages for a chat
router.get('/:chatId/messages', getChatMessages);

// Add a message to a chat
router.post('/:chatId/messages', addMessage);

// Mark messages as read
router.patch('/:chatId/read', markMessagesRead);

// Delete a message
router.delete('/:chatId/messages/:messageId', deleteMessage);

// Restore a deleted message
router.patch('/:chatId/messages/:messageId/restore', restoreMessage);

// Typing indicators
router.post('/:chatId/typing/start', startTyping);
router.post('/:chatId/typing/stop', stopTyping);

// Online status
router.get('/users/online-status', getOnlineStatus);

// Search messages in a chat
router.get('/:chatId/search', searchMessages);

export default router; 