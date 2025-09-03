import { Router } from "express";
import {
    createCategory,
    getAllCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
    toggleCategoryStatus,
    getCategoryTree,
    getCategoryBreadcrumb
} from "../controllers/category.controllers.js";
import { verifyAdminJWT } from "../middlewares/adminAuth.middleware.js";

const router = Router();

// Public routes
router.route("/").get(getAllCategories);
router.route("/tree").get(getCategoryTree);
router.route("/:id").get(getCategoryById);
router.route("/:id/breadcrumb").get(getCategoryBreadcrumb);

// Admin routes
router.route("/admin/create").post(verifyAdminJWT, createCategory);
router.route("/admin/:id").put(verifyAdminJWT, updateCategory);
router.route("/admin/:id").delete(verifyAdminJWT, deleteCategory);
router.route("/admin/:id/toggle-status").post(verifyAdminJWT, toggleCategoryStatus);

export default router;
