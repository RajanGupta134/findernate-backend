import { Router } from "express";
import {
    addToCart,
    updateCartItem,
    removeFromCart,
    getCart,
    clearCart,
    getCartSummary
} from "../controllers/cart.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// All cart routes require authentication
router.use(verifyJWT);

// Cart management routes
router.route("/").get(getCart);                    // GET /api/v1/cart - View cart items
router.route("/").delete(clearCart);               // DELETE /api/v1/cart - Clear cart
router.route("/add").post(addToCart);              // POST /api/v1/cart/add - Add item to cart
router.route("/summary").get(getCartSummary);      // GET /api/v1/cart/summary - Get cart summary

// Item-specific routes
router.route("/update/:itemId").put(updateCartItem);   // PUT /api/v1/cart/update/:itemId - Update quantity
router.route("/remove/:itemId").delete(removeFromCart); // DELETE /api/v1/cart/remove/:itemId - Remove item

export default router;