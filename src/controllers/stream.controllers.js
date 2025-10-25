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
        // Auto-register user in Stream.io (idempotent - safe to call multiple times)
        console.log('👤 Auto-registering user in Stream.io...');
        await streamService.upsertUsers([{
            id: currentUserId,
            name: req.user.fullName || req.user.username,
            username: req.user.username,
            image: req.user.profileImageUrl
        }]);

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

