import Product from "../models/product.models.js";
import { User } from "../models/user.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import { uploadBufferToBunny } from "../utlis/bunny.js";
import mongoose from "mongoose";
import fs from "fs";


// Helper function to check if user can manage product images
const checkImagePermission = async (userId, productId) => {
    const user = await User.findById(userId);

    if (user.role === 'admin') {
        return true;
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    if (product.sellerId.toString() !== userId.toString()) {
        throw new ApiError(403, "You can only manage images for your own products");
    }

    return true;
};

// ✅ POST /api/v1/products/:productId/images - Upload product images
const uploadProductImages = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    await checkImagePermission(userId, productId);

    if (!req.files || req.files.length === 0) {
        throw new ApiError(400, "No images provided");
    }

    if (req.files.length > 10) {
        throw new ApiError(400, "Maximum 10 images allowed per upload");
    }

    const product = await Product.findById(productId);

    // Check total image limit
    const currentImageCount = product.images.length;
    if (currentImageCount + req.files.length > 20) {
        throw new ApiError(400, `Maximum 20 images allowed per product. Current: ${currentImageCount}`);
    }

    const uploadedImages = [];
    const uploadErrors = [];

    try {
        for (const file of req.files) {
            try {
                // Validate image type
                const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
                if (!allowedTypes.includes(file.mimetype)) {
                    uploadErrors.push({
                        fileName: file.originalname,
                        error: "Invalid file type. Only JPEG, PNG, and WebP are allowed."
                    });
                    continue;
                }

                // Validate file size (5MB limit)
                if (file.size > 5 * 1024 * 1024) {
                    uploadErrors.push({
                        fileName: file.originalname,
                        error: "File size too large. Maximum 5MB allowed."
                    });
                    continue;
                }

                // Read file buffer and upload to Bunny CDN
                const fileBuffer = fs.readFileSync(file.path);
                const uploadResult = await uploadBufferToBunny(fileBuffer, 'products', file.originalname);
                const imageUrl = uploadResult.secure_url;

                const imageData = {
                    url: imageUrl,
                    alt: req.body.alt || product.name,
                    isPrimary: product.images.length === 0 && uploadedImages.length === 0, // First image is primary
                    sortOrder: product.images.length + uploadedImages.length
                };

                uploadedImages.push(imageData);

                // Clean up temporary file
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }

            } catch (uploadError) {
                uploadErrors.push({
                    fileName: file.originalname,
                    error: uploadError.message
                });
            }
        }

        // Add successfully uploaded images to product
        if (uploadedImages.length > 0) {
            product.images.push(...uploadedImages);
            await product.save();
        }

        return res.status(201).json(
            new ApiResponse(201, {
                uploadedImages,
                uploadErrors,
                summary: {
                    total: req.files.length,
                    successful: uploadedImages.length,
                    failed: uploadErrors.length
                }
            }, "Image upload completed")
        );

    } catch (error) {
        // Clean up any temporary files
        req.files.forEach(file => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        });
        throw error;
    }
});

// ✅ PUT /api/v1/products/:productId/images/:imageIndex - Update image details
const updateProductImage = asyncHandler(async (req, res) => {
    const { productId, imageIndex } = req.params;
    const { alt, isPrimary, sortOrder } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    await checkImagePermission(userId, productId);

    const product = await Product.findById(productId);
    const index = parseInt(imageIndex);

    if (index < 0 || index >= product.images.length) {
        throw new ApiError(400, "Invalid image index");
    }

    // Update image properties
    if (alt !== undefined) {
        product.images[index].alt = alt;
    }

    if (sortOrder !== undefined) {
        product.images[index].sortOrder = parseInt(sortOrder);
    }

    // Handle primary image setting
    if (isPrimary === true) {
        // Remove primary flag from all images
        product.images.forEach(img => img.isPrimary = false);
        // Set current image as primary
        product.images[index].isPrimary = true;
    }

    await product.save();

    return res.status(200).json(
        new ApiResponse(200, product.images[index], "Image updated successfully")
    );
});

// ✅ DELETE /api/v1/products/:productId/images/:imageIndex - Delete product image
const deleteProductImage = asyncHandler(async (req, res) => {
    const { productId, imageIndex } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    await checkImagePermission(userId, productId);

    const product = await Product.findById(productId);
    const index = parseInt(imageIndex);

    if (index < 0 || index >= product.images.length) {
        throw new ApiError(400, "Invalid image index");
    }

    const deletedImage = product.images[index];

    // Remove image from array
    product.images.splice(index, 1);

    // If deleted image was primary and there are other images, make first one primary
    if (deletedImage.isPrimary && product.images.length > 0) {
        product.images[0].isPrimary = true;
    }

    await product.save();

    // TODO: Delete image from storage (Bunny CDN)
    // You might want to implement a cleanup job for this

    return res.status(200).json(
        new ApiResponse(200, null, "Image deleted successfully")
    );
});

// ✅ PUT /api/v1/products/:productId/images/reorder - Reorder product images
const reorderProductImages = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { imageOrder } = req.body; // Array of image indices in new order
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    await checkImagePermission(userId, productId);

    if (!Array.isArray(imageOrder)) {
        throw new ApiError(400, "Image order must be an array");
    }

    const product = await Product.findById(productId);

    if (imageOrder.length !== product.images.length) {
        throw new ApiError(400, "Image order array length must match number of images");
    }

    // Validate all indices are valid
    const maxIndex = product.images.length - 1;
    for (const index of imageOrder) {
        if (index < 0 || index > maxIndex) {
            throw new ApiError(400, "Invalid image index in order array");
        }
    }

    // Reorder images
    const reorderedImages = imageOrder.map(index => product.images[index]);

    // Update sort order
    reorderedImages.forEach((image, newIndex) => {
        image.sortOrder = newIndex;
    });

    product.images = reorderedImages;
    await product.save();

    return res.status(200).json(
        new ApiResponse(200, product.images, "Images reordered successfully")
    );
});

// ✅ GET /api/v1/products/:productId/images - Get all product images
const getProductImages = asyncHandler(async (req, res) => {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    const product = await Product.findById(productId).select('images name');

    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Sort images by sortOrder
    const sortedImages = product.images.sort((a, b) => a.sortOrder - b.sortOrder);

    return res.status(200).json(
        new ApiResponse(200, {
            productId: product._id,
            productName: product.name,
            images: sortedImages,
            totalImages: sortedImages.length
        }, "Product images retrieved successfully")
    );
});

// ✅ POST /api/v1/products/:productId/images/:imageIndex/set-primary - Set image as primary
const setPrimaryImage = asyncHandler(async (req, res) => {
    const { productId, imageIndex } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    await checkImagePermission(userId, productId);

    const product = await Product.findById(productId);
    const index = parseInt(imageIndex);

    if (index < 0 || index >= product.images.length) {
        throw new ApiError(400, "Invalid image index");
    }

    // Remove primary flag from all images
    product.images.forEach(img => img.isPrimary = false);

    // Set selected image as primary
    product.images[index].isPrimary = true;

    await product.save();

    return res.status(200).json(
        new ApiResponse(200, product.images[index], "Primary image set successfully")
    );
});

export {
    uploadProductImages,
    updateProductImage,
    deleteProductImage,
    reorderProductImages,
    getProductImages,
    setPrimaryImage
};
