import { v2 as cloudinary } from "cloudinary";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import { uploadBufferToCloudinary } from "../utlis/cloudinary.js";
import { User } from "../models/user.models.js";

// Upload single media file (image or video)
const uploadSingleMedia = asyncHandler(async (req, res) => {
    const { file } = req;
    const userId = req.user?._id;

    if (!file) {
        throw new ApiError(400, "No file uploaded");
    }

    if (!userId) {
        throw new ApiError(401, "User authentication required");
    }

    // Check file type
    const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const allowedVideoTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'];
    const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];

    if (!allowedTypes.includes(file.mimetype)) {
        throw new ApiError(400, "Invalid file type. Only images and videos are allowed");
    }

    // Check file size (50MB limit)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
        throw new ApiError(400, "File size too large. Maximum size is 50MB");
    }

    try {
        // Determine folder based on file type
        const isVideo = allowedVideoTypes.includes(file.mimetype);
        const folder = isVideo ? "videos" : "images";

        // Upload to Cloudinary
        const result = await uploadBufferToCloudinary(file.buffer, folder);

        // Get user details
        const user = await User.findById(userId).select("-password -refreshToken");

        // Return success response with file details and user info
        return res.status(200).json(
            new ApiResponse(200, {
                public_id: result.public_id,
                secure_url: result.secure_url,
                format: result.format,
                resource_type: result.resource_type,
                bytes: result.bytes,
                width: result.width,
                height: result.height,
                duration: result.duration, // for videos
                folder: folder,
                original_name: file.originalname,
                mimetype: file.mimetype,
                uploaded_by: {
                    _id: user._id,
                    username: user.username,
                    fullName: user.fullName,
                    email: user.email,
                    profileImageUrl: user.profileImageUrl,
                    isBusinessProfile: user.isBusinessProfile
                },
                uploaded_at: new Date().toISOString()
            }, "Media uploaded successfully")
        );
    } catch (error) {
        throw new ApiError(500, "Error uploading file to Cloudinary", [error.message]);
    }
});

// Upload multiple media files
const uploadMultipleMedia = asyncHandler(async (req, res) => {
    const { files } = req;
    const userId = req.user?._id;

    if (!files || files.length === 0) {
        throw new ApiError(400, "No files uploaded");
    }

    if (!userId) {
        throw new ApiError(401, "User authentication required");
    }

    const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const allowedVideoTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'];
    const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];
    const maxSize = 50 * 1024 * 1024; // 50MB

    const uploadedFiles = [];
    const errors = [];

    for (const file of files) {
        try {
            // Validate file type
            if (!allowedTypes.includes(file.mimetype)) {
                errors.push({
                    filename: file.originalname,
                    error: "Invalid file type. Only images and videos are allowed"
                });
                continue;
            }

            // Validate file size
            if (file.size > maxSize) {
                errors.push({
                    filename: file.originalname,
                    error: "File size too large. Maximum size is 50MB"
                });
                continue;
            }

            // Determine folder based on file type
            const isVideo = allowedVideoTypes.includes(file.mimetype);
            const folder = isVideo ? "videos" : "images";

            // Upload to Cloudinary
            const result = await uploadBufferToCloudinary(file.buffer, folder);

            uploadedFiles.push({
                public_id: result.public_id,
                secure_url: result.secure_url,
                format: result.format,
                resource_type: result.resource_type,
                bytes: result.bytes,
                width: result.width,
                height: result.height,
                duration: result.duration,
                folder: folder,
                original_name: file.originalname,
                mimetype: file.mimetype,
                uploaded_by: {
                    _id: req.user._id,
                    username: req.user.username,
                    fullName: req.user.fullName,
                    email: req.user.email,
                    profileImageUrl: req.user.profileImageUrl,
                    isBusinessProfile: req.user.isBusinessProfile
                },
                uploaded_at: new Date().toISOString()
            });
        } catch (error) {
            errors.push({
                filename: file.originalname,
                error: error.message
            });
        }
    }

    return res.status(200).json(
        new ApiResponse(200, {
            uploaded_files: uploadedFiles,
            errors: errors,
            total_files: files.length,
            successful_uploads: uploadedFiles.length,
            failed_uploads: errors.length
        }, "Multiple media upload completed")
    );
});

