import { generateToken04 } from './zegoServerAssistant.js';

/**
 * ZegoCloud Service
 * Using official Token04 generator from ZegoCloud
 * Reference: https://github.com/ZEGOCLOUD/zego_server_assistant
 */



class ZegoService {
    constructor() {
        this.appId = parseInt(process.env.ZEGO_APP_ID);
        this.serverSecret = process.env.ZEGO_SERVER_SECRET;

        // Debug logging to verify credentials are loaded
        console.log('🔍 ZegoCloud Configuration:', {
            appId: this.appId,
            appIdType: typeof this.appId,
            appIdIsValid: !isNaN(this.appId),
            hasServerSecret: !!this.serverSecret,
            serverSecretLength: this.serverSecret?.length || 0,
            serverSecretLast8: this.serverSecret?.slice(-8) || 'MISSING',
            isConfigured: !!(this.appId && this.serverSecret && !isNaN(this.appId))
        });

        if (!this.appId || !this.serverSecret) {
            console.warn('⚠️  ZegoCloud credentials not found in environment variables');
        } else if (isNaN(this.appId)) {
            console.error('❌ ZegoCloud AppID is NaN - check ZEGO_APP_ID environment variable');
        } else if (this.serverSecret.length !== 32) {
            console.error('❌ ZegoCloud ServerSecret must be exactly 32 bytes long');
        }
    }

    /**
     * Generate Token04 for ZegoCloud using official algorithm
     * @param {string} userId - User ID (string)
     * @param {number} effectiveTimeInSeconds - Token validity duration in seconds (default: 7200 = 2 hours)
     * @param {string} payload - Additional payload as JSON string (optional)
     * @returns {string} Generated token
     */
    generateToken04Internal(userId, effectiveTimeInSeconds = 7200, payload = '') {
        if (!this.isConfigured()) {
            throw new Error('ZegoCloud is not properly configured. Please check ZEGO_APP_ID and ZEGO_SERVER_SECRET');
        }

        // Use official ZegoCloud Token04 generator
        const token = generateToken04(
            this.appId,
            userId,
            this.serverSecret,
            effectiveTimeInSeconds,
            payload
        );

        return token;
    }

    /**
     * Generate token for room-based call
     * @param {string} userId - User ID
     * @param {string} roomId - Room/Channel ID
     * @param {number} effectiveTimeInSeconds - Token validity (default: 7200)
     * @param {object} privilege - Privilege settings for the room
     * @returns {object} Token data with metadata
     */
    generateRoomToken(userId, roomId, effectiveTimeInSeconds = 7200, privilege = null) {
        try {
            let payload = '';

            // If privilege is specified, create payload with room_id and privilege
            if (privilege) {
                const payloadObject = {
                    room_id: roomId,
                    privilege: privilege
                };
                payload = JSON.stringify(payloadObject);
            }

            const token = this.generateToken04Internal(userId, effectiveTimeInSeconds, payload);

            console.log(`🔑 Generated ZegoCloud Token04 for user: ${userId} in room: ${roomId}`);

            return {
                token,
                appId: this.appId,
                roomId,
                userId,
                expiresAt: new Date(Date.now() + effectiveTimeInSeconds * 1000)
            };
        } catch (error) {
            console.error('❌ Error generating ZegoCloud room token:', error);
            throw new Error(`Failed to generate ZegoCloud token: ${error.message}`);
        }
    }

    /**
     * Generate token with full privileges (publish + subscribe)
     * @param {string} userId - User ID
     * @param {string} roomId - Room ID
     * @param {number} effectiveTimeInSeconds - Token validity
     * @returns {object} Token data
     */
    generateTokenWithPrivileges(userId, roomId, effectiveTimeInSeconds = 7200) {
        const privilege = {
            1: 1,  // LoginRoom: 1 = allow login to room
            2: 1   // PublishStream: 1 = allow publishing stream
        };

        return this.generateRoomToken(userId, roomId, effectiveTimeInSeconds, privilege);
    }

    /**
     * Check if ZegoCloud is properly configured
     * @returns {boolean}
     */
    isConfigured() {
        return !!(this.appId && this.serverSecret && this.serverSecret.length === 32);
    }

    /**
     * Get App ID
     * @returns {number}
     */
    getAppId() {
        return this.appId;
    }

    /**
     * Get server info (without exposing secret)
     * @returns {object}
     */
    getServerInfo() {
        return {
            appId: this.appId,
            configured: this.isConfigured()
        };
    }
}

// Create singleton instance
const zegoService = new ZegoService();

export default zegoService;
