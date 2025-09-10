import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    getStyledQRCode,
    getMyQRCode,
    shareQRCode,
    shareMyQRCode,
    shareQRForChat,
    shareMyQRForChat
} from "../controllers/qr.controllers.js";

const router = Router();

// Authenticated QR routes
router.get("/my-qr", verifyJWT, getMyQRCode);
router.get("/share/my-qr", verifyJWT, shareMyQRCode);
router.get("/share/:username", verifyJWT, shareQRCode);

// Chat-specific QR image routes (returns PNG images)
router.get("/chat/my-qr", verifyJWT, shareMyQRForChat);
router.get("/chat/:username", verifyJWT, shareQRForChat);

// Public QR routes
router.get("/:username", getStyledQRCode);

export default router;