// Delete media from Cloudinary
const deleteMedia = asyncHandler(async (req, res) => {
    const { public_id, resource_type = "auto" } = req.body;
    const userId = req.user?._id;

    if (!public_id) {
        throw new ApiError(400, "Public ID is required");
    }

    if (!userId) {
        throw new ApiError(401, "User authentication required");
    }

    try {
        const result = await cloudinary.uploader.destroy(public_id, {
            resource_type: resource_type
        });

        if (result.result === "ok") {
            return res.status(200).json(
                new ApiResponse(200, {
                    public_id: public_id,
                    deleted: true,
                    deleted_by: {
                        _id: req.user._id,
                        username: req.user.username,
                        fullName: req.user.fullName,
                        email: req.user.email
                    },
                    deleted_at: new Date().toISOString()
                }, "Media deleted successfully")
            );
        } else {
            throw new ApiError(400, "Failed to delete media from Cloudinary");
        }
    } catch (error) {
        throw new ApiError(500, "Error deleting media from Cloudinary", [error.message]);
    }
});

// Delete multiple media files
const deleteMultipleMedia = asyncHandler(async (req, res) => {
    const { public_ids, resource_type = "auto" } = req.body;
    const userId = req.user?._id;

    if (!public_ids || !Array.isArray(public_ids) || public_ids.length === 0) {
        throw new ApiError(400, "Public IDs array is required");
    }

    if (!userId) {
        throw new ApiError(401, "User authentication required");
    }

    const results = [];
    const errors = [];

    for (const public_id of public_ids) {
        try {
            const result = await cloudinary.uploader.destroy(public_id, {
                resource_type: resource_type
            });

            if (result.result === "ok") {
                results.push({
                    public_id: public_id,
                    deleted: true,
                    deleted_by: {
                        _id: req.user._id,
                        username: req.user.username,
                        fullName: req.user.fullName,
                        email: req.user.email
                    },
                    deleted_at: new Date().toISOString()
                });
            } else {
                errors.push({
                    public_id: public_id,
                    error: "Failed to delete"
                });
            }
        } catch (error) {
            errors.push({
                public_id: public_id,
                error: error.message
            });
        }
    }

    return res.status(200).json(
        new ApiResponse(200, {
            deleted_files: results,
            errors: errors,
            total_files: public_ids.length,
            successful_deletions: results.length,
            failed_deletions: errors.length
        }, "Multiple media deletion completed")
    );
});

// Get media information
const getMediaInfo = asyncHandler(async (req, res) => {
    const { public_id, resource_type = "auto" } = req.query;
    const userId = req.user?._id;

    if (!public_id) {
        throw new ApiError(400, "Public ID is required");
    }

    if (!userId) {
        throw new ApiError(401, "User authentication required");
    }

    try {
        const result = await cloudinary.api.resource(public_id, {
            resource_type: resource_type
        });

        return res.status(200).json(
            new ApiResponse(200, {
                public_id: result.public_id,
                secure_url: result.secure_url,
                format: result.format,
                resource_type: result.resource_type,
                bytes: result.bytes,
                width: result.width,
                height: result.height,
                duration: result.duration,
                created_at: result.created_at,
                tags: result.tags || [],
                requested_by: {
                    _id: req.user._id,
                    username: req.user.username,
                    fullName: req.user.fullName,
                    email: req.user.email
                },
                requested_at: new Date().toISOString()
            }, "Media information retrieved successfully")
        );
    } catch (error) {
        throw new ApiError(404, "Media not found or error retrieving information", [error.message]);
    }
});

export {
    uploadSingleMedia,
    uploadMultipleMedia,
    deleteMedia,
    deleteMultipleMedia,
    getMediaInfo,
};
