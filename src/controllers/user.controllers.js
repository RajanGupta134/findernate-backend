import { asyncHandler } from "../utlis/asyncHandler.js";
import { User } from "../models/user.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../utlis/sendEmail.js"
import { uploadBufferToCloudinary } from "../utlis/cloudinary.js";
import { TempUser } from "../models/tempUser.models.js";
import Follower from "../models/follower.models.js";
import mongoose from "mongoose";




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

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    const user = await TempUser.create({
        fullName,
        fullNameLower: fullName.toLowerCase(),
        username: username.toLowerCase(),
        email,
        password,
        phoneNumber,
        dateOfBirth,
        gender,
        emailOTP: otp,
        emailOTPExpiry: expiry
    });

    await sendEmail({
        to: user.email,
        subject: "verify your email - FinderNate",
        html: `
                <h3>Email verification OTP</h3>
                <h2>Your OTP is: <b>${otp}</b></h2>
                <p>This OTP is valid for 10 minutes.</p>
                <p>If you did not request this, please ignore this email.</p>`
    });

    return res.status(201).json(
        new ApiResponse(200, null, "OTP sent to your email. Please verify your email to complete registration")
    );
});

const verifyAndRegisterUser = asyncHandler(async (req, res) => {
    const { otp } = req.body;

    const tempUser = await TempUser.findOne({ emailOTP: otp });

    if (!tempUser) {
        throw new ApiError(404, "No user found.");
    }

    if (tempUser.emailOTPExpiry < new Date()) {
        throw new ApiError(400, "OTP has expired");
    }

    const user = await User.create({
        uid: uuidv4(),
        fullName: tempUser.fullName,
        fullNameLower: tempUser.fullName.toLowerCase(),
        username: tempUser.username.toLowerCase(),
        email: tempUser.email,
        password: tempUser.password,
        phoneNumber: tempUser.phoneNumber,
        dateOfBirth: tempUser.dateOfBirth,
        gender: tempUser.gender,
        isEmailVerified: true,
    });

    await tempUser.deleteOne();

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

// const getUserProfile = asyncHandler(async (req, res) => {
//     const userId = req.user._id;
//     const user = await User.findById(userId).select(
//         "username fullName email phoneNumber gender dateOfBirth bio profileImageUrl location link followers following posts isBusinessProfile isEmailVerified isPhoneVerified createdAt"
//     );
//     if (!user) {
//         throw new ApiError(404, "User not found");
//     }

//     // Convert arrays to counts
//     const userProfile = {
//         ...user.toObject(),
//         followersCount: user.followers ? user.followers.length : 0,
//         followingCount: user.following ? user.following.length : 0,
//         postsCount: user.posts ? user.posts.length : 0
//     };

//     // Remove the original arrays
//     delete userProfile.followers;
//     delete userProfile.following;
//     delete userProfile.posts;

//     return res
//         .status(200)
//         .json(
//             new ApiResponse(200, userProfile, "User profile retrieved successfully")
//         )
// });
    const getUserProfile = asyncHandler(async (req, res) => {
        const userId = req.user._id;

        const user = await User.findById(userId).select(
            "username fullName email phoneNumber gender dateOfBirth bio profileImageUrl location link followers following posts isBusinessProfile isEmailVerified isPhoneVerified createdAt"
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
                phoneNumber: user.phoneNumber,
                dateOfBirth: user.dateOfBirth,
                gender: user.gender,
                isBusinessProfile: user.isBusinessProfile,
                isEmailVerified: user.isEmailVerified,
                isPhoneVerified: user.isPhoneVerified,
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
    user.refreshToken = null;

    await user.save({ validateBeforeSave: false });
    await user.deleteOne();

    return res
        .status(200)
        .clearCookie("accessToken")
        .clearCookie("refreshToken")
        .json(
            new ApiResponse(
                200,
                {},
                "Account deleted Successfully"
            )
        )

});

const searchUsers = asyncHandler(async (req, res) => {
    const { query } = req.query;

    if (!query || query.trim() == "") {
        throw new ApiError(400, "Search query is required");
    }

    const user = await User.find({
        accountStatus: "active",
        $or: [
            { username: new RegExp(query, "i") },
            { fullNameLower: new RegExp(query, "i") }
        ]
    }).select("username fullName profileImageUrl");

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

    // Prepare user data with counts
    const userWithCounts = {
        _id: targetUser._id,
        username: targetUser.username,
        email: targetUser.email,
        fullName: targetUser.fullName,
        phoneNumber: targetUser.phoneNumber || "",
        dateOfBirth: targetUser.dateOfBirth || "",
        gender: targetUser.gender || "",
        isBusinessProfile: targetUser.isBusinessProfile,
        isEmailVerified: targetUser.isEmailVerified,
        isPhoneVerified: targetUser.isPhoneVerified,
        bio: targetUser.bio || "",
        link: targetUser.link || "",
        location: targetUser.location || "",
        profileImageUrl: targetUser.profileImageUrl || "",
        followersCount,
        followingCount,
        postsCount
    };

    const responseData = {
        _id: targetUser._id,
        isFollowedBy: isFollowing ? "True" : "False",
        userId: userWithCounts
    };

    return res.status(200).json(
        new ApiResponse(200, responseData, "User profile retrieved successfully")
    );
});

export {
    registerUser,
    verifyAndRegisterUser,
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
    getOtherUserProfile
};
