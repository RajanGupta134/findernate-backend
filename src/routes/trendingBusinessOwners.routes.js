import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { getTrendingBusinessOwners } from "../controllers/trendingBusinessOwners.controllers.js";

const router = Router();

// Get trending business profiles
router.get("/trending-business-owners", getTrendingBusinessOwners); // Removed verifyJWT for testing

export default router;  