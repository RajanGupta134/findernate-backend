import crypto from 'crypto';

/**
 * ZegoCloud Token Generator
 * Based on ZEGOCLOUD token04 algorithm
 * Reference: https://github.com/zegocloud/zego_server_assistant
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
            console.warn('⚠️ ZegoCloud credentials not found in environment variables');
        } else if (isNaN(this.appId)) {
            console.error('❌ ZegoCloud AppID is NaN - check ZEGO_APP_ID environment variable');
        }
    }

    /**
     * Generate Token04 for ZegoCloud
     * @param {string} userId - User ID (string)
     * @param {number} effectiveTimeInSeconds - Token validity duration in seconds (default: 7200 = 2 hours)
     * @param {object} payload - Additional payload (optional)
     * @returns {string} Generated token
     */
    generateToken04(userId, effectiveTimeInSeconds = 7200, payload = null) {
        if (!this.isConfigured()) {
            throw new Error('ZegoCloud is not properly configured. Please check ZEGO_APP_ID and ZEGO_SERVER_SECRET');
        }

        const time = Math.floor(Date.now() / 1000);
        const nonce = Math.floor(Math.random() * 2147483647); // Random nonce

        // Create header
        const header = {
            alg: 'HS256',
            typ: 'JWT'
        };

        // Create payload
        const body = {
            app_id: this.appId,
            user_id: userId,
            nonce: nonce,
            ctime: time,
            expire: time + effectiveTimeInSeconds
        };

        // Add optional payload if provided
        if (payload) {
            body.payload = payload;
        }

        // Encode header and body
        const headerEnc = this._base64UrlEncode(JSON.stringify(header));
        const bodyEnc = this._base64UrlEncode(JSON.stringify(body));

        // Create signature
        const signature = this._generateSignature(headerEnc, bodyEnc, this.serverSecret);

        // Combine to create token
        const token = `${headerEnc}.${bodyEnc}.${signature}`;

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
            let payload = null;

            // If privilege is specified, add room_id to payload
            if (privilege) {
                payload = {
                    room_id: roomId,
                    privilege: privilege
                };
            }

            const token = this.generateToken04(userId, effectiveTimeInSeconds, payload);

            console.log(`🔑 Generated ZegoCloud token for user: ${userId} in room: ${roomId}`);

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
     * Base64 URL encoding (JWT standard)
     * @param {string} str - String to encode
     * @returns {string} Base64 URL encoded string
     */
    _base64UrlEncode(str) {
        const base64 = Buffer.from(str, 'utf8').toString('base64');
        // Replace characters for URL-safe encoding
        return base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    /**
     * Generate HMAC SHA256 signature
     * @param {string} header - Encoded header
     * @param {string} body - Encoded body
     * @param {string} secret - Server secret
     * @returns {string} Base64 URL encoded signature
     */
    _generateSignature(header, body, secret) {
        const data = `${header}.${body}`;
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(data);
        const signature = hmac.digest('base64');

        // Convert to URL-safe base64
        return signature
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    /**
     * Check if ZegoCloud is properly configured
     * @returns {boolean}
     */
    isConfigured() {
        return !!(this.appId && this.serverSecret);
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
