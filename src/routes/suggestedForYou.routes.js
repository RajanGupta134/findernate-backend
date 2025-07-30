import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { getSuggestedForYou } from "../controllers/suggestedForYou.controllers.js";

const router = Router();

// Get suggested for you (all suggestions combined)
router.get("/suggested-for-you", verifyJWT, getSuggestedForYou);

export default router; 