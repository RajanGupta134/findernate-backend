import { ApiError } from '../utlis/ApiError.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { asyncHandler } from '../utlis/asyncHandler.js';
import streamService from '../config/stream.config.js';

/**
 * POST /api/v1/stream/token
 * Generate a Stream.io user token for video/audio calls
 *
 * Body: {
 *   userId?: string (optional - defaults to authenticated user)
 *   expirationSeconds?: number (optional - defaults to 24 hours)
 * }
 */
export const generateUserToken = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id.toString();
    const { userId, expirationSeconds = 86400 } = req.body;

    // Use authenticated user's ID if no userId provided
    const targetUserId = userId || currentUserId;

    // Security: Only allow users to generate tokens for themselves
    // unless they have admin privileges (you can add admin check here)
    if (targetUserId !== currentUserId) {
        throw new ApiError(403, 'You can only generate tokens for yourself');
    }

    console.log('🔑 Token generation request:', { userId: targetUserId, expirationSeconds });

    // Check if Stream.io is configured
    if (!streamService.isConfigured()) {
        throw new ApiError(503, 'Stream.io service is not configured. Please contact support.');
    }

    try {
        // Generate token
        const tokenData = streamService.generateUserToken(targetUserId, expirationSeconds);

        res.status(200).json(
            new ApiResponse(200, {
                token: tokenData.token,
                userId: tokenData.userId,
                apiKey: tokenData.apiKey,
                expiresAt: tokenData.expiresAt
            }, 'Stream.io token generated successfully')
        );
    } catch (error) {
        console.error('❌ Error in generateUserToken:', error);
        throw new ApiError(500, error.message || 'Failed to generate Stream.io token');
    }
});

/**
 * POST /api/v1/stream/call-token
 * Generate a Stream.io call token with specific permissions
 *
 * Body: {
 *   callId: string (required)
 *   permissions?: string[] (optional - e.g., ['create-call', 'join-call'])
 *   expirationSeconds?: number (optional - defaults to 24 hours)
 * }
 */
export const generateCallToken = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id.toString();
    const { callId, permissions = [], expirationSeconds = 86400 } = req.body;

    if (!callId) {
        throw new ApiError(400, 'callId is required');
    }

    console.log('🔑 Call token generation request:', { userId: currentUserId, callId, permissions });

    // Check if Stream.io is configured
    if (!streamService.isConfigured()) {
        throw new ApiError(503, 'Stream.io service is not configured. Please contact support.');
    }

    try {
        // Generate call token
        const tokenData = streamService.generateCallToken(
            currentUserId,
            callId,
            permissions,
            expirationSeconds
        );

        res.status(200).json(
            new ApiResponse(200, {
                token: tokenData.token,
                userId: tokenData.userId,
                callId: tokenData.callId,
                apiKey: tokenData.apiKey,
                expiresAt: tokenData.expiresAt
            }, 'Stream.io call token generated successfully')
        );
    } catch (error) {
        console.error('❌ Error in generateCallToken:', error);
        throw new ApiError(500, error.message || 'Failed to generate Stream.io call token');
    }
});

/**
 * POST /api/v1/stream/create-call
 * Create a call in Stream.io
 *
 * Body: {
 *   callId: string (required)
 *   callType?: string (optional - defaults to 'default')
 *   members?: string[] (optional - array of user IDs to add to call)
 * }
 */
export const createStreamCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id.toString();
    const { callId, callType = 'default', members = [] } = req.body;

    if (!callId) {
        throw new ApiError(400, 'callId is required');
    }

    console.log('📞 Create Stream.io call request:', { callId, callType, createdBy: currentUserId, members });

    // Check if Stream.io is configured
    if (!streamService.isConfigured()) {
        throw new ApiError(503, 'Stream.io service is not configured. Please contact support.');
    }

    try {
        // Add current user to members if not already included
        const allMembers = [currentUserId, ...members.filter(m => m !== currentUserId)];

        // Create call in Stream.io
        const callData = await streamService.createCall(
            callType,
            callId,
            currentUserId,
            allMembers
        );

        res.status(201).json(
            new ApiResponse(201, {
                call: callData.call,
                members: callData.members,
                callId,
                callType
            }, 'Stream.io call created successfully')
        );
    } catch (error) {
        console.error('❌ Error in createStreamCall:', error);
        throw new ApiError(500, error.message || 'Failed to create Stream.io call');
    }
});

/**
 * POST /api/v1/stream/end-call
 * End a call in Stream.io
 *
 * Body: {
 *   callId: string (required)
 *   callType?: string (optional - defaults to 'default')
 * }
 */
export const endStreamCall = asyncHandler(async (req, res) => {
    const currentUserId = req.user._id.toString();
    const { callId, callType = 'default' } = req.body;

    if (!callId) {
        throw new ApiError(400, 'callId is required');
    }

    console.log('📵 End Stream.io call request:', { callId, callType, userId: currentUserId });

    // Check if Stream.io is configured
    if (!streamService.isConfigured()) {
        throw new ApiError(503, 'Stream.io service is not configured. Please contact support.');
    }

    try {
        // End call in Stream.io
        const result = await streamService.endCall(callType, callId);

        res.status(200).json(
            new ApiResponse(200, {
                callId,
                callType,
                endedAt: new Date()
            }, 'Stream.io call ended successfully')
        );
    } catch (error) {
        console.error('❌ Error in endStreamCall:', error);
        throw new ApiError(500, error.message || 'Failed to end Stream.io call');
    }
});

/**
 * GET /api/v1/stream/config
 * Get Stream.io public configuration (API key only, no secret)
 */
export const getStreamConfig = asyncHandler(async (req, res) => {
    // Check if Stream.io is configured
    if (!streamService.isConfigured()) {
        throw new ApiError(503, 'Stream.io service is not configured. Please contact support.');
    }

    res.status(200).json(
        new ApiResponse(200, {
            apiKey: streamService.getApiKey(),
            configured: streamService.isConfigured()
        }, 'Stream.io configuration fetched successfully')
    );
});
