import { Router } from "express";
import { verifyJWT, optionalVerifyJWT } from "../middlewares/auth.middleware.js";
import {
    switchToBusinessProfile,
    createBusinessProfile,
    deleteBusinessProfile,
    selectBusinessPlan,
    getBusinessProfile,
    updateBusinessProfile,
    getBusinessById,
    getMyBusinessCategory,
    updateExistingActiveBusinesses
} from "../controllers/business.controllers.js";

const router = Router();

// Switch to business profile (checks if business exists or needs registration)
router.route("/switch-to-business").post(optionalVerifyJWT, switchToBusinessProfile);

// Create business profile
router.route("/create").post(optionalVerifyJWT, createBusinessProfile);

// Delete business profile
router.route("/delete").delete(optionalVerifyJWT, deleteBusinessProfile);

// Select business plan
router.route("/select-plan").post(optionalVerifyJWT, selectBusinessPlan);

// Get authenticated user's business profile
router.route("/profile").get(optionalVerifyJWT, getBusinessProfile);

// Update business profile
router.route("/update").patch(optionalVerifyJWT, updateBusinessProfile);


// Get my business category (auth required) - Must be before /:id route
router.route("/my-category").get(optionalVerifyJWT, getMyBusinessCategory);

// Get business by ID (public access)
router.route("/:id").get(getBusinessById);

// Helper route to update existing businesses with active subscriptions (admin only)
router.route("/admin/update-active-businesses").post(optionalVerifyJWT, updateExistingActiveBusinesses);

export default router; 