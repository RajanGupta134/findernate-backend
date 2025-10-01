import Call from '../models/call.models.js';
import Chat from '../models/chat.models.js';
import Message from '../models/message.models.js';
import { User } from '../models/user.models.js';
import { ApiError } from '../utlis/ApiError.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import socketManager from '../config/socket.js';
import agoraService from '../config/agora.config.js';
import mongoose from 'mongoose';

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

            // Mark Agora channel as ended if exists
            if (call.agoraChannel?.channelName) {
                call.agoraChannel.endedAt = new Date();
                console.log(`📡 Marked Agora channel ${call.agoraChannel.channelName} as ended`);
            }

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

// Helper function to safely execute Agora operations
const safeAgoraOperation = async (operation, fallbackMessage) => {
    try {
        return await operation();
    } catch (error) {
        console.warn(`Agora operation failed: ${error.message}. ${fallbackMessage}`);
        return null;
    }
};

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
        // Validate chat permissions
        console.log('🔍 Validating chat permissions...');
        await validateChatPermissions(chatId, currentUserId, receiverId);

        // Check if receiver exists and is online
        console.log('👤 Checking receiver exists...');
        const receiver = await User.findById(receiverId);
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

        // Create Agora channel for the call with better error handling
        console.log('📡 Creating Agora channel...');
        const agoraChannel = await safeAgoraOperation(async () => {
            const channelName = `call_${newCall._id.toString()}`;

            // Update call with Agora channel data
            newCall.agoraChannel = {
                channelName: channelName,
                appId: agoraService.getAppId(),
                createdAt: new Date()
            };

            // Generate auth tokens for both participants
            const initiatorUserId = currentUserId.toString();
            const receiverUserId = receiverId.toString();

            const initiatorTokens = agoraService.generateTokens(channelName, initiatorUserId, 'publisher');
            const receiverTokens = agoraService.generateTokens(channelName, receiverUserId, 'publisher');

            // Store tokens in the call
            await newCall.addAgoraToken(
                currentUserId,
                initiatorTokens.rtc.token,
                initiatorTokens.rtm.token,
                'publisher'
            );
            await newCall.addAgoraToken(
                receiverId,
                receiverTokens.rtc.token,
                receiverTokens.rtm.token,
                'publisher'
            );

            console.log(`🎉 Created Agora channel ${channelName} for call ${newCall._id}`);
            return {
                channelName,
                appId: agoraService.getAppId()
            };
        }, 'Continuing with WebRTC fallback');

        // Populate the call with user details
        console.log('📋 Populating call details...');
        const populatedCall = await Call.findById(newCall._id)
            .populate('participants', 'username fullName profileImageUrl')
            .populate('initiator', 'username fullName profileImageUrl');

        // Emit call initiation via socket
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
                timestamp: new Date()
            };

            // Include Agora channel data if available
            if (newCall.agoraChannel && newCall.agoraChannel.channelName) {
                const receiverToken = newCall.getAgoraTokenForUser(receiverId);
                callData.agoraChannel = {
                    channelName: newCall.agoraChannel.channelName,
                    appId: newCall.agoraChannel.appId,
                    rtcToken: receiverToken ? receiverToken.rtcToken : null,
                    rtmToken: receiverToken ? receiverToken.rtmToken : null,
                    uid: receiverToken ? receiverToken.uid : 0
                };
            }

            socketManager.emitToUser(receiverId, 'incoming_call', callData);
        }

        // Create a call message in the chat (non-critical, don't let this fail the call)
        try {
            console.log('💬 Creating call message...');
            const callMessage = new Message({
                chatId,
                sender: currentUserId,
                message: `${callType} call ${callType === 'voice' ? '📞' : '📹'}`,
                messageType: 'text'
            });
            await callMessage.save();
        } catch (messageError) {
            console.warn('⚠️ Failed to create call message (non-critical):', messageError.message);
        }

        console.log('🎉 Call initiated successfully:', { callId: newCall._id });
        res.status(201).json(
            new ApiResponse(201, populatedCall, 'Call initiated successfully')
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
                hasAgoraChannel: !!call.agoraChannel?.channelName
            });

            // Check if user is a participant
            const participantIds = call.participants.map(p => p.toString());
            if (!participantIds.includes(currentUserId.toString())) {
                console.error('❌ User not a participant:', { currentUserId, participants: participantIds });
                throw new ApiError(403, 'You are not a participant in this call');
            }

            // Check if call is in the right status
            if (!['initiated', 'ringing'].includes(call.status)) {
                console.error('❌ Invalid call status for acceptance:', {
                    currentStatus: call.status,
                    allowedStatuses: ['initiated', 'ringing']
                });
                throw new ApiError(400, `Call cannot be accepted in current status: ${call.status}`);
            }

            // Validate Agora channel exists
            if (!call.agoraChannel || !call.agoraChannel.channelName) {
                console.error('❌ Call missing Agora channel:', {
                    callId,
                    hasAgoraChannel: !!call.agoraChannel,
                    hasChannelName: !!call.agoraChannel?.channelName
                });
                throw new ApiError(400, 'Call does not have a valid Agora channel configured');
            }

            // Check if user has valid Agora tokens
            const userToken = call.getAgoraTokenForUser(currentUserId);
            if (!userToken || !userToken.rtcToken) {
                console.warn('⚠️ User missing Agora tokens, generating new ones...');

                // Generate tokens for the user
                try {
                    const tokens = agoraService.generateTokens(
                        call.agoraChannel.channelName,
                        currentUserId.toString(),
                        'publisher'
                    );
                    await call.addAgoraToken(
                        currentUserId,
                        tokens.rtc.token,
                        tokens.rtm.token,
                        'publisher'
                    );
                    console.log('✅ Generated new Agora tokens for user');
                } catch (tokenError) {
                    console.error('❌ Failed to generate Agora tokens:', tokenError);
                    throw new ApiError(500, 'Failed to generate authentication tokens for the call');
                }
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

    // Prepare response data with Agora channel info
    const responseData = {
        ...populatedCall.toObject(),
        channelName: populatedCall.agoraChannel?.channelName || null,
        agoraChannel: populatedCall.agoraChannel ? {
            channelName: populatedCall.agoraChannel.channelName,
            appId: populatedCall.agoraChannel.appId,
            createdAt: populatedCall.agoraChannel.createdAt
        } : null
    };

    // Include user's auth token
    const userToken = populatedCall.getAgoraTokenForUser(currentUserId);
    if (userToken) {
        responseData.rtcToken = userToken.rtcToken;
        responseData.rtmToken = userToken.rtmToken;
        responseData.uid = userToken.uid;
        responseData.userRole = userToken.role;
        console.log('✅ Including user tokens in response');
    } else {
        console.warn('⚠️ No user token found in response');
    }

    console.log('🎉 Call accepted successfully:', { callId });
    res.status(200).json(
        new ApiResponse(200, responseData, 'Call accepted successfully')
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

            // Mark Agora channel as ended if exists
            if (call.agoraChannel?.channelName) {
                call.agoraChannel.endedAt = new Date();
                console.log(`📡 Marked Agora channel ${call.agoraChannel.channelName} as ended`);
            }

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

            console.log('📋 Call found:', {
                callId: call._id,
                status: call.status,
                hasStarted: !!call.startedAt
            });

            // Check if user is a participant
            const participantIds = call.participants.map(p => p.toString());
            if (!participantIds.includes(currentUserId.toString())) {
                console.error('❌ User not a participant:', { currentUserId, participants: participantIds });
                throw new ApiError(403, 'You are not a participant in this call');
            }

            // Check if call can be ended
            if (call.status === 'ended' || call.status === 'declined' || call.status === 'missed') {
                console.error('❌ Call already finished:', {
                    currentStatus: call.status,
                    endedAt: call.endedAt
                });
                throw new ApiError(400, `Call has already ended with status: ${call.status}`);
            }

            // Update call status
            call.status = 'ended';
            call.endedAt = new Date();
            call.endReason = endReason;

            // If call was never started (e.g., ended during ringing), set startedAt to now for duration calculation
            if (!call.startedAt) {
                call.startedAt = call.endedAt;
                console.log('⏱️ Call ended before being started, setting startedAt = endedAt');
            }

            // Mark Agora channel as ended if exists (within transaction)
            if (call.agoraChannel?.channelName) {
                call.agoraChannel.endedAt = new Date();
                console.log(`📡 Marking Agora channel ${call.agoraChannel.channelName} as ended`);
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

// Update call status (for WebRTC connection states)
export const updateCallStatus = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;
    const { status, metadata } = req.body;

    // Validate call ID format
    if (!isValidObjectId(callId)) {
        throw new ApiError(400, 'Invalid call ID format');
    }

    // Find the call
    const call = await Call.findById(callId);
    if (!call) {
        throw new ApiError(404, 'Call not found');
    }

    // Check if user is a participant
    const participantIds = call.participants.map(p => p.toString());
    if (!participantIds.includes(currentUserId.toString())) {
        throw new ApiError(403, 'You are not a participant in this call');
    }

    // Validate status
    const validStatuses = ['connecting', 'active', 'ended', 'failed'];
    if (!validStatuses.includes(status)) {
        throw new ApiError(400, 'Invalid call status');
    }

    // Update call
    call.status = status;
    if (metadata) {
        call.metadata = { ...call.metadata, ...metadata };
    }

    // Set startedAt when call becomes active
    if (status === 'active' && !call.startedAt) {
        call.startedAt = new Date();
    }

    // Set endedAt when call ends
    if (status === 'ended' && !call.endedAt) {
        call.endedAt = new Date();
    }

    await call.save();

    // Emit status update to other participants
    const otherParticipants = participantIds.filter(id => id !== currentUserId.toString());
    otherParticipants.forEach(participantId => {
        safeEmitToUser(participantId, 'call_status_update', {
            callId,
            status,
            metadata,
            updatedBy: currentUserId,
            timestamp: new Date()
        });
    });

    res.status(200).json(
        new ApiResponse(200, call, 'Call status updated successfully')
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

// Generate or refresh Agora auth token for a call participant
export const getAgoraAuthToken = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;
    const { role = 'publisher' } = req.body;

    console.log('🔑 Agora token request:', { callId, currentUserId, role });

    // Validate call ID format
    if (!isValidObjectId(callId)) {
        console.error('❌ Invalid call ID format:', { callId, isValid: false });
        throw new ApiError(400, `Invalid call ID format: ${callId}. Must be a valid 24-character MongoDB ObjectId.`);
    }

    // Find the call
    console.log('🔍 Looking for call:', callId);
    const call = await Call.findById(callId);
    if (!call) {
        console.error('❌ Call not found:', callId);
        throw new ApiError(404, 'Call not found');
    }

    console.log('✅ Call found:', { callId: call._id, status: call.status, agoraChannel: !!call.agoraChannel });

    // Check if user is a participant
    const participantIds = call.participants.map(p => p.toString());
    if (!participantIds.includes(currentUserId.toString())) {
        console.error('❌ User not a participant:', { currentUserId, participants: participantIds });
        throw new ApiError(403, 'You are not a participant in this call');
    }

    // Check if call has Agora channel
    if (!call.agoraChannel || !call.agoraChannel.channelName) {
        console.error('❌ Call does not have Agora channel configured:', { agoraChannel: call.agoraChannel });
        throw new ApiError(400, 'Call does not have Agora channel configured');
    }

    // Check if call is still active
    if (!['initiated', 'ringing', 'connecting', 'active'].includes(call.status)) {
        console.error('❌ Call is not active:', { status: call.status });
        throw new ApiError(400, 'Call is not active');
    }

    try {
        // Generate new auth tokens
        console.log('🔑 Generating Agora auth tokens...');
        const userId = currentUserId.toString();
        const tokens = agoraService.generateTokens(call.agoraChannel.channelName, userId, role);

        // Store/update token in call
        await call.addAgoraToken(currentUserId, tokens.rtc.token, tokens.rtm.token, role);

        console.log('✅ Agora tokens generated successfully');
        res.status(200).json({
            success: true,
            data: {
                rtcToken: tokens.rtc.token,
                rtmToken: tokens.rtm.token,
                channelName: call.agoraChannel.channelName,
                appId: agoraService.getAppId(),
                uid: 0,
                userId: userId
            }
        });
    } catch (error) {
        console.error('❌ Error generating Agora tokens:', {
            message: error.message,
            stack: error.stack,
            callId,
            channelName: call.agoraChannel?.channelName
        });
        throw new ApiError(500, 'Failed to generate Agora auth tokens');
    }
});

// Get Agora channel details for a call
export const getAgoraChannelDetails = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;

    // Validate call ID format
    if (!isValidObjectId(callId)) {
        throw new ApiError(400, 'Invalid call ID format');
    }

    // Find the call
    const call = await Call.findById(callId)
        .populate('participants', 'username fullName profileImageUrl');

    if (!call) {
        throw new ApiError(404, 'Call not found');
    }

    // Check if user is a participant
    const participantIds = call.participants.map(p => p._id.toString());
    if (!participantIds.includes(currentUserId.toString())) {
        throw new ApiError(403, 'You are not a participant in this call');
    }

    // Check if call has Agora channel
    if (!call.agoraChannel || !call.agoraChannel.channelName) {
        throw new ApiError(400, 'Call does not have Agora channel configured');
    }

    try {
        // Get user's token
        const userToken = call.getAgoraTokenForUser(currentUserId);

        res.status(200).json(
            new ApiResponse(200, {
                call: {
                    id: call._id,
                    status: call.status,
                    callType: call.callType,
                    participants: call.participants
                },
                agoraChannel: {
                    channelName: call.agoraChannel.channelName,
                    appId: call.agoraChannel.appId,
                    rtcToken: userToken ? userToken.rtcToken : null,
                    rtmToken: userToken ? userToken.rtmToken : null,
                    uid: userToken ? userToken.uid : 0,
                    userRole: userToken ? userToken.role : null
                }
            }, 'Agora channel details fetched successfully')
        );
    } catch (error) {
        console.error('❌ Error fetching Agora channel details:', error);
        throw new ApiError(500, 'Failed to fetch Agora channel details');
    }
});