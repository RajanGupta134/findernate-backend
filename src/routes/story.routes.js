import express from "express";
import { uploadStory, fetchStoriesFeed, fetchStoriesByUser, markStorySeen, fetchStoryViewers, fetchArchivedStoriesByUser } from "../controllers/story.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multerConfig.js";

const router = express.Router();

// Upload a story (single image/video)
router.post("/upload", verifyJWT, upload.single("media"), uploadStory);

// Fetch stories feed (from followed + self)
router.get("/feed", verifyJWT, fetchStoriesFeed);

// Fetch stories by user id
router.get("/user/:userId", verifyJWT, fetchStoriesByUser);

// Mark story as seen
router.post("/seen", verifyJWT, markStorySeen);

// Fetch archived stories by user
router.get("/archived/:userId", verifyJWT, fetchArchivedStoriesByUser);

// Fetch viewers of a story
router.get("/:storyId/viewers", verifyJWT, fetchStoryViewers);

export default router;