import { asyncHandler } from "../utlis/asyncHandler.js";
import { User } from "../models/user.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../utlis/sendEmail.js"
import { uploadBufferToCloudinary } from "../utlis/cloudinary.js";
import Follower from "../models/follower.models.js";
import Post from "../models/userPost.models.js";
import Comment from "../models/comment.models.js";
import Like from "../models/like.models.js";
import Business from "../models/business.models.js";
import Story from "../models/story.models.js";
import mongoose from "mongoose";
import SearchSuggestion from "../models/searchSuggestion.models.js";
import SearchHistory from "../models/searchHistory.models.js";
import Media from "../models/mediaUser.models.js";
import { v2 as cloudinary } from "cloudinary";
import jwt from "jsonwebtoken";


const generateAcessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });

        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(500, "something went wrong while generating tokens");
    }
}

const registerUser = asyncHandler(async (req, res) => {
    const { fullName, username, email, password, confirmPassword, phoneNumber, dateOfBirth, gender } = req.body;

    if (!fullName || !username || !email || !password || !confirmPassword) {
        throw new ApiError(400, "All fields are required");
    }

    if (password !== confirmPassword) {
        throw new ApiError(400, "Password and confirm password do not match");
    }

    const errors = [];

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
        errors.push({ field: "email", message: "Email already in use" });
    }

    const existingUsername = await User.findOne({ username: username.toLowerCase() });
    if (existingUsername) {
        errors.push({ field: "username", message: "Username already in use" });
    }

    if (errors.length > 0) {
        throw new ApiError(409, "User already exists with this username or email", errors);
    }

    // Directly create user (no OTP, no TempUser)
    const user = await User.create({
        uid: uuidv4(),
        fullName,
        fullNameLower: fullName.toLowerCase(),
        username: username.toLowerCase(),
        email,
        password,
        phoneNumber,
        dateOfBirth,
        gender,
        isEmailVerified: true,
    });

    const { accessToken, refreshToken } = await generateAcessAndRefreshToken(user._id);
    await user.save({ validateBeforeSave: false });

    const options = {
        httpOnly: true,
        secure: true
    };

    return res
        .status(201)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(201,
                {
                    user,
                    accessToken,
                    refreshToken
                }, "User registered successfully.")
        );
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!(email)) {
        throw new ApiError(400, "Email is required");
    }

    if (!password) {
        throw new ApiError(400, "Password is required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid credentials");
    }

    if (!user.isEmailVerified) {
        throw new ApiError(403, "Email is not verified. Please verify your email to login");
    }

    const { accessToken, refreshToken } = await generateAcessAndRefreshToken(user._id);
    const loggedUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: true
    };

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(new ApiResponse(200, {
            user: loggedUser,
            accessToken,
            refreshToken
        }, "Login successful"));
});


const logOutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(
            new ApiResponse(200, {}, "User logged Out Successfully")
        )
});

const getUserProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const user = await User.findById(userId).select(
        "username fullName email phoneNumber address gender dateOfBirth bio profileImageUrl location link followers following posts isBusinessProfile isEmailVerified isPhoneVerified isPhoneNumberHidden isAddressHidden createdAt"
    );

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const followersCount = user.followers?.length || 0;
    const followingCount = user.following?.length || 0;
    const postsCount = user.posts?.length || 0;

    const userProfile = {
        _id: user._id,
        userId: {
            _id: user._id,
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            phoneNumber: user.isPhoneNumberHidden ? null : user.phoneNumber,
            address: user.isAddressHidden ? null : user.address,
            dateOfBirth: user.dateOfBirth,
            gender: user.gender,
            isBusinessProfile: user.isBusinessProfile,
            isEmailVerified: user.isEmailVerified,
            isPhoneVerified: user.isPhoneVerified,
            isPhoneNumberHidden: user.isPhoneNumberHidden,
            isAddressHidden: user.isAddressHidden,
            createdAt: user.createdAt,
            bio: user.bio,
            link: user.link,
            location: user.location,
            profileImageUrl: user.profileImageUrl,
            followersCount,
            followingCount,
            postsCount
        }
    };

    return res.status(200).json(
        new ApiResponse(200, userProfile, "User profile retrieved successfully")
    );
});


