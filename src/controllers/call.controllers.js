import Call from '../models/call.models.js';
import Chat from '../models/chat.models.js';
import Message from '../models/message.models.js';
import { User } from '../models/user.models.js';
import { ApiError } from '../utlis/ApiError.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import socketManager from '../config/socket.js';
import mongoose from 'mongoose';
import { sendNotification } from '../config/firebase-admin.config.js';

// Constants for call management
const CALL_TIMEOUT_MINUTES = 2; // Calls timeout after 2 minutes if not answered
const CLEANUP_INTERVAL_MINUTES = 5; // Run cleanup every 5 minutes

// Helper function to safely emit socket events
const safeEmitToUser = (userId, event, data) => {
    if (socketManager.isReady()) {
        socketManager.emitToUser(userId, event, data);
    } else {
        console.warn(`Socket not ready, skipping ${event} for user ${userId}`);
    }
};

// Helper function to validate ObjectId
const isValidObjectId = (id) => {
    return mongoose.Types.ObjectId.isValid(id);
};

// Helper function to cleanup stale calls
const cleanupStaleCalls = async () => {
    try {
        const timeoutDate = new Date(Date.now() - (CALL_TIMEOUT_MINUTES * 60 * 1000));

        // Find calls that are stuck in initiated/ringing state beyond timeout
        const staleCalls = await Call.find({
            status: { $in: ['initiated', 'ringing'] },
            initiatedAt: { $lt: timeoutDate }
        });

        for (const call of staleCalls) {
            console.log(`🧹 Cleaning up stale call: ${call._id}`);

            // Update call status
            call.status = 'missed';
            call.endedAt = new Date();
            call.endReason = 'timeout';
            await call.save();

            // Notify participants
            const participantIds = call.participants.map(p => p.toString());
            participantIds.forEach(participantId => {
                safeEmitToUser(participantId, 'call_timeout', {
                    callId: call._id,
                    timestamp: new Date()
                });
            });
        }

        if (staleCalls.length > 0) {
            console.log(`🧹 Cleaned up ${staleCalls.length} stale calls`);
        }
    } catch (error) {
        console.error('❌ Error during call cleanup:', error);
    }
};

// Start cleanup interval
setInterval(cleanupStaleCalls, CLEANUP_INTERVAL_MINUTES * 60 * 1000);

// Helper function to check if user has active call
const hasActiveCall = async (userId, session = null) => {
    const query = {
        participants: userId,
        status: { $in: ['initiated', 'ringing', 'connecting', 'active'] }
    };

    const baseQuery = session ?
        Call.findOne(query).session(session) :
        Call.findOne(query);

    return baseQuery.populate('participants', 'username fullName profileImageUrl')
                   .populate('initiator', 'username fullName profileImageUrl');
};

// Helper function to validate chat permissions
const validateChatPermissions = async (chatId, currentUserId, receiverId) => {
    const chat = await Chat.findById(chatId);
    if (!chat) {
        throw new ApiError(404, 'Chat not found');
    }

    const participantIds = chat.participants.map(p => p.toString());
    if (!participantIds.includes(currentUserId.toString()) || !participantIds.includes(receiverId)) {
        throw new ApiError(403, 'You can only call users in your chats');
    }

    return chat;
};

