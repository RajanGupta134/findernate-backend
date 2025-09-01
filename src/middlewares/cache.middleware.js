import { CacheManager, RedisKeys, RedisTTL } from '../utlis/cache.utils.js';
import { redisClient } from '../config/redis.config.js';

/**
 * Generic cache middleware for Express routes
 * @param {Object} options - Caching options
 * @returns {Function} Express middleware function
 */
export const cacheMiddleware = (options = {}) => {
    return async (req, res, next) => {
        try {
            const {
                keyGenerator = defaultKeyGenerator,
                ttl = 300, // 5 minutes default
                skipCache = false,
                skipCacheIf = null
            } = options;

            // Skip caching if conditions are met
            if (skipCache || (skipCacheIf && skipCacheIf(req))) {
                return next();
            }

            // Generate cache key
            const cacheKey = keyGenerator(req);

            // Try to get from cache
            const cachedData = await CacheManager.get(cacheKey);

            if (cachedData) {
                // Add cache headers
                res.set({
                    'X-Cache': 'HIT',
                    'X-Cache-Key': cacheKey,
                    'Cache-Control': `public, max-age=${ttl}`
                });

                return res.json(cachedData);
            }

            // Cache miss - store original json method
            const originalJson = res.json;

            // Override res.json to cache the response
            res.json = function(data) {
                // Cache the response data
                CacheManager.set(cacheKey, data, ttl).catch(err => {
                    console.error('Cache set error:', err);
                });

                // Add cache headers
                res.set({
                    'X-Cache': 'MISS',
                    'X-Cache-Key': cacheKey,
                    'Cache-Control': `public, max-age=${ttl}`
                });

                // Call original json method
                return originalJson.call(this, data);
            };

            next();

        } catch (error) {
            console.error('Cache middleware error:', error);
            // Continue without caching on error
            next();
        }
    };
};

/**
 * Default cache key generator
 * @param {Object} req - Express request object
 * @returns {string} Generated cache key
 */
const defaultKeyGenerator = (req) => {
    const userId = req.user?._id || 'anonymous';
    const method = req.method;
    const path = req.route?.path || req.path;
    const query = JSON.stringify(req.query);
    const params = JSON.stringify(req.params);
    
    return `fn:route:${method}:${path}:${userId}:${Buffer.from(query + params).toString('base64')}`;
};

/**
 * User Feed Cache Middleware
 * Specialized middleware for caching user feeds
 */
export const feedCacheMiddleware = (options = {}) => {
    return cacheMiddleware({
        keyGenerator: (req) => {
            const userId = req.user?._id || 'anonymous';
            const page = req.query.page || 1;
            return RedisKeys.userFeed(userId, page);
        },
        ttl: options.ttl || RedisTTL.USER_FEED,
        skipCacheIf: (req) => {
            // Skip cache for real-time updates
            return req.query.refresh === 'true' || !req.user?._id;
        }
    });
};

/**
 * Search Results Cache Middleware
 * Specialized middleware for caching search results
 */
export const searchCacheMiddleware = (options = {}) => {
    return cacheMiddleware({
        keyGenerator: (req) => {
            const query = req.query.q || req.query.search || '';
            const page = req.query.page || 1;
            const filters = JSON.stringify({
                type: req.query.type,
                location: req.query.location,
                sortBy: req.query.sortBy
            });
            
            const searchKey = Buffer.from(query + filters).toString('base64').slice(0, 16);
            return `fn:search:${searchKey}:p${page}`;
        },
        ttl: options.ttl || RedisTTL.SEARCH_RESULTS,
        skipCacheIf: (req) => {
            // Skip cache for empty queries or real-time searches
            const query = req.query.q || req.query.search || '';
            return query.length < 2 || req.query.live === 'true';
        }
    });
};

/**
 * Profile Cache Middleware
 * Cache user profiles and business profiles
 */
export const profileCacheMiddleware = (options = {}) => {
    return cacheMiddleware({
        keyGenerator: (req) => {
            const profileId = req.params.id || req.params.userId || req.params.businessId;
            const profileType = req.route.path.includes('business') ? 'business' : 'user';
            return `fn:${profileType}:${profileId}:profile`;
        },
        ttl: options.ttl || RedisTTL.USER_PROFILE,
        skipCacheIf: (req) => {
            // Skip cache if requesting own profile (may need real-time data)
            return req.user?._id === req.params.id;
        }
    });
};

/**
 * Trending Content Cache Middleware
 * Cache trending posts, businesses, etc.
 */
