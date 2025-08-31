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
    handleHMSWebhook
} from '../controllers/call.controllers.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

// Call management routes
router.post('/initiate', initiateCall);                    // POST /api/v1/calls/initiate
router.patch('/:callId/accept', acceptCall);               // PATCH /api/v1/calls/:callId/accept
router.patch('/:callId/decline', declineCall);             // PATCH /api/v1/calls/:callId/decline
router.patch('/:callId/end', endCall);                     // PATCH /api/v1/calls/:callId/end
router.patch('/:callId/status', updateCallStatus);         // PATCH /api/v1/calls/:callId/status

// Call data routes
router.get('/history', getCallHistory);                    // GET /api/v1/calls/history
router.get('/active', getActiveCall);                      // GET /api/v1/calls/active
router.get('/stats', getCallStats);                        // GET /api/v1/calls/stats

// WebRTC session data (for debugging/analytics)
router.post('/:callId/session-data', storeSessionData);    // POST /api/v1/calls/:callId/session-data

// 100ms specific routes
router.post('/:callId/hms-token', getHMSAuthToken);         // POST /api/v1/calls/:callId/hms-token
router.get('/:callId/hms-room', getHMSRoomDetails);         // GET /api/v1/calls/:callId/hms-room

// Webhook endpoint (no auth required for webhooks)
const webhookRouter = Router();
webhookRouter.post('/hms-webhook', handleHMSWebhook);       // POST /api/v1/calls/hms-webhook

// Merge webhook routes with main router
router.use('/', webhookRouter);

export default router;