// Initiate a call
export const initiateCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { receiverId, chatId, callType } = req.body;

    console.log('🚀 Call initiation request:', { currentUserId, receiverId, chatId, callType });

    // Validate input
    if (!receiverId || !chatId || !callType) {
        console.error('❌ Missing required fields:', { receiverId: !!receiverId, chatId: !!chatId, callType: !!callType });
        throw new ApiError(400, 'Receiver ID, chat ID, and call type are required');
    }

    if (!['voice', 'video'].includes(callType)) {
        console.error('❌ Invalid call type:', callType);
        throw new ApiError(400, 'Call type must be voice or video');
    }

    try {
        // Validate chat permissions and fetch receiver in parallel (optimize)
        console.log('🔍 Validating chat and fetching receiver (parallel)...');
        const [chat, receiver] = await Promise.all([
            validateChatPermissions(chatId, currentUserId, receiverId),
            User.findById(receiverId).lean() // Use lean() for faster query
        ]);

        if (!receiver) {
            console.error('❌ Receiver not found:', receiverId);
            throw new ApiError(404, 'Receiver not found');
        }

        // Check if user is trying to call themselves
        if (currentUserId.toString() === receiverId) {
            console.error('❌ User trying to call themselves');
            throw new ApiError(400, 'Cannot call yourself');
        }

        // Use transaction to prevent race conditions
        console.log('💾 Creating call record with transaction...');
        const session = await mongoose.startSession();
        let newCall;

        try {
            await session.withTransaction(async () => {
                // Check if there's already an active call for either user within transaction
                const currentUserActiveCall = await hasActiveCall(currentUserId, session);
                const receiverActiveCall = await hasActiveCall(receiverId, session);

                if (currentUserActiveCall || receiverActiveCall) {
                    const existingCall = currentUserActiveCall || receiverActiveCall;
                    const busyUser = currentUserActiveCall ? 'You are' : 'The recipient is';
                    console.warn('⚠️ User already in call:', { existingCallId: existingCall._id, busyUser });

                    // Create enhanced error with call details
                    const error = new ApiError(409, `${busyUser} already in a call`);
                    error.data = {
                        existingCallId: existingCall._id,
                        existingCall: {
                            _id: existingCall._id,
                            status: existingCall.status,
                            callType: existingCall.callType,
                            initiatedAt: existingCall.initiatedAt,
                            participants: existingCall.participants
                        }
                    };
                    throw error;
                }

                // Create new call record within transaction
                newCall = new Call({
                    participants: [currentUserId, receiverId],
                    initiator: currentUserId,
                    chatId,
                    callType,
                    status: 'initiated'
                });

                await newCall.save({ session });
                console.log('✅ Call record created successfully:', { callId: newCall._id });
            });
        } finally {
            await session.endSession();
        }

        // Populate the call with user details (optimized with lean)
        console.log('📋 Populating call details...');
        const populatedCall = await Call.findById(newCall._id)
            .populate('participants', 'username fullName profileImageUrl')
            .populate('initiator', 'username fullName profileImageUrl')
            .lean();

        // Create Stream.io call and generate tokens for both participants (BEFORE notifications)
        let streamData = null;
        try {
            const streamService = (await import('../config/stream.config.js')).default;

            if (streamService.isConfigured()) {
                console.log('📞 Creating Stream.io call...');

                // Register users in Stream.io
                await streamService.upsertUsers([
                    {
                        id: currentUserId.toString(),
                        name: req.user.fullName || req.user.username || 'User',
                        image: req.user.profileImageUrl || undefined
                    },
                    {
                        id: receiver._id.toString(),
                        name: receiver.fullName || receiver.username || 'User',
                        image: receiver.profileImageUrl || undefined
                    }
                ]);

                // Create Stream.io call - use 'audio_room' for voice, 'default' for video
                const streamCallType = callType === 'voice' ? 'audio_room' : 'default';
                const videoEnabled = callType === 'video';
                const callResponse = await streamService.createCall(
                    streamCallType,
                    newCall._id.toString(),
                    currentUserId.toString(),
                    [currentUserId.toString(), receiver._id.toString()],
                    videoEnabled
                );

                // Generate tokens for both users
                const callerToken = streamService.generateUserToken(currentUserId.toString());
                const receiverToken = streamService.generateUserToken(receiver._id.toString());

                streamData = {
                    apiKey: streamService.getApiKey(),
                    callId: newCall._id.toString(),
                    streamCallType,
                    callerToken: callerToken.token,
                    receiverToken: receiverToken.token,
                    expiresAt: callerToken.expiresAt
                };

                console.log('✅ Stream.io call created and tokens generated');
            } else {
                console.warn('⚠️ Stream.io not configured - calls will not work properly');
            }
        } catch (streamError) {
            console.error('❌ Stream.io call creation error:', streamError);
            // Don't fail the entire call if Stream.io fails - log and continue
        }

        // Send FCM push notification to receiver (fire-and-forget, non-blocking)
        console.log('🔔 Sending FCM notification (async)...');
        let fcmSent = false;

        if (receiver.fcmToken) {
            // Don't await - fire and forget to avoid blocking the response
            (async () => {
                try {
                    const notification = {
                        title: `Incoming ${callType} call`,
                        body: `${req.user.fullName || req.user.username} is calling you...`
                    };

                    const data = {
                        type: 'incoming_call',
                        callId: newCall._id.toString(),
                        callerId: currentUserId.toString(),
                        callerName: req.user.fullName || req.user.username,
                        callerImage: req.user.profileImageUrl || '',
                        chatId: chatId.toString(),
                        callType: callType
                    };

                    console.log('📤 Sending FCM to token:', receiver.fcmToken.substring(0, 20) + '...');
                    const fcmResult = await sendNotification(receiver.fcmToken, notification, data);

                    if (fcmResult.success) {
                        console.log('✅ FCM notification sent successfully:', fcmResult.messageId);

                        // If token is invalid, remove it from user
                        if (fcmResult.invalidToken) {
                            console.log('🗑️ Removing invalid FCM token from user');
                            await User.findByIdAndUpdate(receiverId, {
                                fcmToken: null,
                                fcmTokenUpdatedAt: null
                            }).catch(err => console.error('Error removing FCM token:', err));
                        }
                    } else {
                        console.warn('⚠️ FCM notification failed:', fcmResult.error);
                    }
                } catch (fcmError) {
                    console.error('❌ FCM notification error:', fcmError.message);
                }
            })();
        } else {
            console.log('⚠️ No FCM token found for receiver, will use socket fallback');
        }

        // Emit call initiation via socket (as backup or if FCM failed)
        console.log('📡 Emitting socket events...');
        if (socketManager.isReady()) {
            const callData = {
                callId: newCall._id,
                chatId,
                callType,
                caller: {
                    _id: currentUserId,
                    username: req.user.username,
                    fullName: req.user.fullName,
                    profileImageUrl: req.user.profileImageUrl
                },
                stream: streamData ? {
                    apiKey: streamData.apiKey,
                    token: streamData.receiverToken,
                    callId: streamData.callId,
                    streamCallType: streamData.streamCallType
                } : null,
                timestamp: new Date()
            };

            console.log('📡 Emitting incoming_call to receiver:', receiverId, 'for call:', newCall._id);
            console.log('   Receiver ID type:', typeof receiverId);
            console.log('   Call data:', JSON.stringify(callData).substring(0, 300));

            // Ensure receiverId is string
            const receiverIdStr = receiverId.toString();
            socketManager.emitToUser(receiverIdStr, 'incoming_call', callData);
            console.log('✅ incoming_call event emitted successfully');
        } else {
            console.error('❌ Socket manager not ready - cannot emit incoming_call event');

            // If FCM also failed and socket is not ready, this is a problem
            if (!fcmSent) {
                console.error('❌ CRITICAL: Both FCM and Socket failed - receiver will not get notification');
            }
        }

        // Create a call message in the chat (non-blocking, fire-and-forget)
        (async () => {
            try {
                console.log('💬 Creating call message...');
                const callMessage = new Message({
                    chatId,
                    sender: currentUserId,
                    message: `${callType} call ${callType === 'voice' ? '📞' : '📹'}`,
                    messageType: 'text'
                });
                await callMessage.save();
                console.log('✅ Call message created');
            } catch (messageError) {
                console.warn('⚠️ Failed to create call message (non-critical):', messageError.message);
            }
        })();

        console.log('🎉 Call initiated successfully:', { callId: newCall._id });
        res.status(201).json(
            new ApiResponse(201, {
                ...populatedCall,
                stream: streamData
            }, 'Call initiated successfully')
        );

    } catch (error) {
        console.error('❌ Error in initiateCall:', {
            message: error.message,
            stack: error.stack,
            data: error.data
        });

        // Re-throw the error to be handled by asyncHandler
        throw error;
    }
});

