import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.models.js';
import { redisPubSub, redisPublisher } from './redis.config.js';
import { 
    ChatPubSub, 
    NotificationPubSub, 
    LiveFeaturesPubSub,
    pubSubManager,
    CHANNELS
} from '../utlis/pubsub.utils.js';

class SocketManager {
    constructor() {
        this.io = null;
        this.connectedUsers = new Map(); // userId -> socketId
        this.userSockets = new Map(); // socketId -> userId
        this.chatRooms = new Map(); // chatId -> Set of socketIds
        this.setupPubSubListeners();
    }

    /**
     * Setup Redis PubSub listeners for real-time features
     */
    setupPubSubListeners() {
        // Chat messages
        pubSubManager.on('message', ({ channel, data }) => {
            if (channel.startsWith('fn:chat:')) {
                this.handleChatMessage(data);
            } else if (channel.includes(':notifications')) {
                this.handleNotification(data);
            } else if (channel.startsWith('fn:live:')) {
                this.handleLiveFeature(data);
            }
        });

        // Pattern-based messages for user-specific events
        pubSubManager.on('pmessage', ({ pattern, channel, data }) => {
            if (pattern.includes('fn:user:*')) {
                this.handleUserSpecificEvent(channel, data);
            }
        });
    }

    /**
     * Handle incoming chat messages from Redis
     */
    handleChatMessage(data) {
        if (!this.io || !data.chatId) return;
        
        // Broadcast to all users in the chat room
        this.io.to(`chat:${data.chatId}`).emit('new_message', {
            id: data.message?.id,
            chatId: data.chatId,
            senderId: data.senderId,
            message: data.message?.message || data.message,
            timestamp: data.timestamp,
            type: data.type || 'message'
        });
        
        console.log(`📨 Chat message broadcasted to room: chat:${data.chatId}`);
    }

    /**
     * Handle real-time notifications
     */
    handleNotification(data) {
        if (!this.io || !data.userId) return;
        
        const socketId = this.connectedUsers.get(data.userId);
        if (socketId) {
            this.io.to(socketId).emit('notification', {
                type: data.notification?.type || data.type,
                message: data.notification?.message || data.message,
                data: data.notification || data,
                timestamp: data.timestamp
            });
            
            console.log(`🔔 Notification sent to user: ${data.userId}`);
        }
    }

    /**
     * Handle live features (typing, online status, etc.)
     */
    handleLiveFeature(data) {
        if (!this.io) return;
        
        switch (data.type) {
            case 'typing':
                this.io.to(`chat:${data.chatId}`).emit('typing_indicator', {
                    userId: data.userId,
                    isTyping: data.isTyping,
                    chatId: data.chatId
                });
                break;
                
            case 'online_status':
                this.io.emit('user_online_status', {
                    userId: data.userId,
                    isOnline: data.isOnline,
                    timestamp: data.timestamp
                });
                break;
                
            case 'call_event':
                this.io.to(`call:${data.callId}`).emit('call_event', data.event);
                break;
        }
    }

    /**
     * Handle user-specific events from Redis patterns
     */
    handleUserSpecificEvent(channel, data) {
        const userIdMatch = channel.match(/fn:user:([^:]+)/);
        if (!userIdMatch) return;
        
        const userId = userIdMatch[1];
        const socketId = this.connectedUsers.get(userId);
        
        if (socketId) {
            if (channel.includes(':notifications')) {
                this.io.to(socketId).emit('notification', data);
            } else if (channel.includes(':activity')) {
                this.io.to(socketId).emit('user_activity', data);
            } else if (channel.includes(':messages')) {
                this.io.to(socketId).emit('private_message', data);
            }
        }
    }