const updateUserProfile = asyncHandler(async (req, res) => {
    const updates = req.body;

    const disallowedFields = [
        "email",
        "password",
        "refreshToken",
        "isEmailVerified",
        "isPhoneVerified",
        "acccoutStatus",
        "followers",
        "following",
        "posts",
        "uid"
    ];
    for (const field of disallowedFields) {
        if (updates.hasOwnProperty(field)) {
            throw new ApiError(400, `Field '${field}' cannot be updated`);
        }
    }

    if (updates.fullName) {
        updates.fullNameLower = updates.fullName.toLowerCase();
    }

    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        updates,
        {
            new: true,
            runValidators: true,
        })
        .select("-password -refreshToken -emailVerificationToken ");

    return res
        .status(200)
        .json(
            new ApiResponse(200, updatedUser, "User profile updated successfully")
        );
});

const changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        throw new ApiError(400, "Current password and new password are required");
    }
    const user = await User.findById(req.user._id);
    const isMatch = await user.isPasswordCorrect(currentPassword);

    if (!isMatch) {
        throw new ApiError(401, "current Password is incorrect");
    }

    user.password = newPassword;
    await user.save();

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                {},
                "Password changed Successfully"
            )
        )
});

const deleteAccount = asyncHandler(async (req, res) => {
    const { password } = req.body;

    if (!password) {
        throw new ApiError(400, "Password is required to delete your account");
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const isMatch = await user.isPasswordCorrect(password);

    if (!isMatch) {
        throw new ApiError(401, "Password is incorrect");
    }

    const userId = user._id;

    // --- Delete all user media from Cloudinary and DB ---
    let mediaCleanup = { deleted: 0, failed: 0, errors: [] };
    try {
        const userMedia = await Media.find({ uploadedBy: userId });
        for (const media of userMedia) {
            try {
                // Extract public_id from Cloudinary URL
                // Example: https://res.cloudinary.com/<cloud_name>/<resource_type>/upload/v1234567890/folder/filename.jpg
                // public_id = folder/filename (without extension)
                const urlParts = media.url.split("/");
                // Remove version and domain parts
                // Find the index of 'upload' (Cloudinary always has .../upload/...)
                const uploadIdx = urlParts.findIndex(part => part === "upload");
                let publicIdWithExt = urlParts.slice(uploadIdx + 1).join("/");
                // Remove extension
                const lastDot = publicIdWithExt.lastIndexOf(".");
                const publicId = lastDot !== -1 ? publicIdWithExt.substring(0, lastDot) : publicIdWithExt;
                // Delete from Cloudinary
                await cloudinary.uploader.destroy(publicId, { resource_type: media.type });
                mediaCleanup.deleted++;
            } catch (err) {
                mediaCleanup.failed++;
                mediaCleanup.errors.push({ mediaId: media._id, error: err.message });
            }
        }
        // Delete all media records for user
        await Media.deleteMany({ uploadedBy: userId });
    } catch (err) {
        mediaCleanup.errors.push({ error: 'Failed to clean up media', details: err.message });
    }
    // --- End media cleanup ---

    // Clean up all user-related data
    const cleanupResults = await Promise.allSettled([
        // Delete all posts by the user
        Post.deleteMany({ userId }),
        // Delete all comments by the user
        Comment.deleteMany({ userId }),
        // Delete all likes by the user
        Like.deleteMany({ userId }),
        // Delete business profile if exists
        Business.deleteOne({ userId }),
        // Delete all stories by the user
        Story.deleteMany({ userId }),
        // Remove user from followers/following lists
        User.updateMany(
            { followers: userId },
            { $pull: { followers: userId } }
        ),
        User.updateMany(
            { following: userId },
            { $pull: { following: userId } }
        ),
        // Remove user from mentions in posts
        Post.updateMany(
            { mentions: userId },
            { $pull: { mentions: userId } }
        ),
        // Remove likes on user's posts
        Like.deleteMany({ postId: { $in: user.posts || [] } }),
        // Remove comments on user's posts
        Comment.deleteMany({ postId: { $in: user.posts || [] } }),
        // Delete follower records
        Follower.deleteMany({ userId }),
        Follower.deleteMany({ followerId: userId })
    ]);

    // Delete the user account directly from the collection
    await User.findByIdAndDelete(userId);

    return res
        .status(200)
        .clearCookie("accessToken")
        .clearCookie("refreshToken")
        .json(
            new ApiResponse(
                200,
                {
                    message: "Account and all associated data deleted successfully",
                    mediaCleanup,
                    cleanupResults: cleanupResults.map((result, index) => ({
                        operation: [
                            "posts", "comments", "likes", "business", "stories",
                            "followers_cleanup", "following_cleanup", "mentions_cleanup",
                            "post_likes_cleanup", "post_comments_cleanup",
                            "follower_records_cleanup", "following_records_cleanup"
                        ][index],
                        status: result.status,
                        ...(result.status === 'rejected' && { error: result.reason?.message })
                    }))
                },
                "Account deleted Successfully"
            )
        )
});

const searchUsers = asyncHandler(async (req, res) => {
    const { query } = req.query;

    if (!query || query.trim() == "") {
        throw new ApiError(400, "Search query is required");
    }

    // Track search keyword if it's 3+ characters
    if (query.trim().length >= 3) {
        const normalizedKeyword = query.trim().toLowerCase();
        try {
            const existingSuggestion = await SearchSuggestion.findOne({
                keyword: normalizedKeyword
            });

            if (existingSuggestion) {
                existingSuggestion.searchCount += 1;
                existingSuggestion.lastSearched = new Date();
                await existingSuggestion.save();
            } else {
                await SearchSuggestion.create({
                    keyword: normalizedKeyword,
                    searchCount: 1,
                    lastSearched: new Date()
                });
            }
        } catch (error) {
            console.log('Error tracking search keyword:', error);
        }
    }

    const user = await User.find({
        accountStatus: "active",
        $or: [
            { username: new RegExp(query, "i") },
            { fullNameLower: new RegExp(query, "i") }
        ]
    }).select("username fullName profileImageUrl bio location");

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                user,
                "Users found successfully"
            )
        );
});