// Accept a call
export const acceptCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;

    console.log('📞 Call acceptance request:', { callId, currentUserId });

    // Validate call ID format
    if (!isValidObjectId(callId)) {
        console.error('❌ Invalid call ID format:', callId);
        throw new ApiError(400, 'Invalid call ID format');
    }

    // Update call status with transaction - fetch and update in same transaction
    const session = await mongoose.startSession();
    let updatedCall;

    try {
        await session.withTransaction(async () => {
            // Fetch call within transaction for atomic operation
            const call = await Call.findById(callId).session(session);

            if (!call) {
                console.error('❌ Call not found:', callId);
                throw new ApiError(404, 'Call not found');
            }

            console.log('📋 Call found:', {
                callId: call._id,
                status: call.status,
                initiatedAt: call.initiatedAt,
                endedAt: call.endedAt
            });

            // Check if user is a participant
            const participantIds = call.participants.map(p => p.toString());
            if (!participantIds.includes(currentUserId.toString())) {
                console.error('❌ User not a participant:', { currentUserId, participants: participantIds });
                throw new ApiError(403, 'You are not a participant in this call');
            }

            // Check if call is in the right status
            if (!['initiated', 'ringing', 'connecting'].includes(call.status)) {
                console.error('❌ Invalid call status for acceptance:', {
                    currentStatus: call.status,
                    allowedStatuses: ['initiated', 'ringing', 'connecting']
                });

                // Provide more detailed error message
                const statusMessages = {
                    'ended': 'The call has already ended',
                    'declined': 'The call was declined',
                    'missed': 'The call was missed',
                    'active': 'The call is already active'
                };
                const errorMessage = statusMessages[call.status] || `Call cannot be accepted in current status: ${call.status}`;
                throw new ApiError(400, errorMessage);
            }

            // Idempotent behavior: If already connecting, just return the current call data
            if (call.status === 'connecting' && call.startedAt) {
                console.warn('⚠️ Call already in connecting state (idempotent request)');
                updatedCall = call;
                return; // Exit transaction early, proceed to response
            }

            // Update call status
            call.status = 'connecting';
            call.startedAt = new Date();
            await call.save({ session });

            updatedCall = call;
            console.log('✅ Call status updated to connecting');
        });
    } catch (error) {
        console.error('❌ Transaction failed:', error);
        throw error;
    } finally {
        await session.endSession();
    }

    // Fetch populated call data after transaction
    const populatedCall = await Call.findById(callId)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');

    // Emit call acceptance to all participants
    const participantIds = populatedCall.participants.map(p => p._id.toString());
    const otherParticipants = participantIds.filter(id => id !== currentUserId.toString());

    console.log('📡 Emitting call acceptance to participants:', otherParticipants);
    otherParticipants.forEach(participantId => {
        safeEmitToUser(participantId, 'call_accepted', {
            callId,
            acceptedBy: {
                _id: currentUserId,
                username: req.user.username,
                fullName: req.user.fullName,
                profileImageUrl: req.user.profileImageUrl
            },
            timestamp: new Date()
        });
    });

    console.log('🎉 Call accepted successfully:', { callId });
    res.status(200).json(
        new ApiResponse(200, populatedCall, 'Call accepted successfully')
    );
});

