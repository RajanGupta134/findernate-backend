import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    getNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    getUnreadCounts
} from "../controllers/notification.controllers.js";

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// Get all notifications for the logged-in user
router.get("/", getNotifications);

// Get unread counts (notifications & messages) with user token
router.get("/unread-counts", getUnreadCounts);

// Mark a specific notification as read
router.put("/:notificationId/read", markNotificationAsRead);

// Mark all notifications as read
router.put("/mark-all-read", markAllNotificationsAsRead);

// Delete a specific notification
router.delete("/:notificationId", deleteNotification);

export default router;