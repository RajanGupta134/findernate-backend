import { Router } from 'express';
import { generateUserToken } from '../controllers/stream.controllers.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

/**
 * Stream.io Token Generation
 *
 * POST /api/v1/stream/token
 * - Generates a Stream.io user token for video/audio calls
 * - Auto-registers user in Stream.io if not already registered
 * - Returns token, userId, apiKey, and expiration time
 */
router.post('/token', generateUserToken);

export default router;