// Decline a call
export const declineCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;

    console.log('🚫 Call decline request:', { callId, currentUserId });

    // Validate call ID format
    if (!isValidObjectId(callId)) {
        console.error('❌ Invalid call ID format:', callId);
        throw new ApiError(400, 'Invalid call ID format');
    }

    // Update call status with transaction - fetch and update in same transaction
    const session = await mongoose.startSession();
    let updatedCall;

    try {
        await session.withTransaction(async () => {
            // Fetch call within transaction for atomic operation
            const call = await Call.findById(callId).session(session);

            if (!call) {
                console.error('❌ Call not found:', callId);
                throw new ApiError(404, 'Call not found');
            }

            console.log('📋 Call found:', {
                callId: call._id,
                status: call.status,
                initiator: call.initiator
            });

            // Check if user is a participant
            const participantIds = call.participants.map(p => p.toString());
            if (!participantIds.includes(currentUserId.toString())) {
                console.error('❌ User not a participant:', { currentUserId, participants: participantIds });
                throw new ApiError(403, 'You are not a participant in this call');
            }

            // Check if call can be declined
            if (!['initiated', 'ringing'].includes(call.status)) {
                console.error('❌ Invalid call status for decline:', {
                    currentStatus: call.status,
                    allowedStatuses: ['initiated', 'ringing']
                });
                throw new ApiError(400, `Call cannot be declined in current status: ${call.status}`);
            }

            // Update call status
            call.status = 'declined';
            call.endedAt = new Date();
            call.endReason = 'declined';

            await call.save({ session });
            updatedCall = call;
            console.log('✅ Call status updated to declined');
        });
    } catch (error) {
        console.error('❌ Transaction failed:', error);
        throw error;
    } finally {
        await session.endSession();
    }

    // Fetch populated call data after transaction
    const populatedCall = await Call.findById(callId)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');

    // Emit call decline to other participants
    const participantIds = populatedCall.participants.map(p => p._id.toString());
    const otherParticipants = participantIds.filter(id => id !== currentUserId.toString());

    console.log('📡 Emitting call decline to participants:', otherParticipants);
    otherParticipants.forEach(participantId => {
        safeEmitToUser(participantId, 'call_declined', {
            callId,
            declinedBy: {
                _id: currentUserId,
                username: req.user.username,
                fullName: req.user.fullName,
                profileImageUrl: req.user.profileImageUrl
            },
            timestamp: new Date()
        });
    });

    console.log('🎉 Call declined successfully:', { callId });
    res.status(200).json(
        new ApiResponse(200, populatedCall, 'Call declined successfully')
    );
});

