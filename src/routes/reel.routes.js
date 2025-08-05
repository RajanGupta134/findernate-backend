import express from "express";
import { getSuggestedReels } from "../controllers/reel.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Get suggested reels with comprehensive data and filtering options
router.get("/suggested", getSuggestedReels);

export default router;