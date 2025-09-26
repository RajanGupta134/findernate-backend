import { Router } from "express";
import {
    createProduct,
    getProductById,
    getProducts,
    updateProduct,
    deleteProduct,
    toggleProductStatus,
    toggleFeaturedStatus,
    getProductAnalytics,
    getSearchSuggestions,
    getFilterOptions,
    addProductReview,
    updateProductReview,
    deleteProductReview,
    getProductReviews,
    markReviewHelpful
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
    addProductVariant,
    updateProductVariant,
    deleteProductVariant,
    getProductVariants,
    getVariantBySKU,
    reorderVariants,
    bulkUpdateVariantStock
} from "../controllers/productVariant.controllers.js";
import {
    importProductsFromCSV,
    exportProductsToCSV,
    bulkUpdatePrices,
    downloadCSVTemplate
} from "../controllers/productBulk.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multerConfig.js";

const router = Router();

// Public routes
router.route("/").get(getProducts); // Now handles both listing and search with optional 'q' parameter
router.route("/search/autocomplete").get(getSearchSuggestions);
router.route("/filters/options").get(getFilterOptions);
router.route("/:id").get(getProductById);

// Middleware to handle form-data properly
const handleFormData = (req, res, next) => {
    // If no files, skip multer and use JSON parsing
    if (req.get('content-type')?.includes('application/json')) {
        return next();
    }
    // Use multer for form-data
    return upload.array('images', 10)(req, res, next);
};

// Protected routes (Vendor/Admin)
router.route("/create").post(verifyJWT, handleFormData, createProduct);
router.route("/:id").put(verifyJWT, upload.array('images', 10), updateProduct);
router.route("/:id").delete(verifyJWT, deleteProduct);
router.route("/:id/toggle-status").post(verifyJWT, toggleProductStatus);

// Feature toggle (product owners)
router.route("/:id/feature").post(verifyJWT, toggleFeaturedStatus);

// Analytics routes
router.route("/analytics/dashboard").get(verifyJWT, getProductAnalytics);


// Inventory management routes
router.route("/inventory/stock-in/:productId").post(verifyJWT, stockIn);
router.route("/inventory/stock-out/:productId").post(verifyJWT, stockOut);
router.route("/inventory/adjust/:productId").put(verifyJWT, adjustStock);
router.route("/inventory/low-stock").get(verifyJWT, getLowStockProducts);
router.route("/inventory/out-of-stock").get(verifyJWT, getOutOfStockProducts);
router.route("/inventory/stats").get(verifyJWT, getInventoryStats);
router.route("/inventory/bulk-update").put(verifyJWT, bulkUpdateStock);

// Variant management routes
router.route("/:productId/variants").get(getProductVariants);
router.route("/:productId/variants").post(verifyJWT, addProductVariant);
router.route("/:productId/variants/:variantId").put(verifyJWT, updateProductVariant);
router.route("/:productId/variants/:variantId").delete(verifyJWT, deleteProductVariant);
router.route("/:productId/variants/reorder").put(verifyJWT, reorderVariants);
router.route("/:productId/variants/bulk-update-stock").post(verifyJWT, bulkUpdateVariantStock);

// Variant lookup routes
router.route("/variants/by-sku/:sku").get(getVariantBySKU);

// Bulk operations routes
router.route("/bulk/template").get(downloadCSVTemplate);
router.route("/bulk/import").post(verifyJWT, upload.single('csvFile'), importProductsFromCSV);
router.route("/bulk/export").get(verifyJWT, exportProductsToCSV);
router.route("/bulk/update-prices").post(verifyJWT, bulkUpdatePrices);

export default router;