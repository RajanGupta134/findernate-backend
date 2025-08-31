import Call from '../models/call.models.js';
import Chat from '../models/chat.models.js';
import Message from '../models/message.models.js';
import { User } from '../models/user.models.js';
import { ApiError } from '../utlis/ApiError.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import socketManager from '../config/socket.js';
import hmsService from '../config/hms.config.js';
import mongoose from 'mongoose';

// Helper function to safely emit socket events
const safeEmitToUser = (userId, event, data) => {
    if (socketManager.isReady()) {
        socketManager.emitToUser(userId, event, data);
    } else {
        console.warn(`Socket not ready, skipping ${event} for user ${userId}`);
    }
};

// Initiate a call
export const initiateCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { receiverId, chatId, callType } = req.body;

    // Validate input
    if (!receiverId || !chatId || !callType) {
        throw new ApiError(400, 'Receiver ID, chat ID, and call type are required');
    }

    if (!['voice', 'video'].includes(callType)) {
        throw new ApiError(400, 'Call type must be voice or video');
    }

    // Validate that the chat exists and user is a participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
        throw new ApiError(404, 'Chat not found');
    }

    const participantIds = chat.participants.map(p => p.toString());
    if (!participantIds.includes(currentUserId.toString()) || !participantIds.includes(receiverId)) {
        throw new ApiError(403, 'You can only call users in your chats');
    }

    // Check if receiver exists and is online
    const receiver = await User.findById(receiverId);
    if (!receiver) {
        throw new ApiError(404, 'Receiver not found');
    }

    // Check if user is trying to call themselves
    if (currentUserId.toString() === receiverId) {
        throw new ApiError(400, 'Cannot call yourself');
    }

    // Check if there's already an active call for either user
    const existingCall = await Call.findOne({
        $or: [
            { participants: currentUserId, status: { $in: ['initiated', 'ringing', 'connecting', 'active'] } },
            { participants: receiverId, status: { $in: ['initiated', 'ringing', 'connecting', 'active'] } }
        ]
    });

    if (existingCall) {
        throw new ApiError(409, 'User is already in a call');
    }

    // Create new call record
    const newCall = new Call({
        participants: [currentUserId, receiverId],
        initiator: currentUserId,
        chatId,
        callType,
        status: 'initiated'
    });

    await newCall.save();

    // Create 100ms room for the call
    try {
        const hmsRoom = await hmsService.createRoom(callType, newCall._id.toString(), [currentUserId, receiverId]);

        // Update call with HMS room data
        newCall.hmsRoom = {
            roomId: hmsRoom.roomId,
            roomCode: hmsRoom.roomCode,
            enabled: hmsRoom.enabled,
            createdAt: new Date(hmsRoom.createdAt)
        };

        // Generate auth tokens for both participants
        const initiatorTokenResponse = await hmsService.generateAuthToken(hmsRoom.roomId, req.user, 'host');
        const receiverUser = await User.findById(receiverId);
        const receiverTokenResponse = await hmsService.generateAuthToken(hmsRoom.roomId, receiverUser, 'guest');

        // Extract token strings from response (HMS SDK returns { token: "jwt_string" })
        const initiatorToken = typeof initiatorTokenResponse === 'string' ? initiatorTokenResponse : initiatorTokenResponse.token;
        const receiverToken = typeof receiverTokenResponse === 'string' ? receiverTokenResponse : receiverTokenResponse.token;

        // Store tokens in the call
        await newCall.addHMSToken(currentUserId, initiatorToken, 'host');
        await newCall.addHMSToken(receiverId, receiverToken, 'guest');

        console.log(`🎉 Created 100ms room ${hmsRoom.roomId} for call ${newCall._id}`);
    } catch (error) {
        console.error('❌ Failed to create 100ms room:', error);
        // Continue without 100ms integration - fallback to WebRTC
        console.log('⚠️ Continuing with WebRTC fallback');
    }

    // Populate the call with user details
    const populatedCall = await Call.findById(newCall._id)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');

    // Emit call initiation via socket
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

        // Include HMS room data if available
        if (newCall.hmsRoom && newCall.hmsRoom.roomId) {
            const receiverToken = newCall.getHMSTokenForUser(receiverId);
            callData.hmsRoom = {
                roomId: newCall.hmsRoom.roomId,
                roomCode: newCall.hmsRoom.roomCode,
                authToken: receiverToken ? receiverToken.token : null
            };
        }

        socketManager.emitToUser(receiverId, 'incoming_call', callData);
    }

    // Create a call message in the chat
    const callMessage = new Message({
        chatId,
        sender: currentUserId,
        message: `${callType} call ${callType === 'voice' ? '📞' : '📹'}`,
        messageType: 'text'
    });
    await callMessage.save();

    res.status(201).json(
        new ApiResponse(201, populatedCall, 'Call initiated successfully')
    );
});

