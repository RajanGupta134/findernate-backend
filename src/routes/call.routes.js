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
    getZegoToken,
    getZegoRoomDetails,
    forceEndActiveCalls
} from '../controllers/call.controllers.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

// Call management routes
router.post('/initiate', initiateCall); // POST /api/v1/calls/initiate
router.patch('/:callId/accept', acceptCall); // PATCH /api/v1/calls/:callId/accept
router.patch('/:callId/decline', declineCall); // PATCH /api/v1/calls/:callId/decline
router.patch('/:callId/end', endCall);     // PATCH /api/v1/calls/:callId/end
router.patch('/:callId/status', updateCallStatus); // PATCH /api/v1/calls/:callId/status
router.post('/force-end-active', forceEndActiveCalls); // POST /api/v1/calls/force-end-active (cleanup stuck calls)

// Call data routes
router.get('/history', getCallHistory);                    // GET /api/v1/calls/history
router.get('/active', getActiveCall);                      // GET /api/v1/calls/active
router.get('/stats', getCallStats);                        // GET /api/v1/calls/stats

// ZegoCloud specific routes
router.post('/:callId/zego-token', getZegoToken);          // POST /api/v1/calls/:callId/zego-token
router.get('/:callId/zego-room', getZegoRoomDetails);      // GET /api/v1/calls/:callId/zego-room

export default router;