// End a call
export const endCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;
    const { endReason = 'normal' } = req.body;

    console.log('📵 Call end request:', { callId, currentUserId, endReason });

    // Validate call ID format
    if (!isValidObjectId(callId)) {
        console.error('❌ Invalid call ID format:', callId);
        throw new ApiError(400, 'Invalid call ID format');
    }

    // Validate endReason
    const validReasons = ['normal', 'declined', 'missed', 'failed', 'network_error', 'cancelled', 'timeout'];
    if (!validReasons.includes(endReason)) {
        console.error('❌ Invalid end reason:', endReason);
        throw new ApiError(400, `Invalid end reason. Must be one of: ${validReasons.join(', ')}`);
    }

    // Update call status with transaction - fetch and update in same transaction
    const session = await mongoose.startSession();
    let updatedCall;

    try {
        await session.withTransaction(async () => {
            // Fetch call within transaction for atomic operation
            const call = await Call.findById(callId).session(session);

            if (!call) {
                console.error('❌ Call not found:', callId);
                throw new ApiError(404, 'Call not found');
            }

            console.log('📋 Call found for ending:', {
                callId: call._id,
                status: call.status,
                hasStarted: !!call.startedAt,
                initiatedAt: call.initiatedAt,
                ageInSeconds: Math.floor((Date.now() - call.initiatedAt) / 1000),
                requestedBy: currentUserId,
                requestedReason: endReason
            });

            // Check if user is a participant
            const participantIds = call.participants.map(p => p.toString());
            if (!participantIds.includes(currentUserId.toString())) {
                console.error('❌ User not a participant:', { currentUserId, participants: participantIds });
                throw new ApiError(403, 'You are not a participant in this call');
            }

            // Check if call is already in a terminal state (idempotent behavior)
            if (call.status === 'ended' || call.status === 'declined' || call.status === 'missed') {
                console.warn('⚠️  Call already finished (idempotent request):', {
                    currentStatus: call.status,
                    endedAt: call.endedAt,
                    requestedEndReason: endReason
                });
                // Don't throw error - return existing call data (idempotent behavior)
                updatedCall = call;
                return; // Exit transaction early, proceed to response
            }

            // Update call status
            call.status = 'ended';
            call.endedAt = new Date();
            call.endReason = endReason;
            call.endedBy = currentUserId; // Track who ended the call

            // If call was never started (e.g., ended during ringing), set startedAt to now for duration calculation
            if (!call.startedAt) {
                call.startedAt = call.endedAt;
                console.log('⏱️ Call ended before being started, setting startedAt = endedAt');
            }

            await call.save({ session });
            updatedCall = call;
            console.log('✅ Call status updated to ended');
        });
    } catch (error) {
        console.error('❌ Transaction failed:', error);
        throw error;
    } finally {
        await session.endSession();
    }

    // Fetch populated call data after transaction
    const populatedCall = await Call.findById(callId)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');

    // Emit call end to other participants
    const participantIds = populatedCall.participants.map(p => p._id.toString());
    const otherParticipants = participantIds.filter(id => id !== currentUserId.toString());

    console.log('📡 Emitting call end to participants:', otherParticipants);
    otherParticipants.forEach(participantId => {
        safeEmitToUser(participantId, 'call_ended', {
            callId,
            endedBy: {
                _id: currentUserId,
                username: req.user.username,
                fullName: req.user.fullName,
                profileImageUrl: req.user.profileImageUrl
            },
            endReason,
            duration: populatedCall.duration,
            timestamp: new Date()
        });
    });

    console.log('🎉 Call ended successfully:', {
        callId,
        duration: populatedCall.duration,
        formattedDuration: populatedCall.formattedDuration
    });

    res.status(200).json(
        new ApiResponse(200, populatedCall, 'Call ended successfully')
    );
});

