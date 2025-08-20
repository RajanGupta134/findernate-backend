import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.models.js';

class SocketManager {
    constructor() {
        this.io = null;
        this.connectedUsers = new Map(); // userId -> socketId
        this.userSockets = new Map(); // socketId -> userId
    }

    initialize(server) {
        try {
            this.io = new Server(server, {
                cors: {
                    origin: process.env.FRONTEND_URL || "http://localhost:3000",
                    methods: ["GET", "POST"],
                    credentials: true
                }
            });

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

            // Handle joining chat rooms
            socket.on('join_chat', (chatId) => {
                socket.join(`chat_${chatId}`);
                console.log(`User ${socket.userId} joined chat ${chatId}`);
            });

            // Handle leaving chat rooms
            socket.on('leave_chat', (chatId) => {
                socket.leave(`chat_${chatId}`);
            });

            // Handle typing events
            socket.on('typing_start', (data) => {
                const { chatId } = data;
                socket.to(`chat_${chatId}`).emit('user_typing', {
                    userId: socket.userId,
                    username: socket.user.username,
                    fullName: socket.user.fullName,
                    chatId
                });
            });

            socket.on('typing_stop', (data) => {
                const { chatId } = data;
                socket.to(`chat_${chatId}`).emit('user_stopped_typing', {
                    userId: socket.userId,
                    chatId
                });
            });

            // Handle message events
            socket.on('send_message', (data) => {
                const { chatId, message, messageType = 'text', replyTo } = data;

                // Emit to all users in the chat (except sender)
                socket.to(`chat_${chatId}`).emit('new_message', {
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
                socket.to(`chat_${chatId}`).emit('messages_read', {
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

                socket.to(`chat_${chatId}`).emit('message_deleted', {
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

                socket.to(`chat_${chatId}`).emit('message_restored', {
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
            this.io.to(`chat_${chatId}`).emit(event, data);
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
}

export default new SocketManager(); 