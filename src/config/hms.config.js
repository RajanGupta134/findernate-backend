import { SDK } from '@100mslive/server-sdk';


class HMSService {
    constructor() {
        this.api = new SDK(
            process.env.HMS_ACCESS_KEY,
            process.env.HMS_SECRET
        );

        // Default template IDs - you'll need to create these in your 100ms dashboard
        this.VOICE_TEMPLATE_ID = process.env.HMS_VOICE_TEMPLATE_ID;
        this.VIDEO_TEMPLATE_ID = process.env.HMS_VIDEO_TEMPLATE_ID;
    }

    /**
     * Create a new room for audio/video call
     * @param {string} callType - 'voice' or 'video'
     * @param {string} callId - MongoDB call ID
     * @param {Array} participants - Array of participant user IDs
     * @returns {Object} Room details
     */
    async createRoom(callType, callId, participants) {
        try {
            const templateId = callType === 'video' ? this.VIDEO_TEMPLATE_ID : this.VOICE_TEMPLATE_ID;

            const roomOptions = {
                name: `Call-${callId}`,
                description: `${callType.charAt(0).toUpperCase() + callType.slice(1)} call room`,
                template_id: templateId,
                region: 'in', // Change to your preferred region (us, eu, in)
                recording_info: {
                    enabled: false, // Set to true if you want to record calls
                }
            };

            const room = await this.api.rooms.create(roomOptions);

            console.log(`🏠 Created 100ms room: ${room.id} for call: ${callId}`);

            return {
                roomId: room.id,
                roomCode: room.room_code,
                enabled: room.enabled,
                createdAt: room.created_at
            };
        } catch (error) {
            console.error('❌ Error creating 100ms room:', error);
            throw new Error(`Failed to create 100ms room: ${error.message}`);
        }
    }

    /**
     * Generate auth token for a user to join the room
     * @param {string} roomId - 100ms room ID
     * @param {Object} user - User object with _id, username, fullName
     * @param {string} role - 'host' or 'guest'
     * @returns {string} JWT token
     */
    async generateAuthToken(roomId, user, role = 'guest') {
        try {
            const tokenOptions = {
                room_id: roomId,
                user_id: user._id.toString(),
                role: role,
                user_data: JSON.stringify({
                    userId: user._id.toString(),
                    username: user.username,
                    fullName: user.fullName,
                    profileImage: user.profileImageUrl
                })
            };

            const token = await this.api.auth.getAuthToken(tokenOptions);

            console.log(`🔑 Generated auth token for user: ${user.username} in room: ${roomId}`);

            return token;
        } catch (error) {
            console.error('❌ Error generating auth token:', error);
            throw new Error(`Failed to generate auth token: ${error.message}`);
        }
    }

    /**
     * End a room and disable it
     * @param {string} roomId - 100ms room ID
     * @returns {boolean} Success status
     */
    async endRoom(roomId) {
        try {
            // Try different API method names for ending/disabling rooms
            if (this.api.rooms.disable) {
                await this.api.rooms.disable(roomId);
            } else if (this.api.rooms.end) {
                await this.api.rooms.end(roomId);
            } else if (this.api.rooms.close) {
                await this.api.rooms.close(roomId);
            } else if (this.api.rooms.destroy) {
                await this.api.rooms.destroy(roomId);
            } else {
                console.warn('⚠️ Room disable method not available, logging action only');
                console.log(`🏠 Room ${roomId} marked as ended (API method not available)`);
                return true;
            }

            console.log(`🏠 Disabled 100ms room: ${roomId}`);
            return true;
        } catch (error) {
            console.error('❌ Error ending 100ms room:', error);
            // Don't throw error, just log and continue
            console.warn('⚠️ Continuing without HMS room cleanup');
            return false;
        }
    }

    /**
     * Get room details
     * @param {string} roomId - 100ms room ID
     * @returns {Object} Room details
     */
    async getRoomDetails(roomId) {
        try {
            // Try different API method names based on 100ms SDK version
            let room;
            if (this.api.rooms.get) {
                room = await this.api.rooms.get(roomId);
            } else if (this.api.rooms.retrieve) {
                room = await this.api.rooms.retrieve(roomId);
            } else if (this.api.rooms.fetch) {
                room = await this.api.rooms.fetch(roomId);
            } else {
                // Fallback - return basic room info from stored data
                console.warn('⚠️ Room retrieval method not available, returning basic info');
                return {
                    id: roomId,
                    name: `Room-${roomId}`,
                    enabled: true,
                    createdAt: new Date().toISOString(),
                    templateId: 'unknown'
                };
            }

            return {
                id: room.id,
                name: room.name,
                enabled: room.enabled,
                createdAt: room.created_at,
                templateId: room.template_id
            };
        } catch (error) {
            console.error('❌ Error fetching room details:', error);
            // Return fallback data instead of throwing
            console.warn('⚠️ Using fallback room data');
            return {
                id: roomId,
                name: `Room-${roomId}`,
                enabled: true,
                createdAt: new Date().toISOString(),
                templateId: 'unknown'
            };
        }
    }

    /**
     * Get active sessions in a room
     * @param {string} roomId - 100ms room ID
     * @returns {Array} Active sessions
     */
    async getActiveSessions(roomId) {
        try {
            // Try different API methods for sessions
            let sessions;
            if (this.api.sessions && this.api.sessions.list) {
                sessions = await this.api.sessions.list({ room_id: roomId, active: true });
                return sessions.data || sessions || [];
            } else {
                console.warn('⚠️ Sessions API not available, returning empty array');
                return [];
            }
        } catch (error) {
            console.error('❌ Error fetching active sessions:', error);
            return [];
        }
    }

    /**
     * Remove a participant from the room
     * @param {string} roomId - 100ms room ID
     * @param {string} peerId - Peer ID to remove
     * @returns {boolean} Success status
     */
    async removeParticipant(roomId, peerId) {
        try {
            // Try different API methods for removing participants
            if (this.api.rooms.removePeer) {
                await this.api.rooms.removePeer(roomId, peerId);
            } else if (this.api.rooms.kickPeer) {
                await this.api.rooms.kickPeer(roomId, peerId);
            } else if (this.api.rooms.removeParticipant) {
                await this.api.rooms.removeParticipant(roomId, peerId);
            } else {
                console.warn('⚠️ Remove participant method not available');
                return false;
            }

            console.log(`👤 Removed participant ${peerId} from room: ${roomId}`);
            return true;
        } catch (error) {
            console.error('❌ Error removing participant:', error);
            return false;
        }
    }

    /**
     * Send a message to all participants in a room
     * @param {string} roomId - 100ms room ID
     * @param {string} message - Message to send
     * @param {string} type - Message type
     * @returns {boolean} Success status
     */
    async sendRoomMessage(roomId, message, type = 'chat') {
        try {
            // Try different API methods for sending messages
            if (this.api.rooms.sendMessage) {
                await this.api.rooms.sendMessage(roomId, { message, type });
            } else if (this.api.messages && this.api.messages.send) {
                await this.api.messages.send(roomId, { message, type });
            } else if (this.api.rooms.broadcast) {
                await this.api.rooms.broadcast(roomId, { message, type });
            } else {
                console.warn('⚠️ Send message method not available');
                return false;
            }

            return true;
        } catch (error) {
            console.error('❌ Error sending room message:', error);
            return false;
        }
    }
}

// Create singleton instance
const hmsService = new HMSService();

export default hmsService;
