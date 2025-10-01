import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.models.js';
import { redisPubSub, redisPublisher, redisClient } from './redis.config.js';

class SocketManager {
    constructor() {
        this.io = null;
        this.connectedUsers = new Map(); // userId -> socketId
        this.userSockets = new Map(); // socketId -> userId
        this.chatRooms = new Map(); // chatId -> Set of socketIds
    }

    async initialize(server) {
        try {
            const allowedOrigins = [
                "https://p0k804os4c4scowcg488800c.194.164.151.15.sslip.io",
                "https://findernate.com",
                "https://www.findernate.com",
                "https://apis.findernate.com",
                "http://localhost:3000",
                "http://localhost:3001",
                "http://localhost:4000",
                "https://localhost:4000",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
                "http://127.0.0.1:4000"
            ];

            this.io = new Server(server, {
                cors: {
                    origin: function (origin, callback) {
                        if (!origin || allowedOrigins.includes(origin)) {
                            callback(null, true);
                        } else {
                            callback(new Error("Not allowed by CORS"));
                        }
                    },
                    methods: ["GET", "POST"],
                    credentials: true
                },
                // Add these options for better compatibility with nginx/reverse proxies
                transports: ['websocket', 'polling'],
                allowEIO3: true,
                pingTimeout: 60000,
                pingInterval: 25000,
                connectTimeout: 45000,
                path: '/socket.io/'
            });

            // Wait for Redis connections to be ready before setting up adapter
            await Promise.all([
                this.waitForRedisReady(redisPubSub),
                this.waitForRedisReady(redisPublisher)
            ]);

            // Setup Redis adapter for multi-instance scaling
            this.io.adapter(createAdapter(redisPubSub, redisPublisher));

            // Make socket.io globally available for notifications
            global.io = this.io;

            // Add process identification for debugging
            const PROCESS_ID = process.env.INSTANCE_ID || process.env.pm_id || `process-${process.pid}`;
            console.log(`🔧 Socket.IO initialized on process: ${PROCESS_ID}`);

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
            // Store user connection locally AND in Redis for cross-process access
            this.connectedUsers.set(socket.userId, socket.id);
            this.userSockets.set(socket.id, socket.userId);

            // Track user's chat rooms for cleanup on disconnect
            socket.chatRooms = new Set();

            // Store in Redis with 24-hour expiry (auto-cleanup for stale connections)
            const PROCESS_ID = process.env.INSTANCE_ID || process.env.pm_id || `process-${process.pid}`;
            redisClient.hset('fn:online_users', socket.userId, JSON.stringify({
                socketId: socket.id,
                processId: PROCESS_ID,
                connectedAt: new Date().toISOString()
            })).catch(err => console.error('Redis user tracking error:', err));

            // Set TTL on online users hash key (24 hours)
            redisClient.expire('fn:online_users', 86400).catch(err =>
                console.error('Redis TTL error:', err)
            );

            // Join user to their personal room
            socket.join(`user_${socket.userId}`);

            // Note: No Redis pattern subscriptions needed - Socket.IO rooms handle routing

            // Handle joining chat rooms
            socket.on('join_chat', (chatId) => {
                socket.join(`chat:${chatId}`);
                socket.chatRooms.add(chatId); // Track for cleanup
                console.log(`User ${socket.userId} joined chat ${chatId}`);
            });

            // Handle leaving chat rooms
            socket.on('leave_chat', (chatId) => {
                socket.leave(`chat:${chatId}`);
                socket.chatRooms.delete(chatId); // Remove from tracking
                console.log(`User ${socket.userId} left chat ${chatId}`);
            });

            // Handle typing events
            socket.on('typing_start', (data) => {
                const { chatId } = data;

                // Emit to chat room - Socket.IO adapter syncs across processes
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

            // 🚀 NEW: Handle request for initial unread counts (alternative to HTTP polling)
            socket.on('request_unread_counts', async () => {
                try {
                    const notificationCache = (await import('../utlis/notificationCache.utils.js')).default;
                    const counts = await notificationCache.getUnreadCounts(socket.userId);
                    
                    socket.emit('unread_counts_updated', {
                        unreadNotifications: counts.unreadNotifications,
                        unreadMessages: counts.unreadMessages,
                        timestamp: new Date().toISOString(),
                        fromCache: counts.fromCache
                    });
                } catch (error) {
                    console.error('Error fetching unread counts via socket:', error);
                    socket.emit('unread_counts_error', {
                        error: 'Failed to fetch unread counts',
                        timestamp: new Date().toISOString()
                    });
                }
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
                // Clean up local tracking
                this.connectedUsers.delete(socket.userId);
                this.userSockets.delete(socket.id);

                // Clean up all chat rooms the user was in
                if (socket.chatRooms && socket.chatRooms.size > 0) {
                    socket.chatRooms.forEach(chatId => {
                        socket.leave(`chat:${chatId}`);
                    });
                    console.log(`User ${socket.userId} cleaned up from ${socket.chatRooms.size} chat rooms`);
                    socket.chatRooms.clear();
                }

                // Remove from Redis cross-process tracking
                redisClient.hdel('fn:online_users', socket.userId)
                    .catch(err => console.error('Redis user removal error:', err));

                // Emit offline status to relevant users
                this.emitUserOffline(socket.userId);

                console.log(`User ${socket.userId} disconnected and cleaned up`);
            });
        });
    }

    // Utility methods

    // Check if user is online across all PM2 processes
    async isUserOnline(userId) {
        try {
            const userInfo = await redisClient.hget('fn:online_users', userId);
            return userInfo !== null;
        } catch (error) {
            console.error('Error checking user online status:', error);
            return false;
        }
    }

    // Get all online users across processes
    async getAllOnlineUsers() {
        try {
            const onlineUsers = await redisClient.hgetall('fn:online_users');
            return Object.keys(onlineUsers).map(userId => ({
                userId,
                ...JSON.parse(onlineUsers[userId])
            }));
        } catch (error) {
            console.error('Error getting online users:', error);
            return [];
        }
    }

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

    // Check if user is online in current process only (legacy method)
    isUserOnlineLocal(userId) {
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

    // Removed: Pattern subscriptions no longer needed
    // Socket.IO rooms and Redis adapter handle all routing automatically
}

export default new SocketManager(); 