    async initialize(server) {
        try {
            this.io = new Server(server, {
                cors: {
                    origin: process.env.FRONTEND_URL || "http://localhost:3000",
                    methods: ["GET", "POST"],
                    credentials: true
                }
            });

            // Wait for Redis connections to be ready before setting up adapter
            await Promise.all([
                this.waitForRedisReady(redisPubSub),
                this.waitForRedisReady(redisPublisher)
            ]);

            // Setup Redis adapter for multi-instance scaling
            this.io.adapter(createAdapter(redisPubSub, redisPublisher));

            // Make socket.io and onlineUsers globally available for notifications
            global.io = this.io;
            global.onlineUsers = this.connectedUsers;

            // Authentication middleware
            this.io.use(async (socket, next) => {
                try {
                    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

                    if (!token) {
                        return next(new Error('Authentication error: Token required'));
                    }

                    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
                    const user = await User.findById(decoded._id).select('-password');

                    if (!user) {
                        return next(new Error('Authentication error: User not found'));
                    }

                    socket.userId = user._id.toString();
                    socket.user = user;
                    next();
                } catch (error) {
                    next(new Error('Authentication error: Invalid token'));
                }
            });

            this.setupEventHandlers();
            console.log('Socket.IO initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Socket.IO:', error);
            this.io = null;
        }
    }

