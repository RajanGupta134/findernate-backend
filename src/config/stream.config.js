import { StreamClient } from '@stream-io/node-sdk';

class StreamService {
    constructor() {
        this.client = null;
        this.apiKey = null;
        this.apiSecret = null;
        this.initialized = false;
    }

    initialize() {
        try {
            this.apiKey = process.env.STREAM_API_KEY;
            this.apiSecret = process.env.STREAM_API_SECRET;

            if (!this.apiKey || !this.apiSecret) {
                console.warn('⚠️  Stream.io credentials not configured. Set STREAM_API_KEY and STREAM_API_SECRET in .env');
                return false;
            }

            // Initialize Stream client
            this.client = new StreamClient(this.apiKey, this.apiSecret);
            this.initialized = true;

            console.log('✅ Stream.io service initialized successfully');
            console.log(`📡 Stream.io API Key: ${this.apiKey.substring(0, 10)}...`);

            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Stream.io service:', error.message);
            this.initialized = false;
            return false;
        }
    }

    isConfigured() {
        return this.initialized && this.client !== null;
    }

    getApiKey() {
        return this.apiKey;
    }

    /**
     * Generate a user token for Stream.io Video/Audio calls
     * @param {string} userId - User ID to generate token for
     * @param {number} expirationSeconds - Token expiration time in seconds (default: 24 hours)
     * @returns {Object} { token: string, expiresAt: Date }
     */
    generateUserToken(userId, expirationSeconds = 86400) {
        if (!this.isConfigured()) {
            throw new Error('Stream.io service not configured. Check your environment variables.');
        }

        try {
            // Calculate expiration time
            const expiresAt = new Date(Date.now() + (expirationSeconds * 1000));

            // Generate token using Stream SDK
            const token = this.client.createToken(userId, Math.floor(expiresAt.getTime() / 1000));

            console.log(`🔑 Generated Stream.io token for user: ${userId}, expires at: ${expiresAt.toISOString()}`);

            return {
                token,
                expiresAt,
                userId,
                apiKey: this.apiKey
            };
        } catch (error) {
            console.error('❌ Error generating Stream.io token:', error);
            throw new Error(`Failed to generate Stream.io token: ${error.message}`);
        }
    }

    /**
     * Generate a call token with specific permissions
     * @param {string} userId - User ID
     * @param {string} callId - Call ID
     * @param {Array} permissions - Array of permission strings
     * @returns {Object} { token: string, expiresAt: Date }
     */
    generateCallToken(userId, callId, permissions = [], expirationSeconds = 86400) {
        if (!this.isConfigured()) {
            throw new Error('Stream.io service not configured. Check your environment variables.');
        }

        try {
            const expiresAt = new Date(Date.now() + (expirationSeconds * 1000));

            // For call-specific tokens with permissions
            const token = this.client.createToken(
                userId,
                Math.floor(expiresAt.getTime() / 1000),
                {
                    call_cids: [`default:${callId}`],
                    ...(permissions.length > 0 && { permissions })
                }
            );

            console.log(`🔑 Generated Stream.io call token for user: ${userId}, call: ${callId}`);

            return {
                token,
                expiresAt,
                userId,
                callId,
                apiKey: this.apiKey
            };
        } catch (error) {
            console.error('❌ Error generating Stream.io call token:', error);
            throw new Error(`Failed to generate Stream.io call token: ${error.message}`);
        }
    }

    /**
     * Create a call in Stream.io
     * @param {string} callType - Type of call (e.g., 'default', 'audio_room', 'livestream')
     * @param {string} callId - Unique call identifier
     * @param {string} createdBy - User ID who created the call
     * @param {Object} members - Members to add to the call
     * @returns {Object} Call details
     */
    async createCall(callType, callId, createdBy, members = []) {
        if (!this.isConfigured()) {
            throw new Error('Stream.io service not configured. Check your environment variables.');
        }

        try {
            const call = this.client.video.call(callType, callId);

            const response = await call.getOrCreate({
                data: {
                    created_by_id: createdBy,
                    members: members.map(userId => ({ user_id: userId })),
                    settings_override: {
                        audio: { mic_default_on: true },
                        video: { camera_default_on: true }
                    }
                }
            });

            console.log(`📞 Stream.io call created: ${callType}:${callId}`);

            return response;
        } catch (error) {
            console.error('❌ Error creating Stream.io call:', error);
            throw new Error(`Failed to create Stream.io call: ${error.message}`);
        }
    }

    /**
     * End a call in Stream.io
     * @param {string} callType - Type of call
     * @param {string} callId - Call identifier
     * @returns {Object} End call response
     */
    async endCall(callType, callId) {
        if (!this.isConfigured()) {
            throw new Error('Stream.io service not configured. Check your environment variables.');
        }

        try {
            const call = this.client.video.call(callType, callId);
            const response = await call.end();

            console.log(`📵 Stream.io call ended: ${callType}:${callId}`);

            return response;
        } catch (error) {
            console.error('❌ Error ending Stream.io call:', error);
            throw new Error(`Failed to end Stream.io call: ${error.message}`);
        }
    }
}

// Create singleton instance
const streamService = new StreamService();

// Initialize on startup
streamService.initialize();

export default streamService;
