import { Cart } from "../models/cart.models.js";
import Product from "../models/product.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import mongoose from "mongoose";

// Helper function to find product and variant details
const getProductDetails = async (productId, variantId = null) => {
    const product = await Product.findById(productId).select('name price currency images sku variants status isActive stock');

    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    if (product.status !== 'active' || !product.isActive) {
        throw new ApiError(400, "Product is not available");
    }

    let variant = null;
    let finalPrice = product.price;
    let availableStock = product.stock;

    if (variantId) {
        variant = product.variants.id(variantId);
        if (!variant) {
            throw new ApiError(404, "Product variant not found");
        }
        if (!variant.isActive) {
            throw new ApiError(400, "Product variant is not available");
        }
        finalPrice = product.price + (variant.price || 0);
        availableStock = variant.stock || 0;
    }

    return {
        product,
        variant,
        finalPrice,
        availableStock
    };
};

// ✅ POST /api/v1/cart/add - Add item to cart
const addToCart = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { productId, variantId, quantity = 1 } = req.body;

    // Validate inputs
    if (!productId) {
        throw new ApiError(400, "Product ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    if (variantId && !mongoose.Types.ObjectId.isValid(variantId)) {
        throw new ApiError(400, "Invalid variant ID");
    }

    if (quantity < 1 || quantity > 99) {
        throw new ApiError(400, "Quantity must be between 1 and 99");
    }

    // Get product and variant details
    const { product, variant, finalPrice, availableStock } = await getProductDetails(productId, variantId);

    // Check stock availability
    if (quantity > availableStock) {
        throw new ApiError(400, `Only ${availableStock} items available in stock`);
    }

    // Find or create cart
    let cart = await Cart.findOne({ userId });
    if (!cart) {
        cart = new Cart({ userId, items: [] });
    }

    // Check if item already exists in cart
    const existingItemIndex = cart.items.findIndex(item =>
        item.productId.toString() === productId &&
        (variantId ? item.variantId?.toString() === variantId : !item.variantId)
    );

    if (existingItemIndex > -1) {
        // Update existing item
        const existingItem = cart.items[existingItemIndex];
        const newQuantity = existingItem.quantity + quantity;

        if (newQuantity > availableStock) {
            throw new ApiError(400, `Cannot add ${quantity} items. Only ${availableStock - existingItem.quantity} more items available`);
        }

        existingItem.quantity = newQuantity;
        existingItem.totalPrice = finalPrice * newQuantity;
    } else {
        // Add new item
        const newItem = {
            productId,
            variantId: variantId || undefined,
            quantity,
            price: finalPrice,
            totalPrice: finalPrice * quantity,
            productDetails: {
                name: product.name,
                images: product.images.map(img => img.url),
                sku: product.sku,
                currency: product.currency
            }
        };

        if (variant) {
            newItem.variantDetails = {
                name: variant.name,
                value: variant.value,
                sku: variant.sku,
                attributes: variant.attributes
            };
        }

        cart.items.push(newItem);
    }

    await cart.save();

    return res.status(200).json(
        new ApiResponse(200, cart, "Item added to cart successfully")
    );
});

// ✅ PUT /api/v1/cart/update/:itemId - Update item quantity
const updateCartItem = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1 || quantity > 99) {
        throw new ApiError(400, "Quantity must be between 1 and 99");
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
        throw new ApiError(404, "Cart not found");
    }

    const item = cart.items.id(itemId);
    if (!item) {
        throw new ApiError(404, "Item not found in cart");
    }

    // Check stock availability
    const { availableStock } = await getProductDetails(item.productId, item.variantId);

    if (quantity > availableStock) {
        throw new ApiError(400, `Only ${availableStock} items available in stock`);
    }

    // Update item
    item.quantity = quantity;
    item.totalPrice = item.price * quantity;

    await cart.save();

    return res.status(200).json(
        new ApiResponse(200, cart, "Cart item updated successfully")
    );
});

// ✅ DELETE /api/v1/cart/remove/:itemId - Remove item from cart
const removeFromCart = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { itemId } = req.params;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
        throw new ApiError(404, "Cart not found");
    }

    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
    if (itemIndex === -1) {
        throw new ApiError(404, "Item not found in cart");
    }

    const removedItem = cart.items[itemIndex];
    cart.items.splice(itemIndex, 1);

    await cart.save();

    return res.status(200).json(
        new ApiResponse(200, {
            cart,
            removedItem: {
                productName: removedItem.productDetails.name,
                quantity: removedItem.quantity
            }
        }, "Item removed from cart successfully")
    );
});

// ✅ GET /api/v1/cart - View cart items
const getCart = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    let cart = await Cart.findOne({ userId })
        .populate({
            path: 'items.productId',
            select: 'name price currency images sku status isActive stock variants',
            match: { status: 'active', isActive: true }
        });

    if (!cart) {
        // Return empty cart
        cart = {
            userId,
            items: [],
            summary: {
                totalItems: 0,
                totalQuantity: 0,
                subtotal: 0,
                currency: 'INR'
            }
        };
    } else {
        // Filter out items with deleted/inactive products and validate stock
        const validItems = [];
        let cartUpdated = false;

        for (const item of cart.items) {
            if (!item.productId) {
                cartUpdated = true;
                continue; // Skip deleted products
            }

            try {
                const { availableStock } = await getProductDetails(item.productId._id, item.variantId);

                // Check if item quantity exceeds available stock
                if (item.quantity > availableStock) {
                    if (availableStock > 0) {
                        // Adjust quantity to available stock
                        item.quantity = availableStock;
                        item.totalPrice = item.price * availableStock;
                        cartUpdated = true;
                    } else {
                        // Remove item if no stock
                        cartUpdated = true;
                        continue;
                    }
                }

                validItems.push(item);
            } catch (error) {
                // Remove invalid items
                cartUpdated = true;
            }
        }

        cart.items = validItems;

        // Save cart if it was updated
        if (cartUpdated) {
            await cart.save();
        }
    }

    return res.status(200).json(
        new ApiResponse(200, cart, "Cart retrieved successfully")
    );
});

// ✅ DELETE /api/v1/cart/clear - Clear cart
const clearCart = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
        throw new ApiError(404, "Cart not found");
    }

    const itemCount = cart.items.length;
    cart.items = [];

    await cart.save();

    return res.status(200).json(
        new ApiResponse(200, {
            cart,
            clearedItemsCount: itemCount
        }, "Cart cleared successfully")
    );
});

// ✅ GET /api/v1/cart/summary - Get cart summary
const getCartSummary = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const cart = await Cart.findOne({ userId }).select('summary');

    const summary = cart ? cart.summary : {
        totalItems: 0,
        totalQuantity: 0,
        subtotal: 0,
        currency: 'INR'
    };

    return res.status(200).json(
        new ApiResponse(200, summary, "Cart summary retrieved successfully")
    );
});

export {
    addToCart,
    updateCartItem,
    removeFromCart,
    getCart,
    clearCart,
    getCartSummary
};