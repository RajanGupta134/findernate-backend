import Call from '../models/call.models.js';
import Chat from '../models/chat.models.js';
import Message from '../models/message.models.js';
import { User } from '../models/user.models.js';
import { ApiError } from '../utlis/ApiError.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import socketManager from '../config/socket.js';
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

    // Populate the call with user details
    const populatedCall = await Call.findById(newCall._id)
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');

    // Emit call initiation via socket
    if (socketManager.isReady()) {
        socketManager.emitToUser(receiverId, 'incoming_call', {
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
        });
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