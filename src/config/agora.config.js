import pkg from 'agora-token';
const { RtcTokenBuilder, RtcRole, RtmTokenBuilder, RtmRole } = pkg;

class AgoraService {
    constructor() {
        this.appId = process.env.AGORA_APP_ID;
        this.appCertificate = process.env.AGORA_APP_CERTIFICATE;

        if (!this.appId || !this.appCertificate) {
            console.warn('⚠️ Agora credentials not found in environment variables');
        }
    }

    /**
     * Generate RTC token for voice/video call
     * @param {string} channelName - Channel name (usually callId)
     * @param {string} userId - User ID
     * @param {string} role - 'publisher' or 'subscriber' (default: 'publisher')
     * @param {number} expirationTime - Token expiration time in seconds (default: 3600 = 1 hour)
     * @returns {Object} Token and channel info
     */
    generateRtcToken(channelName, userId, role = 'publisher', expirationTime = 3600) {
        try {
            const currentTimestamp = Math.floor(Date.now() / 1000);
            const privilegeExpiredTs = currentTimestamp + expirationTime;

            // Set role - publisher (host) can publish and subscribe, subscriber can only subscribe
            const rtcRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

            // Build token with user ID (uid as integer or 0 for string-based userId)
            const uid = 0; // Use 0 for string-based user accounts

            const token = RtcTokenBuilder.buildTokenWithUid(
                this.appId,
                this.appCertificate,
                channelName,
                uid,
                rtcRole,
                privilegeExpiredTs
            );

            console.log(`🔑 Generated Agora RTC token for user: ${userId} in channel: ${channelName}`);

            return {
                token,
                appId: this.appId,
                channelName,
                userId,
                uid,
                role: rtcRole,
                expiresAt: new Date(privilegeExpiredTs * 1000)
            };
        } catch (error) {
            console.error('❌ Error generating Agora RTC token:', error);
            throw new Error(`Failed to generate Agora RTC token: ${error.message}`);
        }
    }

    /**
     * Generate RTM token for real-time messaging
     * @param {string} userId - User ID
     * @param {number} expirationTime - Token expiration time in seconds (default: 3600)
     * @returns {Object} Token info
     */
    generateRtmToken(userId, expirationTime = 3600) {
        try {
            const currentTimestamp = Math.floor(Date.now() / 1000);
            const privilegeExpiredTs = currentTimestamp + expirationTime;

            const token = RtmTokenBuilder.buildToken(
                this.appId,
                this.appCertificate,
                userId,
                RtmRole.Rtm_User,
                privilegeExpiredTs
            );

            console.log(`🔑 Generated Agora RTM token for user: ${userId}`);

            return {
                token,
                appId: this.appId,
                userId,
                expiresAt: new Date(privilegeExpiredTs * 1000)
            };
        } catch (error) {
            console.error('❌ Error generating Agora RTM token:', error);
            throw new Error(`Failed to generate Agora RTM token: ${error.message}`);
        }
    }

    /**
     * Generate tokens for both RTC and RTM
     * @param {string} channelName - Channel name
     * @param {string} userId - User ID
     * @param {string} role - RTC role
     * @param {number} expirationTime - Token expiration time
     * @returns {Object} Both tokens
     */
    generateTokens(channelName, userId, role = 'publisher', expirationTime = 3600) {
        try {
            const rtcToken = this.generateRtcToken(channelName, userId, role, expirationTime);
            const rtmToken = this.generateRtmToken(userId, expirationTime);

            return {
                rtc: rtcToken,
                rtm: rtmToken,
                appId: this.appId
            };
        } catch (error) {
            console.error('❌ Error generating Agora tokens:', error);
            throw new Error(`Failed to generate Agora tokens: ${error.message}`);
        }
    }

    /**
     * Validate if credentials are configured
     * @returns {boolean}
     */
    isConfigured() {
        return !!(this.appId && this.appCertificate);
    }

    /**
     * Get app ID (for client-side initialization)
     * @returns {string}
     */
    getAppId() {
        return this.appId;
    }
}

// Create singleton instance
const agoraService = new AgoraService();

export default agoraService;
