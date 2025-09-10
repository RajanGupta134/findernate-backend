import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    getStyledQRCode,
    getMyQRCode
} from "../controllers/qr.controllers.js";

const router = Router();

router.get("/my-qr", verifyJWT, getMyQRCode);

router.get("/:username", getStyledQRCode);

export default router;