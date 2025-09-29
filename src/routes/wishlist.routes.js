import { Router } from "express";
import {
    addToWishlist,
    removeFromWishlist,
    getWishlistItems,
    checkProductInWishlist,
    clearWishlist,
    getWishlistStats
} from "../controllers/wishlist.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// All wishlist routes require authentication
router.use(verifyJWT);

// Wishlist management routes
router.route("/").get(getWishlistItems);           // GET /api/v1/wishlist - Get user's wishlist
router.route("/").delete(clearWishlist);           // DELETE /api/v1/wishlist - Clear entire wishlist
router.route("/stats").get(getWishlistStats);      // GET /api/v1/wishlist/stats - Get wishlist statistics

// Product-specific wishlist routes
router.route("/:productId").post(addToWishlist);           // POST /api/v1/wishlist/:productId - Add to wishlist
router.route("/:productId").delete(removeFromWishlist);    // DELETE /api/v1/wishlist/:productId - Remove from wishlist
router.route("/check/:productId").get(checkProductInWishlist); // GET /api/v1/wishlist/check/:productId - Check if in wishlist

export default router;