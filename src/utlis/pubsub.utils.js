import { redisPubSub, redisAppPublisher } from '../config/redis.config.js';
import { EventEmitter } from 'events';

/**
 * Redis PubSub Manager for FinderNate real-time features
 * Integrates with Socket.IO for WebSocket communication
 */
class PubSubManager extends EventEmitter {
    constructor() {
        super();
        this.subscribers = new Map();
        this.isReady = false;
        
        this.setupPubSubHandlers();
    }

    /**
     * Setup Redis PubSub event handlers
     */
    setupPubSubHandlers() {
        redisPubSub.on('ready', () => {
            console.log('🔄 Redis PubSub: Ready');
            this.isReady = true;
            this.emit('ready');
        });

        redisPubSub.on('error', (error) => {
            console.error('❌ Redis PubSub Error:', error);
            this.emit('error', error);
        });

        // Handle incoming messages
        redisPubSub.on('message', (channel, message) => {
            this.handleMessage(channel, message);
        });

        redisPubSub.on('pmessage', (pattern, channel, message) => {
            this.handlePatternMessage(pattern, channel, message);
        });
    }

    /**
     * Handle incoming Redis messages
     * @param {string} channel - Redis channel
     * @param {string} message - Message content
     */
    handleMessage(channel, message) {
        try {
            const data = JSON.parse(message);
            this.emit('message', { channel, data });
            
            // Emit specific channel events
            this.emit(channel, data);
            
        } catch (error) {
            console.error('PubSub message parse error:', error);
        }
    }

    /**
     * Handle pattern-based messages
     * @param {string} pattern - Subscription pattern
     * @param {string} channel - Actual channel
     * @param {string} message - Message content
     */
    handlePatternMessage(pattern, channel, message) {
        try {
            const data = JSON.parse(message);
            this.emit('pmessage', { pattern, channel, data });
            
            // Extract user ID from channel for user-specific events
            if (channel.includes(':user:')) {
                const userId = this.extractUserIdFromChannel(channel);
                if (userId) {
                    this.emit(`user:${userId}`, { channel, data });
                }
            }
            
        } catch (error) {
            console.error('PubSub pattern message parse error:', error);
        }
    }

    /**
     * Extract user ID from Redis channel
     * @param {string} channel - Redis channel
     * @returns {string|null} User ID
     */
    extractUserIdFromChannel(channel) {
        const userMatch = channel.match(/fn:user:([^:]+)/);
        return userMatch ? userMatch[1] : null;
    }

    /**
     * Subscribe to a specific channel
     * @param {string} channel - Channel to subscribe to
     * @param {Function} handler - Message handler function
     */
    async subscribe(channel, handler) {
        try {
            await redisPubSub.subscribe(channel);
            
            if (handler) {
                this.on(channel, handler);
            }
            
            this.subscribers.set(channel, {
                type: 'channel',
                handler,
                subscribedAt: new Date()
            });
            
            console.log(`📻 Subscribed to channel: ${channel}`);
            
        } catch (error) {
            console.error(`Subscribe error for channel ${channel}:`, error);
        }
    }

    /**
     * Subscribe to a channel pattern
     * @param {string} pattern - Pattern to subscribe to
     * @param {Function} handler - Message handler function
     */
    async psubscribe(pattern, handler) {
        try {
            await redisPubSub.psubscribe(pattern);
            
            if (handler) {
                this.on('pmessage', ({ pattern: msgPattern, channel, data }) => {
                    if (msgPattern === pattern) {
                        handler(channel, data);
                    }
                });
            }
            
            this.subscribers.set(pattern, {
                type: 'pattern',
                handler,
                subscribedAt: new Date()
            });
            
            console.log(`🎯 Subscribed to pattern: ${pattern}`);
            
        } catch (error) {
            console.error(`Pattern subscribe error for ${pattern}:`, error);
        }
    }

    /**
     * Unsubscribe from a channel
     * @param {string} channel - Channel to unsubscribe from
     */
    async unsubscribe(channel) {
        try {
            await redisPubSub.unsubscribe(channel);
            this.removeAllListeners(channel);
            this.subscribers.delete(channel);
            
            console.log(`📻 Unsubscribed from channel: ${channel}`);
            
        } catch (error) {
            console.error(`Unsubscribe error for channel ${channel}:`, error);
        }
    }

    /**
     * Unsubscribe from a pattern
     * @param {string} pattern - Pattern to unsubscribe from
     */
    async punsubscribe(pattern) {
        try {
            await redisPubSub.punsubscribe(pattern);
            this.subscribers.delete(pattern);
            
            console.log(`🎯 Unsubscribed from pattern: ${pattern}`);
            
        } catch (error) {
            console.error(`Pattern unsubscribe error for ${pattern}:`, error);
        }
    }

    /**
     * Publish a message to a channel
     * @param {string} channel - Channel to publish to
     * @param {Object} data - Data to publish
     */
    async publish(channel, data) {
        try {
            const message = JSON.stringify({
                ...data,
                timestamp: Date.now(),
                channel
            });
            
            const result = await redisAppPublisher.publish(channel, message);
            return result;
            
        } catch (error) {
            console.error(`Publish error for channel ${channel}:`, error);
            return 0;
        }
    }

    /**
     * Get list of active subscriptions
     * @returns {Array} List of subscriptions
     */
    getSubscriptions() {
        return Array.from(this.subscribers.entries()).map(([key, value]) => ({
            channel: key,
            ...value
        }));
    }
}

