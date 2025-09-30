import { Router } from "express";
import {
    initiateCheckout,
    placeOrder,
    getOrderDetails,
    getOrderHistory,
    updateOrderStatus,
    getSellerOrders,
    requestReturn,
    processRefund
} from "../controllers/order.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// All order routes require authentication
router.use(verifyJWT);

// Order management routes
router.route("/checkout").post(initiateCheckout);                    // POST /api/v1/orders/checkout - Initiate checkout
router.route("/").get(getOrderHistory);                              // GET /api/v1/orders - Get user's order history
router.route("/:orderId").get(getOrderDetails);                      // GET /api/v1/orders/:orderId - Get single order details
router.route("/:orderId/place").post(placeOrder);                    // POST /api/v1/orders/:orderId/place - Place order
router.route("/:orderId/status").put(updateOrderStatus);             // PUT /api/v1/orders/:orderId/status - Update order status

// Return and refund routes
router.route("/:orderId/return").post(requestReturn);                // POST /api/v1/orders/:orderId/return - Request order return
router.route("/:orderId/refund").put(processRefund);                 // PUT /api/v1/orders/:orderId/refund - Process refund (admin)

// Seller-specific routes
router.route("/seller/:sellerId").get(getSellerOrders);              // GET /api/v1/orders/seller/:sellerId - Get seller's orders

export default router;