    setupEventHandlers() {
        this.io.on('connection', (socket) => {

            // Store user connection
            this.connectedUsers.set(socket.userId, socket.id);
            this.userSockets.set(socket.id, socket.userId);

            // Join user to their personal room
            socket.join(`user_${socket.userId}`);

            // Subscribe to user-specific Redis channels
            this.subscribeUserToRedisChannels(socket.userId);

            // Publish user online status
            LiveFeaturesPubSub.publishOnlineStatus(socket.userId, true);

            // Handle joining chat rooms
            socket.on('join_chat', (chatId) => {
                socket.join(`chat:${chatId}`);
                
                // Subscribe to Redis channel for this chat
                ChatPubSub.subscribeToChat(chatId, (message) => {
                    console.log(`📨 Redis message received for chat ${chatId}`);
                });
                
                console.log(`User ${socket.userId} joined chat ${chatId}`);
            });

            // Handle leaving chat rooms
            socket.on('leave_chat', (chatId) => {
                socket.leave(`chat:${chatId}`);
            });

            // Handle typing events with Redis broadcasting
            socket.on('typing_start', (data) => {
                const { chatId } = data;
                
                // Publish typing status to Redis for cross-process sync
                ChatPubSub.publishTyping(chatId, socket.userId, true);
                
                // Also emit locally for immediate feedback
                socket.to(`chat:${chatId}`).emit('user_typing', {
                    userId: socket.userId,
                    username: socket.user.username,
                    fullName: socket.user.fullName,
                    chatId
                });
            });

            socket.on('typing_stop', (data) => {
                const { chatId } = data;
                socket.to(`chat:${chatId}`).emit('user_stopped_typing', {
                    userId: socket.userId,
                    chatId
                });
            });

            // Handle message events
            socket.on('send_message', (data) => {
                const { chatId, message, messageType = 'text', replyTo } = data;

                // Emit to all users in the chat (except sender)
                socket.to(`chat:${chatId}`).emit('new_message', {
                    chatId,
                    message: {
                        sender: {
                            _id: socket.userId,
                            username: socket.user.username,
                            fullName: socket.user.fullName,
                            profileImageUrl: socket.user.profileImageUrl
                        },
                        message,
                        messageType,
                        replyTo,
                        timestamp: new Date()
                    }
                });
            });

            // Handle message read events
            socket.on('mark_read', (data) => {
                const { chatId, messageIds } = data;

                // Emit to message senders that their messages were read
                socket.to(`chat:${chatId}`).emit('messages_read', {
                    chatId,
                    readBy: {
                        _id: socket.userId,
                        username: socket.user.username,
                        fullName: socket.user.fullName
                    },
                    messageIds
                });
            });

            // Handle message deletion
            socket.on('delete_message', (data) => {
                const { chatId, messageId } = data;

                socket.to(`chat:${chatId}`).emit('message_deleted', {
                    chatId,
                    messageId,
                    deletedBy: {
                        _id: socket.userId,
                        username: socket.user.username,
                        fullName: socket.user.fullName
                    }
                });
            });

            // Handle message restoration
            socket.on('restore_message', (data) => {
                const { chatId, messageId, restoredMessage } = data;

                socket.to(`chat:${chatId}`).emit('message_restored', {
                    chatId,
                    messageId,
                    restoredMessage,
                    restoredBy: {
                        _id: socket.userId,
                        username: socket.user.username,
                        fullName: socket.user.fullName
                    }
                });
            });

            // Handle online status
            socket.on('set_online_status', (status) => {
                socket.to(`user_${socket.userId}`).emit('user_status_changed', {
                    userId: socket.userId,
                    status,
                    timestamp: new Date()
                });
            });

            // ===== CALL SIGNALING EVENTS =====
            
            // Handle call initiation
            socket.on('call_initiate', (data) => {
                const { receiverId, chatId, callType, callId } = data;
                console.log(`User ${socket.userId} initiating ${callType} call to ${receiverId} in chat ${chatId}`);
                
                // Emit to receiver
                this.emitToUser(receiverId, 'incoming_call', {
                    callId,
                    chatId,
                    callType,
                    caller: {
                        _id: socket.userId,
                        username: socket.user.username,
                        fullName: socket.user.fullName,
                        profileImageUrl: socket.user.profileImageUrl
                    },
                    timestamp: new Date()
                });
            });

            // Handle call acceptance
            socket.on('call_accept', (data) => {
                const { callId, callerId } = data;
                console.log(`User ${socket.userId} accepted call ${callId} from ${callerId}`);
                
                // Emit to caller that call was accepted
                this.emitToUser(callerId, 'call_accepted', {
                    callId,
                    acceptedBy: {
                        _id: socket.userId,
                        username: socket.user.username,
                        fullName: socket.user.fullName,
                        profileImageUrl: socket.user.profileImageUrl
                    },
                    timestamp: new Date()
                });
            });

            // Handle call decline
            socket.on('call_decline', (data) => {
                const { callId, callerId } = data;
                console.log(`User ${socket.userId} declined call ${callId} from ${callerId}`);
                
                // Emit to caller that call was declined
                this.emitToUser(callerId, 'call_declined', {
                    callId,
                    declinedBy: {
                        _id: socket.userId,
                        username: socket.user.username,
                        fullName: socket.user.fullName,
                        profileImageUrl: socket.user.profileImageUrl
                    },
                    timestamp: new Date()
                });
            });

            // Handle call end
            socket.on('call_end', (data) => {
                const { callId, participants, endReason = 'normal' } = data;
                console.log(`User ${socket.userId} ended call ${callId}, reason: ${endReason}`);
                
                // Emit to all participants except the one who ended it
                participants
                    .filter(participantId => participantId !== socket.userId)
                    .forEach(participantId => {
                        this.emitToUser(participantId, 'call_ended', {
                            callId,
                            endedBy: {
                                _id: socket.userId,
                                username: socket.user.username,
                                fullName: socket.user.fullName,
                                profileImageUrl: socket.user.profileImageUrl
                            },
                            endReason,
                            timestamp: new Date()
                        });
                    });
            });

            // ===== WEBRTC SIGNALING EVENTS =====
            
            // Handle WebRTC offer
            socket.on('webrtc_offer', (data) => {
                const { callId, receiverId, offer } = data;
                console.log(`User ${socket.userId} sending WebRTC offer for call ${callId} to ${receiverId}`);
                
                this.emitToUser(receiverId, 'webrtc_offer', {
                    callId,
                    offer,
                    senderId: socket.userId
                });
            });

            // Handle WebRTC answer
            socket.on('webrtc_answer', (data) => {
                const { callId, callerId, answer } = data;
                console.log(`User ${socket.userId} sending WebRTC answer for call ${callId} to ${callerId}`);
                
                this.emitToUser(callerId, 'webrtc_answer', {
                    callId,
                    answer,
                    senderId: socket.userId
                });
            });

            // Handle ICE candidates
            socket.on('webrtc_ice_candidate', (data) => {
                const { callId, receiverId, candidate } = data;
                console.log(`User ${socket.userId} sending ICE candidate for call ${callId} to ${receiverId}`);
                
                this.emitToUser(receiverId, 'webrtc_ice_candidate', {
                    callId,
                    candidate,
                    senderId: socket.userId
                });
            });

            // Handle call status updates (connecting, quality, etc.)
            socket.on('call_status_update', (data) => {
                const { callId, participants, status, metadata } = data;
                console.log(`User ${socket.userId} updating call ${callId} status to ${status}`);
                
                // Emit to all other participants
                participants
                    .filter(participantId => participantId !== socket.userId)
                    .forEach(participantId => {
                        this.emitToUser(participantId, 'call_status_update', {
                            callId,
                            status,
                            metadata,
                            updatedBy: socket.userId,
                            timestamp: new Date()
                        });
                    });
            });

            // Handle disconnect
            socket.on('disconnect', () => {
                this.connectedUsers.delete(socket.userId);
                this.userSockets.delete(socket.id);

                // Unsubscribe from user-specific Redis channels
                this.unsubscribeUserFromRedisChannels(socket.userId);

                // Publish user offline status
                LiveFeaturesPubSub.publishOnlineStatus(socket.userId, false);

                // Emit offline status to relevant users
                this.emitUserOffline(socket.userId);
            });
        });
    }