export const trendingCacheMiddleware = (options = {}) => {
    return cacheMiddleware({
        keyGenerator: (req) => {
            const contentType = req.route.path.includes('business') ? 'business' : 'posts';
            const location = req.query.location || req.query.city || 'global';
            return `fn:trending:${contentType}:${location}`;
        },
        ttl: options.ttl || RedisTTL.TRENDING_POSTS,
        skipCache: false // Always cache trending content
    });
};

/**
 * Product/Category Cache Middleware
 * Cache product listings and categories
 */
export const catalogCacheMiddleware = (options = {}) => {
    return cacheMiddleware({
        keyGenerator: (req) => {
            if (req.route.path.includes('categories')) {
                return RedisKeys.categories();
            }
            
            const businessId = req.params.businessId || req.query.businessId;
            const category = req.query.category;
            const page = req.query.page || 1;
            
            if (businessId) {
                return `fn:business:${businessId}:products:${category || 'all'}:p${page}`;
            }
            
            return `fn:products:${category || 'all'}:p${page}`;
        },
        ttl: options.ttl || RedisTTL.PRODUCT_CATALOG
    });
};

/**
 * Rate Limiting Middleware using Redis
 * @param {Object} options - Rate limiting options
 */
export const rateLimitMiddleware = (options = {}) => {
    const {
        windowMs = 15 * 60 * 1000, // 15 minutes
        maxRequests = 100,
        keyGenerator = (req) => req.ip,
        message = 'Too many requests, please try again later.',
        skipSuccessfulRequests = false,
        skipFailedRequests = false
    } = options;

    return async (req, res, next) => {
        try {
            const key = `fn:ratelimit:${keyGenerator(req)}`;
            const windowSeconds = Math.floor(windowMs / 1000);

            // Get current count
            const current = await redisClient.incr(key);

            // Set expiry on first request
            if (current === 1) {
                await redisClient.expire(key, windowSeconds);
            }

            // Get remaining TTL
            const ttl = await redisClient.ttl(key);
            const remaining = Math.max(0, maxRequests - current);

            // Set rate limit headers
            res.set({
                'X-RateLimit-Limit': maxRequests.toString(),
                'X-RateLimit-Remaining': remaining.toString(),
                'X-RateLimit-Reset': new Date(Date.now() + (ttl * 1000)).toISOString()
            });

            if (current > maxRequests) {
                res.set('Retry-After', ttl.toString());
                return res.status(429).json({
                    error: message,
                    retryAfter: ttl
                });
            }

            // Track response for potential cleanup
            if (!skipSuccessfulRequests || !skipFailedRequests) {
                const originalEnd = res.end;
                res.end = function(...args) {
                    const shouldSkip = (res.statusCode < 400 && skipSuccessfulRequests) || 
                                     (res.statusCode >= 400 && skipFailedRequests);
                    
                    if (shouldSkip) {
                        redisClient.decr(key).catch(console.error);
                    }
                    
                    return originalEnd.apply(this, args);
                };
            }

            next();

        } catch (error) {
            console.error('Rate limit middleware error:', error);
            // Continue without rate limiting on Redis errors
            next();
        }
    };
};

/**
 * Cache Invalidation Middleware
 * Automatically invalidate related caches after certain operations
 */
export const cacheInvalidationMiddleware = (invalidationConfig) => {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = async function(data) {
            // Call original json method first
            const result = originalJson.call(this, data);

            // Perform cache invalidation after successful response
            if (res.statusCode >= 200 && res.statusCode < 300 && invalidationConfig) {
                try {
                    const patterns = invalidationConfig(req, res, data);
                    
                    if (patterns && patterns.length > 0) {
                        // Invalidate in background
                        setImmediate(async () => {
                            for (const pattern of patterns) {
                                await CacheManager.delPattern(pattern);
                            }
                        });
                    }
                } catch (error) {
                    console.error('Cache invalidation error:', error);
                }
            }

            return result;
        };

        next();
    };
};

/**
 * Conditional Cache Middleware
 * Only cache responses that meet certain conditions
 */
export const conditionalCacheMiddleware = (condition, cacheOptions) => {
    return async (req, res, next) => {
        if (await condition(req, res)) {
            return cacheMiddleware(cacheOptions)(req, res, next);
        }
        next();
    };
};

export default {
    cacheMiddleware,
    feedCacheMiddleware,
    searchCacheMiddleware,
    profileCacheMiddleware,
    trendingCacheMiddleware,
    catalogCacheMiddleware,
    rateLimitMiddleware,
    cacheInvalidationMiddleware,
    conditionalCacheMiddleware
};