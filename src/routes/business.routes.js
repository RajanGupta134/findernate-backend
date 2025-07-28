import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { switchToBusinessProfile, createBusinessProfile, deleteBusinessProfile, selectBusinessPlan } from "../controllers/business.controllers.js";

const router = Router();

// Switch to business profile (checks if business exists or needs registration)
router.route("/switch-to-business").post(verifyJWT, switchToBusinessProfile);

// Create business profile
router.route("/create").post(verifyJWT, createBusinessProfile);

// Delete business profile
router.route("/delete").delete(verifyJWT, deleteBusinessProfile);

// Select business plan
router.route("/select-plan").post(verifyJWT, selectBusinessPlan);

export default router; 