// Accept a call
export const acceptCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;

    // Find the call
    const call = await Call.findById(callId)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');

    if (!call) {
        throw new ApiError(404, 'Call not found');
    }

    // Check if user is a participant
    const participantIds = call.participants.map(p => p._id.toString());
    if (!participantIds.includes(currentUserId.toString())) {
        throw new ApiError(403, 'You are not a participant in this call');
    }

    // Check if call is in the right status
    if (!['initiated', 'ringing'].includes(call.status)) {
        throw new ApiError(400, 'Call cannot be accepted in current status');
    }

    // Update call status
    call.status = 'connecting';
    call.startedAt = new Date();
    await call.save();

    // Emit call acceptance to all participants
    const otherParticipants = participantIds.filter(id => id !== currentUserId.toString());
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

    res.status(200).json(
        new ApiResponse(200, call, 'Call accepted successfully')
    );
});

// Decline a call
export const declineCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;

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

    // Check if call can be declined
    if (!['initiated', 'ringing'].includes(call.status)) {
        throw new ApiError(400, 'Call cannot be declined in current status');
    }

    // Update call status
    call.status = 'declined';
    call.endedAt = new Date();
    call.endReason = 'declined';
    await call.save();

    // Emit call decline to other participants
    const otherParticipants = participantIds.filter(id => id !== currentUserId.toString());
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

    res.status(200).json(
        new ApiResponse(200, call, 'Call declined successfully')
    );
});

// End a call
export const endCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;
    const { endReason = 'normal' } = req.body;

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

    // Check if call can be ended
    if (call.status === 'ended') {
        throw new ApiError(400, 'Call has already ended');
    }

    // Update call status
    call.status = 'ended';
    call.endedAt = new Date();
    call.endReason = endReason;

    // End 100ms room if it exists
    if (call.hmsRoom && call.hmsRoom.roomId) {
        try {
            await hmsService.endRoom(call.hmsRoom.roomId);
            call.hmsRoom.endedAt = new Date();
            console.log(`🏠 Ended 100ms room ${call.hmsRoom.roomId} for call ${call._id}`);
        } catch (error) {
            console.error('❌ Failed to end 100ms room:', error);
        }
    }

    await call.save();

    // Emit call end to other participants
    const otherParticipants = participantIds.filter(id => id !== currentUserId.toString());
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
            timestamp: new Date()
        });
    });

    res.status(200).json(
        new ApiResponse(200, call, 'Call ended successfully')
    );
});

// Update call status (for WebRTC connection states)
export const updateCallStatus = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;
    const { status, metadata } = req.body;

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

// Store WebRTC session data (for debugging/analytics)
export const storeSessionData = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;
    const { sessionData } = req.body;

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

    // Update session data
    if (!call.sessionData) {
        call.sessionData = {};
    }

    if (sessionData.offer) call.sessionData.offer = sessionData.offer;
    if (sessionData.answer) call.sessionData.answer = sessionData.answer;
    if (sessionData.iceCandidates) {
        if (!call.sessionData.iceCandidates) call.sessionData.iceCandidates = [];
        call.sessionData.iceCandidates.push(...sessionData.iceCandidates);
    }

    await call.save();

    res.status(200).json(
        new ApiResponse(200, null, 'Session data stored successfully')
    );
});

// Generate or refresh 100ms auth token for a call participant
export const getHMSAuthToken = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;
    const { role = 'guest' } = req.body;

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

    // Check if call has HMS room
    if (!call.hmsRoom || !call.hmsRoom.roomId) {
        throw new ApiError(400, 'Call does not have 100ms room configured');
    }

    // Check if call is still active
    if (!['initiated', 'ringing', 'connecting', 'active'].includes(call.status)) {
        throw new ApiError(400, 'Call is not active');
    }

    try {
        // Generate new auth token
        const tokenResponse = await hmsService.generateAuthToken(call.hmsRoom.roomId, req.user, role);

        // Extract token string from response (HMS SDK returns { token: "jwt_string" })
        const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse.token;

        // Store/update token in call
        await call.addHMSToken(currentUserId, token, role);

        res.status(200).json(
            new ApiResponse(200, {
                authToken: token,
                roomId: call.hmsRoom.roomId,
                roomCode: call.hmsRoom.roomCode,
                role
            }, 'HMS auth token generated successfully')
        );
    } catch (error) {
        console.error('❌ Error generating HMS token:', error);
        throw new ApiError(500, 'Failed to generate HMS auth token');
    }
});

