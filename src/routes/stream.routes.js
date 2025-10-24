import { Router } from 'express';
import {
    generateUserToken,
    generateCallToken,
    createStreamCall,
    endStreamCall,
    getStreamConfig
} from '../controllers/stream.controllers.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

/**
 * Stream.io Token Generation Routes
 */

// Generate user token for Stream.io
// POST /api/v1/stream/token
router.post('/token', generateUserToken);

// Generate call-specific token with permissions
// POST /api/v1/stream/call-token
router.post('/call-token', generateCallToken);

/**
 * Stream.io Call Management Routes
 */

// Create a call in Stream.io
// POST /api/v1/stream/create-call
router.post('/create-call', createStreamCall);

// End a call in Stream.io
// POST /api/v1/stream/end-call
router.post('/end-call', endStreamCall);

/**
 * Stream.io Configuration Route
 */

// Get Stream.io public configuration (API key)
// GET /api/v1/stream/config
router.get('/config', getStreamConfig);

export default router;
