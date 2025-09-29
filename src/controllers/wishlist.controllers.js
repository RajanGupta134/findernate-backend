import { Wishlist } from "../models/wishlist.models.js";
import Product from "../models/product.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import mongoose from "mongoose";

// ✅ POST /api/v1/wishlist/:productId - Add product to wishlist
const addToWishlist = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const userId = req.user._id;
    const { notes } = req.body;

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    // Check if product exists and is active
    const product = await Product.findById(productId).select('name status isActive');
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    if (product.status !== 'active' || !product.isActive) {
        throw new ApiError(400, "Product is not available for wishlist");
    }

    // Check if already in wishlist
    const existingWishlistItem = await Wishlist.findOne({ userId, productId });
    if (existingWishlistItem) {
        throw new ApiError(409, "Product is already in your wishlist");
    }

    // Create wishlist item
    const wishlistItem = await Wishlist.create({
        userId,
        productId,
        notes: notes?.trim() || undefined
    });

    // Update product wishlist count
    await Product.findByIdAndUpdate(productId, {
        $inc: { wishlistCount: 1 }
    });

    const populatedWishlistItem = await Wishlist.findById(wishlistItem._id)
        .populate('productId', 'name price images averageRating currency')
        .lean();

    return res.status(201).json(
        new ApiResponse(201, populatedWishlistItem, "Product added to wishlist successfully")
    );
});

// ✅ DELETE /api/v1/wishlist/:productId - Remove product from wishlist
const removeFromWishlist = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const userId = req.user._id;

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    // Find and remove wishlist item
    const wishlistItem = await Wishlist.findOneAndDelete({ userId, productId });
    if (!wishlistItem) {
        throw new ApiError(404, "Product not found in your wishlist");
    }

    // Update product wishlist count
    await Product.findByIdAndUpdate(productId, {
        $inc: { wishlistCount: -1 }
    });

    return res.status(200).json(
        new ApiResponse(200, { productId }, "Product removed from wishlist successfully")
    );
});

// ✅ GET /api/v1/wishlist - Get user's wishlist
const getWishlistItems = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 20, sortBy = 'addedAt', sortOrder = 'desc' } = req.query;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Get wishlist items with product details
    const wishlistItems = await Wishlist.find({ userId })
        .populate({
            path: 'productId',
            select: 'name slug price comparePrice images averageRating totalReviews currency brand category status isActive discountPercentage',
            match: { status: 'active', isActive: true } // Only include active products
        })
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

    // Filter out items where product was deleted or inactive
    const validWishlistItems = wishlistItems.filter(item => item.productId);

    // Get total count for pagination
    const totalItems = await Wishlist.countDocuments({ userId });
    const totalPages = Math.ceil(totalItems / limit);

    // If there are invalid items (deleted products), clean them up
    const invalidItems = wishlistItems.filter(item => !item.productId);
    if (invalidItems.length > 0) {
        const invalidIds = invalidItems.map(item => item._id);
        await Wishlist.deleteMany({ _id: { $in: invalidIds } });
    }

    const pagination = {
        currentPage: parseInt(page),
        totalPages,
        totalItems: validWishlistItems.length,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
    };

    return res.status(200).json(
        new ApiResponse(200, {
            wishlistItems: validWishlistItems,
            pagination
        }, "Wishlist retrieved successfully")
    );
});

// ✅ GET /api/v1/wishlist/check/:productId - Check if product is in wishlist
const checkProductInWishlist = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const userId = req.user._id;

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    const wishlistItem = await Wishlist.findOne({ userId, productId }).select('_id');
    const inWishlist = !!wishlistItem;

    return res.status(200).json(
        new ApiResponse(200, { inWishlist, productId }, "Wishlist status checked successfully")
    );
});

// ✅ DELETE /api/v1/wishlist - Clear entire wishlist
const clearWishlist = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Get all wishlist items to update product counts
    const wishlistItems = await Wishlist.find({ userId }).select('productId');
    const productIds = wishlistItems.map(item => item.productId);

    // Remove all wishlist items
    const result = await Wishlist.deleteMany({ userId });

    // Update product wishlist counts
    if (productIds.length > 0) {
        await Product.updateMany(
            { _id: { $in: productIds } },
            { $inc: { wishlistCount: -1 } }
        );
    }

    return res.status(200).json(
        new ApiResponse(200, { removedCount: result.deletedCount }, "Wishlist cleared successfully")
    );
});

// ✅ GET /api/v1/wishlist/stats - Get wishlist statistics
const getWishlistStats = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const stats = await Wishlist.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
            $lookup: {
                from: 'products',
                localField: 'productId',
                foreignField: '_id',
                as: 'product'
            }
        },
        { $unwind: '$product' },
        { $match: { 'product.status': 'active', 'product.isActive': true } },
        {
            $group: {
                _id: null,
                totalItems: { $sum: 1 },
                totalValue: { $sum: '$product.price' },
                avgPrice: { $avg: '$product.price' },
                categories: { $addToSet: '$product.category' },
                brands: { $addToSet: '$product.brand' }
            }
        }
    ]);

    const result = stats[0] || {
        totalItems: 0,
        totalValue: 0,
        avgPrice: 0,
        categories: [],
        brands: []
    };

    return res.status(200).json(
        new ApiResponse(200, {
            totalItems: result.totalItems,
            totalValue: result.totalValue,
            averagePrice: result.avgPrice,
            uniqueCategories: result.categories.length,
            uniqueBrands: result.brands.filter(brand => brand).length
        }, "Wishlist statistics retrieved successfully")
    );
});

export {
    addToWishlist,
    removeFromWishlist,
    getWishlistItems,
    checkProductInWishlist,
    clearWishlist,
    getWishlistStats
};