const sendVerificationOTPForEmail = asyncHandler(async (req, res) => {

    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(404, "User not found with this email");
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // valid for 10 minutes

    user.emailOTP = otp;
    user.emailOTPExpiry = expiry;
    await user.save({ validateBeforeSave: false });


    await sendEmail({
        to: user.email,
        subject: "Your OTP for Email Verification - Findernate",
        html: `
            <h3>Email Verification OTP</h3>
            <h2>Your OTP is: <b>${otp}</b></h2>
            <p>This OTP is valid for 10 minutes.</p>
            <p>If you did not request this, please ignore this email.</p>
        `
    });

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "OTP sent to your email successfully"));
});


const verifyEmailWithOTP = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        throw new ApiError(400, "Email and OTP are required");
    }

    const user = await User.findOne({ email });
    if (!user) throw new ApiError(404, "User not found");

    if (
        user.emailOTP !== otp ||
        !user.emailOTPExpiry ||
        user.emailOTPExpiry < new Date()
    ) {
        throw new ApiError(400, "Invalid or expired OTP");
    }

    user.isEmailVerified = true;
    user.emailOTP = undefined;
    user.emailOTPExpiry = undefined;
    user.emailVerificationToken = undefined;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json(new ApiResponse(200, {}, "Email verified successfully"));
})

const uploadProfileImage = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ApiError(400, "Profile Image is required");
    }

    const userId = req.user._id;

    const uploadResult = await uploadBufferToCloudinary(req.file.buffer);

    if (!uploadResult || !uploadResult.secure_url) {
        throw new ApiError(500, "Failed to upload image to Cloudinary");
    }

    const user = await User.findByIdAndUpdate(userId,
        { profileImageUrl: uploadResult.secure_url },
        { new: true, runValidators: true }
    ).select("username fullName profileImageUrl")

    return res
        .status(200)
        .json(new ApiResponse(200, user, "profile image uploaded successfully"));
});

const sendPasswordResetOTP = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({ email });
    if (!user) {
        throw new ApiError(404, "User not found with this email");
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // valid for 10 minutes

    user.passwordResetOTP = otp;
    user.passwordResetOTPExpiry = expiry;
    await user.save({ validateBeforeSave: false });

    await sendEmail({
        to: user.email,
        subject: "Your OTP for Password Reset - FinderNate",
        html: `
            <h3>Password Reset OTP </h3>
            <h2>Your OTP is: <b>${otp}</b></h2>
            <p>This OTP is valid for 10 minutes.</p>
            <p>If you did not request this, please ignore this email.</p>`
    });
    return res
        .status(200)
        .json(new ApiResponse(200, {}, "OTP sent to your email successfully for password reset"));
});
const resetPasswordWithOTP = asyncHandler(async (req, res) => {
    const { otp, newPassword, confirmPassword } = req.body;
    if (!otp || !newPassword || !confirmPassword) {
        throw new ApiError(400, "OTP, new password and confirm password are required");
    }

    if (newPassword !== confirmPassword) {
        throw new ApiError(400, "New password and confirm password do not match");
    }

    const user = await User.findOne({ passwordResetOTP: otp });

    if (!user) {
        throw new ApiError(404, "No user found with this OTP");
    }

    if (!user.passwordResetOTPExpiry || user.passwordResetOTPExpiry < new Date()) {
        throw new ApiError(400, "OTP has expired");
    }

    user.password = newPassword;
    user.passwordResetOTP = undefined;
    user.passwordResetOTPExpiry = undefined;

    await user.save({ validateBeforeSave: false });

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Password reset successfully"));

})

