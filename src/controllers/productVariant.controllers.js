import Product from "../models/product.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import mongoose from "mongoose";

// Helper function to generate variant SKU
const generateVariantSKU = (productSKU, variantAttributes) => {
    const variantCode = variantAttributes
        .map(attr => attr.value.substring(0, 2).toUpperCase())
        .join('');
    const timestamp = Date.now().toString().slice(-3);
    return `${productSKU}-${variantCode}${timestamp}`;
};

// ✅ POST /api/v1/products/:productId/variants - Add product variant
const addProductVariant = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const {
        name,
        value,
        price = 0,
        stock = 0,
        weight,
        dimensions,
        images = [],
        attributes = [],
        isActive = true
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Check ownership
    if (product.sellerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        throw new ApiError(403, "You can only add variants to your own products");
    }

    // Generate unique SKU for variant
    const sku = generateVariantSKU(product.sku, attributes.length > 0 ? attributes : [{ value }]);

    // Check if variant SKU already exists
    const existingVariant = await Product.findOne({
        "variants.sku": sku
    });

    if (existingVariant) {
        throw new ApiError(400, "Variant with this combination already exists");
    }

    const newVariant = {
        sku,
        name,
        value,
        price,
        stock,
        weight,
        dimensions,
        images,
        attributes,
        isActive,
        sortOrder: product.variants.length
    };

    product.variants.push(newVariant);
    await product.save();

    return res.status(201).json(
        new ApiResponse(201, product, "Product variant added successfully")
    );
});

// ✅ PUT /api/v1/products/:productId/variants/:variantId - Update product variant
const updateProductVariant = asyncHandler(async (req, res) => {
    const { productId, variantId } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(variantId)) {
        throw new ApiError(400, "Invalid product or variant ID");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Check ownership
    if (product.sellerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        throw new ApiError(403, "You can only update variants of your own products");
    }

    const variantIndex = product.variants.findIndex(v => v._id.toString() === variantId);
    if (variantIndex === -1) {
        throw new ApiError(404, "Variant not found");
    }

    // Update variant fields
    const allowedUpdates = ['name', 'value', 'price', 'stock', 'weight', 'dimensions', 'images', 'attributes', 'isActive'];
    allowedUpdates.forEach(field => {
        if (updates[field] !== undefined) {
            product.variants[variantIndex][field] = updates[field];
        }
    });

    await product.save();

    return res.status(200).json(
        new ApiResponse(200, product, "Product variant updated successfully")
    );
});

// ✅ DELETE /api/v1/products/:productId/variants/:variantId - Delete product variant
const deleteProductVariant = asyncHandler(async (req, res) => {
    const { productId, variantId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(variantId)) {
        throw new ApiError(400, "Invalid product or variant ID");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Check ownership
    if (product.sellerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        throw new ApiError(403, "You can only delete variants from your own products");
    }

    const variantIndex = product.variants.findIndex(v => v._id.toString() === variantId);
    if (variantIndex === -1) {
        throw new ApiError(404, "Variant not found");
    }

    product.variants.splice(variantIndex, 1);
    await product.save();

    return res.status(200).json(
        new ApiResponse(200, product, "Product variant deleted successfully")
    );
});

// ✅ GET /api/v1/products/:productId/variants - Get all variants of a product
const getProductVariants = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { includeInactive = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    const product = await Product.findById(productId).select('variants name sku');
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    let variants = product.variants;

    // Filter out inactive variants if not requested
    if (!includeInactive) {
        variants = variants.filter(variant => variant.isActive);
    }

    return res.status(200).json(
        new ApiResponse(200, {
            productId,
            productName: product.name,
            productSKU: product.sku,
            variants: variants.sort((a, b) => a.sortOrder - b.sortOrder)
        }, "Product variants retrieved successfully")
    );
});

// ✅ GET /api/v1/products/variants/by-sku/:sku - Get variant by SKU
const getVariantBySKU = asyncHandler(async (req, res) => {
    const { sku } = req.params;

    const product = await Product.findOne(
        { "variants.sku": sku.toUpperCase() },
        {
            name: 1,
            sku: 1,
            price: 1,
            "variants.$": 1
        }
    );

    if (!product || !product.variants.length) {
        throw new ApiError(404, "Variant not found");
    }

    const variant = product.variants[0];
    const finalPrice = product.price + (variant.price || 0);

    return res.status(200).json(
        new ApiResponse(200, {
            product: {
                id: product._id,
                name: product.name,
                sku: product.sku,
                basePrice: product.price
            },
            variant: {
                ...variant.toObject(),
                finalPrice,
                displayPrice: {
                    amount: finalPrice,
                    formatted: `₹${finalPrice.toLocaleString()}`
                }
            }
        }, "Variant retrieved successfully")
    );
});

// ✅ PUT /api/v1/products/:productId/variants/reorder - Reorder variants
const reorderVariants = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { variantIds } = req.body; // Array of variant IDs in desired order

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    if (!Array.isArray(variantIds)) {
        throw new ApiError(400, "variantIds must be an array");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Check ownership
    if (product.sellerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        throw new ApiError(403, "You can only reorder variants of your own products");
    }

    // Update sort order based on provided array
    variantIds.forEach((variantId, index) => {
        const variant = product.variants.id(variantId);
        if (variant) {
            variant.sortOrder = index;
        }
    });

    await product.save();

    return res.status(200).json(
        new ApiResponse(200, product, "Variants reordered successfully")
    );
});

// ✅ POST /api/v1/products/:productId/variants/bulk-update-stock - Bulk update variant stock
const bulkUpdateVariantStock = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { updates } = req.body; // Array of { variantId, stock }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    if (!Array.isArray(updates)) {
        throw new ApiError(400, "updates must be an array");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Check ownership
    if (product.sellerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        throw new ApiError(403, "You can only update stock for your own products");
    }

    let updatedCount = 0;

    updates.forEach(({ variantId, stock }) => {
        const variant = product.variants.id(variantId);
        if (variant && stock >= 0) {
            variant.stock = stock;
            updatedCount++;
        }
    });

    if (updatedCount > 0) {
        await product.save();
    }

    return res.status(200).json(
        new ApiResponse(200, {
            product,
            updatedVariants: updatedCount,
            totalVariants: updates.length
        }, `${updatedCount} variants updated successfully`)
    );
});

export {
    addProductVariant,
    updateProductVariant,
    deleteProductVariant,
    getProductVariants,
    getVariantBySKU,
    reorderVariants,
    bulkUpdateVariantStock
};