import express from "express";
import { getSuggestedReels } from "../controllers/reel.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = express.Router();


// Get suggested reels (random, following, or all)
router.get("/suggested", verifyJWT, getSuggestedReels);

export default router;