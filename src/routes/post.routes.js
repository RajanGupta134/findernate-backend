// routes/post.routes.js
import { Router } from "express";
import { upload } from "../middlewares/multerConfig.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    createNormalPost,
    createProductPost,
    createServicePost,
    createBusinessPost,
    getUserProfilePosts,
    getMyPosts,
    getPostById,
} from "../controllers/post.controllers.js";
import { getHomeFeed } from "../controllers/homeFeed.controllers.js";
import { likePost, unlikePost, likeComment, unlikeComment } from "../controllers/like.controllers.js";
import { createComment, getCommentsByPost, getCommentById, updateComment, deleteComment } from "../controllers/comment.controllers.js";
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead, deleteNotification } from "../controllers/notification.controllers.js";
import { getProfileTabContent } from "../controllers/switch.controllers.js";


const router = Router();

// Accept image or video from frontend
const mediaUpload = upload.fields([
    { name: "image", maxCount: 10 },
    { name: "video", maxCount: 10 },
    { name: "reel", maxCount: 10 },
    { name: "story", maxCount: 10 },
    { name: "thumbnail", maxCount: 1 },
]);

router.route("/create/normal").post(mediaUpload, verifyJWT, createNormalPost);
router.route("/create/service").post(mediaUpload, verifyJWT, createServicePost);
router.route("/create/product").post(mediaUpload, verifyJWT, createProductPost);
router.route("/create/business").post(mediaUpload, verifyJWT, createBusinessPost);
router.route("/user/:userId/profile").get(verifyJWT, getUserProfilePosts);
router.route("/switch/profile/:userId").get(verifyJWT, getProfileTabContent);
router.route("/home-feed").get(verifyJWT, getHomeFeed);
router.route("/myPosts").get(verifyJWT, getMyPosts);
router.route("/notifications").get(verifyJWT, getNotifications);
router.route("/:id").get(verifyJWT, getPostById);

// Get single post by ID
router.route("/:id").get(verifyJWT, getPostById);

// Like/unlike post
router.route("/like").post(verifyJWT, likePost);
router.route("/unlike").post(verifyJWT, unlikePost);

// Like/unlike comment
router.route("/like-comment").post(verifyJWT, likeComment);
router.route("/unlike-comment").post(verifyJWT, unlikeComment);

// Comment routes
router.route("/comment").post(verifyJWT, createComment);
router.route("/comments").get(verifyJWT, getCommentsByPost);
router.route("/comment/:commentId").get(verifyJWT, getCommentById);
router.route("/comment/:commentId").put(verifyJWT, updateComment);
router.route("/comment/:commentId").delete(verifyJWT, deleteComment);

// Notification routes
router.route("/notification").get(verifyJWT, getNotifications);
router.route("/notification/:noticationId/read").patch(verifyJWT, markNotificationAsRead);
router.route("/notification/read-all").patch(verifyJWT, markAllNotificationsAsRead);
router.route("/notification/:noticationId").delete(verifyJWT, deleteNotification);

export default router;
