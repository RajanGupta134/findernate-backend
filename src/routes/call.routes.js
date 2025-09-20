import { Router } from 'express';
import {
    initiateCall,
    acceptCall,
    declineCall,
    endCall,
    updateCallStatus,
    getCallHistory,
    getActiveCall,
    getCallStats,
    storeSessionData,
    getHMSAuthToken,
    getHMSRoomDetails,
    handleHMSWebhook,
    getSessionAnalyticsByRoom,
    createRoom,
    generateAuthToken
} from '../controllers/call.controllers.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import {
    hmsTokenLimit,
    roomCreationLimit,
    analyticsLimit,
    hmsGeneralLimit
} from '../middlewares/hmsRateLimit.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

// Call management routes (with rate limiting)
router.post('/initiate', roomCreationLimit, initiateCall); // POST /api/v1/calls/initiate
router.patch('/:callId/accept', hmsGeneralLimit, acceptCall); // PATCH /api/v1/calls/:callId/accept
router.patch('/:callId/decline', hmsGeneralLimit, declineCall); // PATCH /api/v1/calls/:callId/decline
router.patch('/:callId/end', hmsGeneralLimit, endCall);     // PATCH /api/v1/calls/:callId/end
router.patch('/:callId/status', hmsGeneralLimit, updateCallStatus); // PATCH /api/v1/calls/:callId/status

// Call data routes
router.get('/history', getCallHistory);                    // GET /api/v1/calls/history
router.get('/active', getActiveCall);                      // GET /api/v1/calls/active
router.get('/stats', getCallStats);                        // GET /api/v1/calls/stats
router.get('/session-analytics', analyticsLimit, getSessionAnalyticsByRoom); // GET /api/v1/calls/session-analytics

// WebRTC session data (for debugging/analytics)
router.post('/:callId/session-data', storeSessionData);    // POST /api/v1/calls/:callId/session-data

// 100ms specific routes (with specific rate limiting)
router.post('/:callId/hms-token', hmsTokenLimit, getHMSAuthToken); // POST /api/v1/calls/:callId/hms-token
router.get('/:callId/hms-room', hmsGeneralLimit, getHMSRoomDetails); // GET /api/v1/calls/:callId/hms-room

// 100ms guide pattern endpoints
router.post('/create-room', roomCreationLimit, createRoom);        // POST /api/v1/calls/create-room
router.post('/auth-token', hmsTokenLimit, generateAuthToken);      // POST /api/v1/calls/auth-token

// Webhook endpoint (no auth required for webhooks)
const webhookRouter = Router();
webhookRouter.post('/hms-webhook', handleHMSWebhook);       // POST /api/v1/calls/hms-webhook

// Merge webhook routes with main router
router.use('/', webhookRouter);

export default router;