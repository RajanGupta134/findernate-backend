import { Router } from "express";
import {
    createProduct,
    getProductById,
    getProducts,
    updateProduct,
    deleteProduct,
    toggleProductStatus,
    toggleFeaturedStatus,
    getProductAnalytics
} from "../controllers/product.controllers.js";
import {
    stockIn,
    stockOut,
    adjustStock,
    getLowStockProducts,
    getOutOfStockProducts,
    getInventoryStats,
    bulkUpdateStock
} from "../controllers/inventory.controllers.js";
import {
    uploadProductImages,
    updateProductImage,
    deleteProductImage,
    reorderProductImages,
    getProductImages,
    setPrimaryImage
} from "../controllers/productImage.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { verifyAdminJWT } from "../middlewares/adminAuth.middleware.js";
import { upload } from "../middlewares/multerConfig.js";

const router = Router();

// Public routes
router.route("/").get(getProducts); // Now handles both listing and search with optional 'q' parameter
router.route("/:id").get(getProductById);

// Protected routes (Vendor/Admin)
router.route("/create").post(verifyJWT, createProduct);
router.route("/:id").put(verifyJWT, updateProduct);
router.route("/:id").delete(verifyJWT, deleteProduct);
router.route("/:id/toggle-status").post(verifyJWT, toggleProductStatus);

// Admin only routes
router.route("/:id/feature").post(verifyAdminJWT, toggleFeaturedStatus);

// Analytics routes
router.route("/analytics/dashboard").get(verifyJWT, getProductAnalytics);

// Image management routes
router.route("/:productId/images").get(getProductImages);
router.route("/:productId/images").post(verifyJWT, upload.array('images', 10), uploadProductImages);
router.route("/:productId/images/:imageIndex").put(verifyJWT, updateProductImage);
router.route("/:productId/images/:imageIndex").delete(verifyJWT, deleteProductImage);
router.route("/:productId/images/reorder").put(verifyJWT, reorderProductImages);
router.route("/:productId/images/:imageIndex/set-primary").post(verifyJWT, setPrimaryImage);

// Inventory management routes
router.route("/inventory/stock-in/:productId").post(verifyJWT, stockIn);
router.route("/inventory/stock-out/:productId").post(verifyJWT, stockOut);
router.route("/inventory/adjust/:productId").put(verifyJWT, adjustStock);
router.route("/inventory/low-stock").get(verifyJWT, getLowStockProducts);
router.route("/inventory/out-of-stock").get(verifyJWT, getOutOfStockProducts);
router.route("/inventory/stats").get(verifyJWT, getInventoryStats);
router.route("/inventory/bulk-update").put(verifyJWT, bulkUpdateStock);

export default router;