const getOtherUserProfile = asyncHandler(async (req, res) => {
    const { identifier } = req.query;
    const currentUserId = req.user._id;

    if (!identifier) {
        throw new ApiError(400, "User identifier (userId or username) is required");
    }

    let targetUser;

    // Check if identifier is a valid MongoDB ObjectId
    if (mongoose.Types.ObjectId.isValid(identifier)) {
        targetUser = await User.findById(identifier).select('-password -refreshToken -emailVerificationToken -emailOTP -emailOTPExpiry -passwordResetOTP -passwordResetOTPExpiry -phoneVerificationCode -phoneVerificationExpiry');
    }

    // If not found by ID or not a valid ObjectId, search by username
    if (!targetUser) {
        targetUser = await User.findOne({ username: identifier.toLowerCase() }).select('-password -refreshToken -emailVerificationToken -emailOTP -emailOTPExpiry -passwordResetOTP -passwordResetOTPExpiry -phoneVerificationCode -phoneVerificationExpiry');
    }

    if (!targetUser) {
        throw new ApiError(404, "User not found");
    }

    // Check if current user follows the target user
    const isFollowing = await Follower.findOne({
        userId: targetUser._id,
        followerId: currentUserId
    });

    // Calculate counts
    const followersCount = await Follower.countDocuments({ userId: targetUser._id });
    const followingCount = await Follower.countDocuments({ followerId: targetUser._id });
    const postsCount = targetUser.posts ? targetUser.posts.length : 0;

    // Prepare user data with counts (respecting privacy settings)
    const userWithCounts = {
        _id: targetUser._id,
        username: targetUser.username,
        email: targetUser.email,
        fullName: targetUser.fullName,
        phoneNumber: targetUser.isPhoneNumberHidden ? null : (targetUser.phoneNumber || ""),
        address: targetUser.isAddressHidden ? null : (targetUser.address || ""),
        dateOfBirth: targetUser.dateOfBirth || "",
        gender: targetUser.gender || "",
        isBusinessProfile: targetUser.isBusinessProfile,
        isEmailVerified: targetUser.isEmailVerified,
        isPhoneVerified: targetUser.isPhoneVerified,
        isPhoneNumberHidden: targetUser.isPhoneNumberHidden,
        isAddressHidden: targetUser.isAddressHidden,
        bio: targetUser.bio || "",
        link: targetUser.link || "",
        location: targetUser.location || "",
        profileImageUrl: targetUser.profileImageUrl || "",
        followersCount,
        followingCount,
        postsCount,
        createdAt: targetUser.createdAt
    };

    const responseData = {
        _id: targetUser._id,
        isFollowedBy: !!isFollowing,
        userId: userWithCounts
    };

    return res.status(200).json(
        new ApiResponse(200, responseData, "User profile retrieved successfully")
    );
});

// Check if token is expired
const checkTokenExpiry = asyncHandler(async (req, res) => {
    try {
        let token;

        // Extract token from cookies or Authorization header
        if (req.cookies?.accessToken) {
            token = req.cookies.accessToken;
        } else if (req.headers?.authorization && req.headers.authorization.startsWith("Bearer ")) {
            token = req.headers.authorization.split(" ")[1];
        }

        // If no token is provided
        if (!token) {
            return res.status(200).json(
                new ApiResponse(200, {
                    isValid: false,
                    isExpired: true,
                    message: "No token provided"
                }, "Token status checked")
            );
        }

        try {
            // Verify token with JWT
            const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

            // Check if user still exists
            const user = await User.findById(decodedToken?._id).select("-password -refreshToken");

            if (!user) {
                return res.status(200).json(
                    new ApiResponse(200, {
                        isValid: false,
                        isExpired: false,
                        message: "User no longer exists"
                    }, "Token status checked")
                );
            }

            // Token is valid and not expired
            return res.status(200).json(
                new ApiResponse(200, {
                    isValid: true,
                    isExpired: false,
                    user: {
                        _id: user._id,
                        username: user.username,
                        fullName: user.fullName
                    },
                    expiresAt: new Date(decodedToken.exp * 1000),
                    message: "Token is valid"
                }, "Token status checked")
            );

        } catch (jwtError) {
            // Check if error is due to token expiration
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(200).json(
                    new ApiResponse(200, {
                        isValid: false,
                        isExpired: true,
                        expiredAt: new Date(jwtError.expiredAt),
                        message: "Token has expired"
                    }, "Token status checked")
                );
            }

            // Other JWT errors (invalid signature, malformed token, etc.)
            return res.status(200).json(
                new ApiResponse(200, {
                    isValid: false,
                    isExpired: false,
                    message: "Invalid token"
                }, "Token status checked")
            );
        }

    } catch (error) {
        throw new ApiError(500, "Error checking token status: " + error.message);
    }
});

