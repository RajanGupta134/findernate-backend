import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    getStyledQRCode,
    getMyQRCode,
    shareQRCode,
    shareMyQRCode
} from "../controllers/qr.controllers.js";

const router = Router();

// Authenticated QR routes
router.get("/my-qr", verifyJWT, getMyQRCode);
router.get("/share/my-qr", verifyJWT, shareMyQRCode);
router.get("/share/:username", verifyJWT, shareQRCode);

// Public QR routes
router.get("/:username", getStyledQRCode);

export default router;