// Update call status (for Agora connection state tracking only)
export const updateCallStatus = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;
    const { status, metadata } = req.body;

    console.log('📊 Call status update request:', { callId, currentUserId, status, metadata });

    // Validate call ID format
    if (!isValidObjectId(callId)) {
        console.error('❌ Invalid call ID format:', callId);
        throw new ApiError(400, 'Invalid call ID format');
    }

    // Validate status - ONLY allow connection state updates, NOT terminal states
    // Terminal states (ended/declined/missed/failed) must use dedicated endpoints
    const validStatuses = ['connecting', 'active'];
    if (!validStatuses.includes(status)) {
        console.error('❌ Invalid status for updateCallStatus:', {
            providedStatus: status,
            allowedStatuses: validStatuses,
            note: 'Use /decline or /end endpoints for terminal states'
        });
        throw new ApiError(400, `Invalid call status. Use /accept, /decline, or /end endpoints instead. Allowed statuses: ${validStatuses.join(', ')}`);
    }

    // Use transaction for atomic update
    const session = await mongoose.startSession();
    let updatedCall;

    try {
        await session.withTransaction(async () => {
            // Find the call within transaction
            const call = await Call.findById(callId).session(session);

            if (!call) {
                console.error('❌ Call not found:', callId);
                throw new ApiError(404, 'Call not found');
            }

            console.log('📋 Call found:', {
                callId: call._id,
                currentStatus: call.status,
                newStatus: status
            });

            // Check if user is a participant
            const participantIds = call.participants.map(p => p.toString());
            if (!participantIds.includes(currentUserId.toString())) {
                console.error('❌ User not a participant:', { currentUserId, participants: participantIds });
                throw new ApiError(403, 'You are not a participant in this call');
            }

            // Check if call is still active (not ended/declined/missed/failed)
            if (['ended', 'declined', 'missed', 'failed'].includes(call.status)) {
                console.error('❌ Cannot update status of finished call:', {
                    currentStatus: call.status,
                    attemptedStatus: status
                });
                throw new ApiError(400, `Call has already finished with status: ${call.status}. Cannot update to ${status}.`);
            }

            // Update call status
            call.status = status;
            if (metadata) {
                call.metadata = { ...call.metadata, ...metadata };
                console.log('📝 Updated call metadata:', metadata);
            }

            // Set startedAt when call becomes active
            if (status === 'active' && !call.startedAt) {
                call.startedAt = new Date();
                console.log('⏱️ Setting call startedAt timestamp');
            }

            await call.save({ session });
            updatedCall = call;
            console.log('✅ Call status updated successfully');
        });
    } catch (error) {
        console.error('❌ Transaction failed:', error);
        throw error;
    } finally {
        await session.endSession();
    }

    // Fetch populated call
    const populatedCall = await Call.findById(callId)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');

    // Emit status update to other participants
    const participantIds = populatedCall.participants.map(p => p._id.toString());
    const otherParticipants = participantIds.filter(id => id !== currentUserId.toString());

    console.log('📡 Emitting status update to participants:', otherParticipants);
    otherParticipants.forEach(participantId => {
        safeEmitToUser(participantId, 'call_status_update', {
            callId,
            status,
            metadata,
            updatedBy: currentUserId,
            timestamp: new Date()
        });
    });

    console.log('🎉 Call status updated:', { callId, status });
    res.status(200).json(
        new ApiResponse(200, populatedCall, 'Call status updated successfully')
    );
});

