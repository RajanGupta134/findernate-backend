import express from "express";
import { getExploreFeed } from "../controllers/explore.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", verifyJWT, getExploreFeed);

export default router;