    // Utility methods
    emitToUser(userId, event, data) {
        if (!this.io) {
            console.warn('Socket.IO not initialized, skipping emitToUser');
            return;
        }
        const socketId = this.connectedUsers.get(userId);
        if (socketId) {
            this.io.to(socketId).emit(event, data);
        }
    }

    emitToChat(chatId, event, data) {
        if (this.io) {
            this.io.to(`chat:${chatId}`).emit(event, data);
        } else {
            console.warn(`Socket.IO not initialized, skipping emitToChat for chat ${chatId}, event: ${event}`);
        }
    }

    emitToUsers(userIds, event, data) {
        if (!this.io) {
            console.warn('Socket.IO not initialized, skipping emitToUsers');
            return;
        }
        userIds.forEach(userId => {
            this.emitToUser(userId, event, data);
        });
    }

    emitUserOffline(userId) {
        if (!this.io) {
            console.warn('Socket.IO not initialized, skipping emitUserOffline');
            return;
        }
        // Emit to all users who might be interested in this user's status
        this.io.emit('user_offline', {
            userId,
            timestamp: new Date()
        });
    }

    isUserOnline(userId) {
        return this.connectedUsers.has(userId);
    }

    getOnlineUsers() {
        return Array.from(this.connectedUsers.keys());
    }

    isReady() {
        return this.io !== null;
    }

    /**
     * Wait for a Redis instance to be ready
     * @param {Redis} redisInstance - Redis instance to wait for
     * @returns {Promise} - Promise that resolves when Redis is ready
     */
    async waitForRedisReady(redisInstance) {
        if (redisInstance.status === 'ready') {
            return Promise.resolve();
        }
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Redis connection timeout'));
            }, 10000); // 10 second timeout

            redisInstance.once('ready', () => {
                clearTimeout(timeout);
                resolve();
            });

            redisInstance.once('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    /**
     * Subscribe user to their Redis channels
     * @param {string} userId - User ID to subscribe
     */
    async subscribeUserToRedisChannels(userId) {
        try {
            // Subscribe to user-specific notifications
            await NotificationPubSub.subscribeToNotifications(userId);
            
            // Subscribe to user activity updates
            const activityChannel = `fn:user:${userId}:activity`;
            await pubSubManager.subscribe(activityChannel);
            
            // Subscribe to pattern-based channels for this user
            const userPattern = `fn:user:${userId}:*`;
            await pubSubManager.psubscribe(userPattern);
            
            console.log(`🔔 User ${userId} subscribed to Redis channels`);
        } catch (error) {
            console.error(`Failed to subscribe user ${userId} to Redis channels:`, error);
        }
    }

    /**
     * Unsubscribe user from their Redis channels
     * @param {string} userId - User ID to unsubscribe
     */
    async unsubscribeUserFromRedisChannels(userId) {
        try {
            // Unsubscribe from user-specific channels
            const notificationChannel = `fn:user:${userId}:notifications`;
            const activityChannel = `fn:user:${userId}:activity`;
            const userPattern = `fn:user:${userId}:*`;
            
            await pubSubManager.unsubscribe(notificationChannel);
            await pubSubManager.unsubscribe(activityChannel);
            await pubSubManager.punsubscribe(userPattern);
            
            console.log(`🔕 User ${userId} unsubscribed from Redis channels`);
        } catch (error) {
            console.error(`Failed to unsubscribe user ${userId} from Redis channels:`, error);
        }
    }
}

export default new SocketManager(); 