// Get call history for user
export const getCallHistory = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const calls = await Call.getCallHistory(currentUserId, parseInt(limit), parseInt(page));

    // Calculate pagination info
    const totalCalls = await Call.countDocuments({
        participants: currentUserId,
        status: { $in: ['ended', 'declined', 'missed'] }
    });

    const pagination = {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCalls / parseInt(limit)),
        totalCalls,
        hasNextPage: parseInt(page) < Math.ceil(totalCalls / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1
    };

    res.status(200).json(
        new ApiResponse(200, { calls, pagination }, 'Call history fetched successfully')
    );
});

// Get active call for user
export const getActiveCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;

    const activeCall = await Call.getActiveCall(currentUserId);

    res.status(200).json(
        new ApiResponse(200, activeCall, 'Active call fetched successfully')
    );
});

// Get call statistics
export const getCallStats = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { days = 30 } = req.query;

    const stats = await Call.getCallStats(currentUserId, parseInt(days));

    res.status(200).json(
        new ApiResponse(200, stats[0] || {}, 'Call statistics fetched successfully')
    );
});

// Force end all active calls for current user (cleanup endpoint)
export const forceEndActiveCalls = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;

    console.log('🧹 Force ending active calls for user:', currentUserId);

    // Find all active calls for this user
    const activeCalls = await Call.find({
        participants: currentUserId,
        status: { $in: ['initiated', 'ringing', 'connecting', 'active'] }
    });

    if (activeCalls.length === 0) {
        return res.status(200).json(
            new ApiResponse(200, { endedCount: 0 }, 'No active calls to end')
        );
    }

    console.log(`🧹 Found ${activeCalls.length} active call(s) to end`);

    const endedCalls = [];

    for (const call of activeCalls) {
        try {
            // Calculate duration if call was active
            if (call.startedAt && !call.endedAt) {
                call.endedAt = new Date();
                call.duration = Math.floor((call.endedAt - call.startedAt) / 1000);
            } else if (!call.endedAt) {
                call.endedAt = new Date();
            }

            // Update status
            call.status = call.startedAt ? 'ended' : 'missed';
            call.endReason = 'force_cleanup';
            call.endedBy = currentUserId;

            await call.save();

            // Notify other participants
            const otherParticipants = call.participants
                .filter(p => p.toString() !== currentUserId.toString());

            otherParticipants.forEach(participantId => {
                safeEmitToUser(participantId, 'call_ended', {
                    callId: call._id,
                    endedBy: currentUserId,
                    reason: 'force_cleanup',
                    timestamp: new Date()
                });
            });

            endedCalls.push({
                callId: call._id,
                status: call.status,
                duration: call.duration
            });

            console.log(`✅ Force ended call: ${call._id}`);
        } catch (error) {
            console.error(`❌ Error ending call ${call._id}:`, error);
        }
    }

    res.status(200).json(
        new ApiResponse(200, {
            endedCount: endedCalls.length,
            endedCalls
        }, `Successfully force-ended ${endedCalls.length} call(s)`)
    );
});