// Get 100ms room details for a call
export const getHMSRoomDetails = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id;
    const { callId } = req.params;

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

    // Check if call has HMS room
    if (!call.hmsRoom || !call.hmsRoom.roomId) {
        throw new ApiError(400, 'Call does not have 100ms room configured');
    }

    try {
        // Get room details from 100ms
        const roomDetails = await hmsService.getRoomDetails(call.hmsRoom.roomId);

        // Get active sessions
        const activeSessions = await hmsService.getActiveSessions(call.hmsRoom.roomId);

        // Get user's token
        const userToken = call.getHMSTokenForUser(currentUserId);

        res.status(200).json(
            new ApiResponse(200, {
                call: {
                    id: call._id,
                    status: call.status,
                    callType: call.callType,
                    participants: call.participants
                },
                hmsRoom: {
                    ...roomDetails,
                    activeSessions: activeSessions.length,
                    authToken: userToken ? userToken.token : null,
                    userRole: userToken ? userToken.role : null
                }
            }, 'HMS room details fetched successfully')
        );
    } catch (error) {
        console.error('❌ Error fetching HMS room details:', error);
        throw new ApiError(500, 'Failed to fetch HMS room details');
    }
});

// Handle 100ms webhook events
export const handleHMSWebhook = asyncHandler(async (req, res) => {
    const { type, data } = req.body;

    console.log(`📡 Received HMS webhook: ${type}`, data);

    try {
        switch (type) {
            case 'session.started':
                await handleSessionStarted(data);
                break;
            case 'session.ended':
                await handleSessionEnded(data);
                break;
            case 'peer.joined':
                await handlePeerJoined(data);
                break;
            case 'peer.left':
                await handlePeerLeft(data);
                break;
            case 'recording.success':
                await handleRecordingSuccess(data);
                break;
            default:
                console.log(`⚠️ Unhandled webhook type: ${type}`);
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ Error handling HMS webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Webhook event handlers
const handleSessionStarted = async (data) => {
    const { room_id, session_id } = data;

    const call = await Call.getCallByRoomId(room_id);
    if (call && call.status === 'connecting') {
        call.status = 'active';
        call.startedAt = new Date();
        await call.save();

        // Notify participants via socket
        call.participants.forEach(participant => {
            safeEmitToUser(participant._id.toString(), 'call_session_started', {
                callId: call._id,
                sessionId: session_id,
                timestamp: new Date()
            });
        });
    }
};

const handleSessionEnded = async (data) => {
    const { room_id, session_id } = data;

    const call = await Call.getCallByRoomId(room_id);
    if (call && call.status === 'active') {
        call.status = 'ended';
        call.endedAt = new Date();
        call.endReason = 'normal';
        await call.save();

        // Notify participants via socket
        call.participants.forEach(participant => {
            safeEmitToUser(participant._id.toString(), 'call_session_ended', {
                callId: call._id,
                sessionId: session_id,
                timestamp: new Date()
            });
        });
    }
};

const handlePeerJoined = async (data) => {
    const { room_id, peer_id, user_id } = data;

    const call = await Call.getCallByRoomId(room_id);
    if (call) {
        // Notify other participants
        const otherParticipants = call.participants.filter(p =>
            p._id.toString() !== user_id
        );

        otherParticipants.forEach(participant => {
            safeEmitToUser(participant._id.toString(), 'peer_joined_call', {
                callId: call._id,
                peerId: peer_id,
                userId: user_id,
                timestamp: new Date()
            });
        });
    }
};

const handlePeerLeft = async (data) => {
    const { room_id, peer_id, user_id } = data;

    const call = await Call.getCallByRoomId(room_id);
    if (call) {
        // Notify other participants
        const otherParticipants = call.participants.filter(p =>
            p._id.toString() !== user_id
        );

        otherParticipants.forEach(participant => {
            safeEmitToUser(participant._id.toString(), 'peer_left_call', {
                callId: call._id,
                peerId: peer_id,
                userId: user_id,
                timestamp: new Date()
            });
        });
    }
};

const handleRecordingSuccess = async (data) => {
    const { room_id, recording_url } = data;

    const call = await Call.getCallByRoomId(room_id);
    if (call) {
        // Store recording URL in call metadata
        call.metadata = {
            ...call.metadata,
            recordingUrl: recording_url
        };
        await call.save();

        console.log(`📹 Recording saved for call ${call._id}: ${recording_url}`);
    }
};