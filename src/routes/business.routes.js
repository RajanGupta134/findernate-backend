import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    switchToBusinessProfile,
    createBusinessProfile,
    deleteBusinessProfile,
    selectBusinessPlan,
    getBusinessProfile,
    updateBusinessProfile,
    getBusinessById,
    updateExistingActiveBusinesses
} from "../controllers/business.controllers.js";

const router = Router();

// Switch to business profile (checks if business exists or needs registration)
router.route("/switch-to-business").post(verifyJWT, switchToBusinessProfile);

// Create business profile
router.route("/create").post(verifyJWT, createBusinessProfile);

// Delete business profile
router.route("/delete").delete(verifyJWT, deleteBusinessProfile);

// Select business plan
router.route("/select-plan").post(verifyJWT, selectBusinessPlan);

// Get authenticated user's business profile
router.route("/profile").get(verifyJWT, getBusinessProfile);

// Update business profile
router.route("/update").patch(verifyJWT, updateBusinessProfile);



// Helper route to update existing businesses with active subscriptions (admin only)
router.route("/admin/update-active-businesses").post(verifyJWT, updateExistingActiveBusinesses);

// Get business by ID (public access)
router.route("/:id").get(getBusinessById);

export default router; 