// Create singleton instance
const pubSubManager = new PubSubManager();

/**
 * Redis Channel Constants for FinderNate
 */
export const CHANNELS = {
    // Chat and messaging
    CHAT_MESSAGE: (chatId) => `fn:chat:${chatId}`,
    USER_MESSAGES: (userId) => `fn:user:${userId}:messages`,
    TYPING_INDICATOR: (chatId) => `fn:live:typing:${chatId}`,
    
    // Social notifications
    USER_NOTIFICATIONS: (userId) => `fn:user:${userId}:notifications`,
    USER_ACTIVITY: (userId) => `fn:user:${userId}:activity`,
    
    // Live features
    ONLINE_STATUS: () => 'fn:live:online_status',
    CALL_EVENTS: (callId) => `fn:live:call:${callId}`,
    LIVE_LOCATION: (userId) => `fn:live:location:${userId}`,
    
    // Cache invalidation
    CACHE_INVALIDATE: () => 'fn:cache:invalidate',
    
    // Patterns for bulk subscriptions
    PATTERNS: {
        USER_ALL: (userId) => `fn:user:${userId}:*`,
        CHAT_ALL: () => 'fn:chat:*',
        LIVE_ALL: () => 'fn:live:*',
        NOTIFICATIONS_ALL: () => 'fn:user:*:notifications'
    }
};

/**
 * Specialized PubSub utilities for different features
 */
export const ChatPubSub = {
    /**
     * Subscribe to chat messages
     * @param {string} chatId - Chat ID
     * @param {Function} handler - Message handler
     */
    async subscribeToChat(chatId, handler) {
        const channel = CHANNELS.CHAT_MESSAGE(chatId);
        await pubSubManager.subscribe(channel, handler);
    },

    /**
     * Publish chat message
     * @param {string} chatId - Chat ID
     * @param {Object} message - Message data
     */
    async publishMessage(chatId, message) {
        const channel = CHANNELS.CHAT_MESSAGE(chatId);
        return await pubSubManager.publish(channel, {
            type: 'new_message',
            chatId,
            message
        });
    },

    /**
     * Publish typing indicator
     * @param {string} chatId - Chat ID
     * @param {string} userId - User ID who is typing
     * @param {boolean} isTyping - Typing status
     */
    async publishTyping(chatId, userId, isTyping) {
        const channel = CHANNELS.TYPING_INDICATOR(chatId);
        return await pubSubManager.publish(channel, {
            type: 'typing',
            userId,
            isTyping,
            timestamp: Date.now()
        });
    }
};

export const NotificationPubSub = {
    /**
     * Subscribe to user notifications
     * @param {string} userId - User ID
     * @param {Function} handler - Notification handler
     */
    async subscribeToNotifications(userId, handler) {
        const channel = CHANNELS.USER_NOTIFICATIONS(userId);
        await pubSubManager.subscribe(channel, handler);
    },

    /**
     * Publish notification to user
     * @param {string} userId - Target user ID
     * @param {Object} notification - Notification data
     */
    async publishNotification(userId, notification) {
        const channel = CHANNELS.USER_NOTIFICATIONS(userId);
        return await pubSubManager.publish(channel, {
            type: 'notification',
            userId,
            notification
        });
    },

    /**
     * Publish activity update
     * @param {string} userId - User ID
     * @param {Object} activity - Activity data
     */
    async publishActivity(userId, activity) {
        const channel = CHANNELS.USER_ACTIVITY(userId);
        return await pubSubManager.publish(channel, {
            type: 'activity',
            userId,
            activity
        });
    }
};

export const LiveFeaturesPubSub = {
    /**
     * Publish user online status
     * @param {string} userId - User ID
     * @param {boolean} isOnline - Online status
     */
    async publishOnlineStatus(userId, isOnline) {
        const channel = CHANNELS.ONLINE_STATUS();
        return await pubSubManager.publish(channel, {
            type: 'online_status',
            userId,
            isOnline,
            timestamp: Date.now()
        });
    },

    /**
     * Subscribe to call events
     * @param {string} callId - Call ID
     * @param {Function} handler - Event handler
     */
    async subscribeToCall(callId, handler) {
        const channel = CHANNELS.CALL_EVENTS(callId);
        await pubSubManager.subscribe(channel, handler);
    },

    /**
     * Publish call event
     * @param {string} callId - Call ID
     * @param {Object} event - Call event data
     */
    async publishCallEvent(callId, event) {
        const channel = CHANNELS.CALL_EVENTS(callId);
        return await pubSubManager.publish(channel, {
            type: 'call_event',
            callId,
            event
        });
    }
};

export const CacheInvalidationPubSub = {
    /**
     * Subscribe to cache invalidation events
     * @param {Function} handler - Invalidation handler
     */
    async subscribeToInvalidation(handler) {
        const channel = CHANNELS.CACHE_INVALIDATE();
        await pubSubManager.subscribe(channel, handler);
    },

    /**
     * Publish cache invalidation event
     * @param {Array} patterns - Cache patterns to invalidate
     * @param {string} reason - Reason for invalidation
     */
    async publishInvalidation(patterns, reason) {
        const channel = CHANNELS.CACHE_INVALIDATE();
        return await pubSubManager.publish(channel, {
            type: 'cache_invalidation',
            patterns,
            reason,
            timestamp: Date.now()
        });
    }
};

export { pubSubManager };
export default pubSubManager;