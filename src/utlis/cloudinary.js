import dotenv from 'dotenv';
dotenv.config();

import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";


cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});


export const uploadBufferToCloudinary = (fileBuffer, folder = "posts") => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: "auto",
                folder: folder,
            },
            (error, result) => {
                if (error) return reject(error);
                return resolve(result);
            }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
    });
};

// Helper function to extract public_id and resource type from Cloudinary URL
const extractCloudinaryInfoFromUrl = (url) => {
    try {
        const urlParts = url.split("/");
        const uploadIdx = urlParts.findIndex(part => part === "upload");

        if (uploadIdx === -1) {
            throw new Error("Invalid Cloudinary URL - missing 'upload' segment");
        }

        // Get resource type from URL (it's the segment before 'upload')
        const resourceType = urlParts[uploadIdx - 1];

        // Skip version number if present (starts with 'v' followed by numbers)
        let startIdx = uploadIdx + 1;
        if (urlParts[startIdx] && urlParts[startIdx].match(/^v\d+$/)) {
            startIdx += 1;
        }

        let publicIdWithExt = urlParts.slice(startIdx).join("/");

        // Remove file extension
        const lastDot = publicIdWithExt.lastIndexOf(".");
        const publicId = lastDot !== -1 ? publicIdWithExt.substring(0, lastDot) : publicIdWithExt;

        return { publicId, resourceType };
    } catch (error) {
        throw new Error(`Invalid Cloudinary URL format: ${url}`);
    }
};

// Delete single file from Cloudinary
export const deleteFromCloudinary = async (url, resourceType = null) => {
    try {
        const { publicId, resourceType: detectedType } = extractCloudinaryInfoFromUrl(url);

        // Use provided resource type or detected type, default to 'image'
        const finalResourceType = resourceType || detectedType || 'image';

        // Validate resource type
        const validTypes = ['image', 'video', 'raw', 'auto'];
        if (!validTypes.includes(finalResourceType)) {
            throw new Error(`Invalid resource type: ${finalResourceType}`);
        }

        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: finalResourceType === 'auto' ? 'image' : finalResourceType
        });

        return result;
    } catch (error) {
        throw new Error(`Failed to delete from Cloudinary: ${error.message}`);
    }
};

// Helper function to check if URL is a dynamically generated thumbnail (should be skipped)
const isDynamicThumbnail = (url) => {
    if (!url.includes('/upload/')) return false;

    const uploadPart = url.split('/upload/')[1];
    // Check if there are transformation parameters (contains commas and not just version)
    const hasTransformations = uploadPart.includes(',') && !uploadPart.startsWith('v');

    // If it has transformations and ends with different extension than original, it's dynamic
    return hasTransformations && (url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png'));
};

// Helper function to determine resource type from URL
const getResourceTypeForUrl = (url) => {
    try {
        // Extract resource type from URL path
        const { resourceType } = extractCloudinaryInfoFromUrl(url);
        return resourceType;
    } catch (error) {
        // Fallback: determine by file extension
        if (url.endsWith('.mp4') || url.endsWith('.mov') || url.endsWith('.webm') || url.endsWith('.avi')) {
            return 'video';
        } else if (url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png') || url.endsWith('.gif') || url.endsWith('.webp')) {
            return 'image';
        }
        return 'image'; // Default fallback
    }
};

// Delete multiple files from Cloudinary
export const deleteMultipleFromCloudinary = async (urls) => {
    const results = [];
    const errors = [];

    for (const url of urls) {
        try {
            // Skip dynamically generated thumbnails (they're not stored as separate resources)
            if (isDynamicThumbnail(url)) {
                results.push({
                    url,
                    success: true,
                    result: { result: 'skipped - dynamic thumbnail' },
                    skipped: true
                });
                continue;
            }

            // Determine the appropriate resource type for this URL
            const resourceType = getResourceTypeForUrl(url);
            const result = await deleteFromCloudinary(url, resourceType);
            results.push({ url, success: true, result });
        } catch (error) {
            results.push({ url, success: false, error: error.message });
            errors.push({ url, error: error.message });
        }
    }

    return {
        results,
        errors,
        totalDeleted: results.filter(r => r.success && !r.skipped).length,
        totalSkipped: results.filter(r => r.skipped).length
    };
};

export { cloudinary };