// 📱 Toggle Phone Number Visibility
const togglePhoneNumberVisibility = asyncHandler(async (req, res) => {
    const { isHidden } = req.body;

    if (typeof isHidden !== 'boolean') {
        throw new ApiError(400, "isHidden must be a boolean value");
    }

    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        { isPhoneNumberHidden: isHidden },
        { new: true, runValidators: true }
    ).select("-password -refreshToken -emailVerificationToken");

    if (!updatedUser) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                isPhoneNumberHidden: updatedUser.isPhoneNumberHidden,
                phoneNumber: updatedUser.isPhoneNumberHidden ? null : updatedUser.phoneNumber
            },
            `Phone number ${isHidden ? 'hidden' : 'visible'} successfully`
        )
    );
});

// 🏠 Toggle Address Visibility
const toggleAddressVisibility = asyncHandler(async (req, res) => {
    const { isHidden } = req.body;

    if (typeof isHidden !== 'boolean') {
        throw new ApiError(400, "isHidden must be a boolean value");
    }

    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        { isAddressHidden: isHidden },
        { new: true, runValidators: true }
    ).select("-password -refreshToken -emailVerificationToken");

    if (!updatedUser) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                isAddressHidden: updatedUser.isAddressHidden,
                address: updatedUser.isAddressHidden ? null : updatedUser.address
            },
            `Address ${isHidden ? 'hidden' : 'visible'} successfully`
        )
    );
});

// Track search - increment search count or create new entry
const trackSearch = asyncHandler(async (req, res) => {
    const { keyword } = req.body;

    if (!keyword || !keyword.trim()) {
        throw new ApiError(400, "Keyword is required");
    }

    const normalizedKeyword = keyword.trim().toLowerCase();

    try {
        // Check if the keyword already exists in SearchSuggestion
        const existingSuggestion = await SearchSuggestion.findOne({
            keyword: normalizedKeyword
        });

        if (existingSuggestion) {
            // Increment search count and update last searched
            existingSuggestion.searchCount += 1;
            existingSuggestion.lastSearched = new Date();
            await existingSuggestion.save();
        } else {
            // Create new entry
            await SearchSuggestion.create({
                keyword: normalizedKeyword,
                searchCount: 1,
                lastSearched: new Date()
            });
        }

        return res.status(200).json(
            new ApiResponse(200, null, "Search tracked successfully")
        );
    } catch (error) {
        console.error("Error tracking search:", error);
        throw new ApiError(500, "Failed to track search");
    }
});

// Get popular searches sorted by search count
const getPopularSearches = asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;

    try {
        const popularSearches = await SearchSuggestion.find({})
            .sort({ searchCount: -1, lastSearched: -1 })
            .limit(limit)
            .select('keyword searchCount');

        const formattedResults = popularSearches.map(search => ({
            keyword: search.keyword,
            searchCount: search.searchCount
        }));

        return res.status(200).json(
            new ApiResponse(200, formattedResults, "Popular searches retrieved successfully")
        );
    } catch (error) {
        console.error("Error fetching popular searches:", error);
        throw new ApiError(500, "Failed to fetch popular searches");
    }
});

export {
    registerUser,
    loginUser,
    logOutUser,
    getUserProfile,
    updateUserProfile,
    changePassword,
    deleteAccount,
    searchUsers,
    verifyEmailWithOTP,
    sendVerificationOTPForEmail,
    uploadProfileImage,
    sendPasswordResetOTP,
    resetPasswordWithOTP,
    getOtherUserProfile,
    checkTokenExpiry,
    togglePhoneNumberVisibility,
    toggleAddressVisibility,
    trackSearch,
    getPopularSearches
};
