import { Router } from "express";
import { upload } from "../middlewares/multerConfig.js";
import { verifyJWT, optionalVerifyJWT } from "../middlewares/auth.middleware.js";
import { loginUser, logOutUser, registerUser, getUserProfile, updateUserProfile, changePassword, deleteAccount, searchUsers, verifyEmailWithOTP, uploadProfileImage, sendVerificationOTPForEmail, sendPasswordResetOTP, resetPasswordWithOTP, getOtherUserProfile, checkTokenExpiry, togglePhoneNumberVisibility, toggleAddressVisibility, trackSearch, getPopularSearches } from "../controllers/user.controllers.js";
import { searchAllContent } from "../controllers/searchAllContent.controllers.js";
import { followUser, unfollowUser, getFollowers, getFollowing } from "../controllers/follower.controllers.js";
import { getSearchSuggestions } from "../controllers/searchSuggestion.controllers.js";

const router = Router();

router.route("/register").post(registerUser);
router.route("/login").post(loginUser);
router.route("/logout").post(verifyJWT, logOutUser);
router.route("/profile").get(verifyJWT, getUserProfile);
router.route("/profile").put(verifyJWT, updateUserProfile);
router.route("/profile/change-password").put(verifyJWT, changePassword);
router.route("/profile").delete(verifyJWT, deleteAccount);
router.route("/profile/search").get(verifyJWT, searchUsers);
router.route("/verify-email-otp").post(verifyEmailWithOTP);
router.route("/send-verification-otp").post(sendVerificationOTPForEmail);
router.route("/profile/upload-image").post(verifyJWT, upload.single("profileImage"), uploadProfileImage);
router.route("/send-reset-otp").post(sendPasswordResetOTP);
router.route("/reset-password").post(resetPasswordWithOTP);
router.route("/check-token").post(checkTokenExpiry);
router.route("/searchAllContent").get(optionalVerifyJWT, searchAllContent);
router.route("/profile/other").get(verifyJWT, getOtherUserProfile);

// Follower routes
router.post("/follow", verifyJWT, followUser);
router.post("/unfollow", verifyJWT, unfollowUser);
router.get("/followers/:userId", verifyJWT, getFollowers);
router.get("/following/:userId", verifyJWT, getFollowing);

// Search suggestion routes
router.get("/search-suggestions", verifyJWT, getSearchSuggestions);

// Search tracking routes
router.post("/track-search", verifyJWT, trackSearch);
router.get("/popular-searches", verifyJWT, getPopularSearches);


// Get other user profile by userId or username
router.get("/profile/other", verifyJWT, getOtherUserProfile);

// Privacy settings routes
router.put("/privacy/phone-number", verifyJWT, togglePhoneNumberVisibility);
router.put("/privacy/address", verifyJWT, toggleAddressVisibility);

export default router;