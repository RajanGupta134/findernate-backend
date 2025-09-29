import Product from "../models/product.models.js";
import { User } from "../models/user.models.js";
import Business from "../models/business.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import mongoose from "mongoose";

// Helper function to check inventory permissions
const checkInventoryPermission = async (userId, productId = null) => {
    const user = await User.findById(userId);

    if (user.role === 'admin') {
        return { isAdmin: true, canManage: true };
    }

    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(403, "Business profile required to manage inventory");
    }

    if (productId) {
        const product = await Product.findById(productId);
        if (!product) {
            throw new ApiError(404, "Product not found");
        }

        if (product.sellerId.toString() !== userId.toString()) {
            throw new ApiError(403, "You can only manage inventory for your own products");
        }
    }

    return { isAdmin: false, canManage: true, business };
};

// ✅ POST /api/v1/inventory/stock-in/:productId - Add stock (Stock In)
const stockIn = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { quantity, reason, notes, cost } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    if (!quantity || quantity <= 0) {
        throw new ApiError(400, "Quantity must be a positive number");
    }

    await checkInventoryPermission(userId, productId);

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Update stock
    const oldStock = product.stock;
    product.stock += parseInt(quantity);
    product.lastRestockAt = new Date();

    // Update cost price if provided
    if (cost && cost > 0) {
        product.costPrice = cost;
    }

    await product.save();

    // Create stock movement record (you might want to create a separate StockMovement model)
    const stockMovement = {
        productId,
        type: 'in',
        quantity: parseInt(quantity),
        oldStock,
        newStock: product.stock,
        reason: reason || 'manual_adjustment',
        notes,
        cost,
        userId,
        timestamp: new Date()
    };

    // Remove cost data if not admin/owner
    const responseData = {
        product: {
            id: product._id,
            name: product.name,
            oldStock,
            newStock: product.stock,
            stockAdded: parseInt(quantity)
        },
        movement: {
            ...stockMovement,
            cost: (req.user.role === 'admin' || product.sellerId.toString() === userId.toString()) ? cost : undefined
        }
    };

    return res.status(200).json(
        new ApiResponse(200, responseData, "Stock added successfully")
    );
});

// ✅ POST /api/v1/inventory/stock-out/:productId - Remove stock (Stock Out)
const stockOut = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { quantity, reason, notes } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    if (!quantity || quantity <= 0) {
        throw new ApiError(400, "Quantity must be a positive number");
    }

    await checkInventoryPermission(userId, productId);

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Check if sufficient stock available
    if (product.trackStock && product.stock < quantity) {
        throw new ApiError(400, `Insufficient stock. Available: ${product.stock}, Requested: ${quantity}`);
    }

    // Update stock
    const oldStock = product.stock;
    if (product.trackStock) {
        product.stock = Math.max(0, product.stock - parseInt(quantity));
    }

    await product.save();

    // Create stock movement record
    const stockMovement = {
        productId,
        type: 'out',
        quantity: parseInt(quantity),
        oldStock,
        newStock: product.stock,
        reason: reason || 'manual_adjustment',
        notes,
        userId,
        timestamp: new Date()
    };

    return res.status(200).json(
        new ApiResponse(200, {
            product: {
                id: product._id,
                name: product.name,
                oldStock,
                newStock: product.stock,
                stockRemoved: parseInt(quantity)
            },
            movement: stockMovement
        }, "Stock removed successfully")
    );
});

// ✅ PUT /api/v1/inventory/adjust/:productId - Adjust stock to specific quantit
const adjustStock = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { quantity, reason, notes } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    if (quantity < 0) {
        throw new ApiError(400, "Quantity cannot be negative");
    }

    await checkInventoryPermission(userId, productId);

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    const oldStock = product.stock;
    const newStock = parseInt(quantity);
    const difference = newStock - oldStock;

    // Update stock
    product.stock = newStock;
    if (newStock > oldStock) {
        product.lastRestockAt = new Date();
    }

    await product.save();

    // Create stock movement record
    const stockMovement = {
        productId,
        type: 'adjustment',
        quantity: Math.abs(difference),
        oldStock,
        newStock,
        reason: reason || 'stock_adjustment',
        notes,
        userId,
        timestamp: new Date()
    };

    return res.status(200).json(
        new ApiResponse(200, {
            product: {
                id: product._id,
                name: product.name,
                oldStock,
                newStock,
                difference
            },
            movement: stockMovement
        }, "Stock adjusted successfully")
    );
});

// ✅ GET /api/v1/inventory/low-stock - Get products with low stock
const getLowStockProducts = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const { isAdmin } = await checkInventoryPermission(userId);

    // Build filter
    const filter = {
        trackStock: true,
        $expr: { $lte: ['$stock', '$minStock'] },
        isActive: true
    };

    // If not admin, filter by user's products
    if (!isAdmin) {
        filter.sellerId = userId;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.find(filter)
        .populate('category', 'name')
        .populate('sellerId', 'username firstName lastName')
        .select('name stock minStock price images')
        .sort({ stock: 1 })
        .limit(parseInt(limit))
        .skip(skip);

    const totalProducts = await Product.countDocuments(filter);

    return res.status(200).json(
        new ApiResponse(200, {
            products,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalProducts,
                totalPages: Math.ceil(totalProducts / parseInt(limit))
            }
        }, "Low stock products retrieved successfully")
    );
});

// ✅ GET /api/v1/inventory/out-of-stock - Get out of stock products
const getOutOfStockProducts = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const { isAdmin } = await checkInventoryPermission(userId);

    // Build filter
    const filter = {
        trackStock: true,
        stock: 0,
        isActive: true
    };

    // If not admin, filter by user's products
    if (!isAdmin) {
        filter.sellerId = userId;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.find(filter)
        .populate('category', 'name')
        .populate('sellerId', 'username firstName lastName')
        .select('name stock minStock price images')
        .sort({ updatedAt: -1 })
        .limit(parseInt(limit))
        .skip(skip);

    const totalProducts = await Product.countDocuments(filter);

    return res.status(200).json(
        new ApiResponse(200, {
            products,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalProducts,
                totalPages: Math.ceil(totalProducts / parseInt(limit))
            }
        }, "Out of stock products retrieved successfully")
    );
});

// ✅ GET /api/v1/inventory/stats - Get inventory statistics
const getInventoryStats = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const { isAdmin } = await checkInventoryPermission(userId);

    // Build base filter
    const baseFilter = { isActive: true };
    if (!isAdmin) {
        baseFilter.sellerId = userId;
    }

    // Get various stock statistics
    const totalProducts = await Product.countDocuments(baseFilter);

    const inStockProducts = await Product.countDocuments({
        ...baseFilter,
        $or: [
            { trackStock: false },
            { $and: [{ trackStock: true }, { stock: { $gt: 0 } }] }
        ]
    });

    const outOfStockProducts = await Product.countDocuments({
        ...baseFilter,
        trackStock: true,
        stock: 0
    });

    const lowStockProducts = await Product.countDocuments({
        ...baseFilter,
        trackStock: true,
        $expr: { $lte: ['$stock', '$minStock'] },
        stock: { $gt: 0 }
    });

    // Get total inventory value
    const inventoryValue = await Product.aggregate([
        { $match: baseFilter },
        {
            $group: {
                _id: null,
                totalValue: {
                    $sum: { $multiply: ['$stock', '$costPrice'] }
                },
                totalRetailValue: {
                    $sum: { $multiply: ['$stock', '$price'] }
                },
                totalUnits: { $sum: '$stock' }
            }
        }
    ]);

    const stats = {
        totalProducts,
        inStockProducts,
        outOfStockProducts,
        lowStockProducts,
        stockPercentage: {
            inStock: totalProducts > 0 ? Math.round((inStockProducts / totalProducts) * 100) : 0,
            outOfStock: totalProducts > 0 ? Math.round((outOfStockProducts / totalProducts) * 100) : 0,
            lowStock: totalProducts > 0 ? Math.round((lowStockProducts / totalProducts) * 100) : 0
        },
        inventory: inventoryValue[0] || {
            totalValue: 0,
            totalRetailValue: 0,
            totalUnits: 0
        }
    };

    return res.status(200).json(
        new ApiResponse(200, stats, "Inventory statistics retrieved successfully")
    );
});

// ✅ PUT /api/v1/inventory/bulk-update - Bulk update stock for multiple products
const bulkUpdateStock = asyncHandler(async (req, res) => {
    const { updates } = req.body; // Array of { productId, quantity, operation: 'set'|'add'|'subtract' }
    const userId = req.user._id;

    if (!Array.isArray(updates) || updates.length === 0) {
        throw new ApiError(400, "Updates array is required");
    }

    if (updates.length > 100) {
        throw new ApiError(400, "Maximum 100 products can be updated at once");
    }

    await checkInventoryPermission(userId);

    const results = [];
    const errors = [];

    for (const update of updates) {
        try {
            const { productId, quantity, operation = 'set' } = update;

            if (!mongoose.Types.ObjectId.isValid(productId)) {
                errors.push({ productId, error: "Invalid product ID" });
                continue;
            }

            const product = await Product.findById(productId);
            if (!product) {
                errors.push({ productId, error: "Product not found" });
                continue;
            }

            // Check ownership for non-admin users
            const user = await User.findById(userId);
            if (user.role !== 'admin' && product.sellerId.toString() !== userId.toString()) {
                errors.push({ productId, error: "Unauthorized" });
                continue;
            }

            const oldStock = product.stock;
            let newStock;

            switch (operation) {
                case 'set':
                    newStock = parseInt(quantity);
                    break;
                case 'add':
                    newStock = oldStock + parseInt(quantity);
                    break;
                case 'subtract':
                    newStock = Math.max(0, oldStock - parseInt(quantity));
                    break;
                default:
                    errors.push({ productId, error: "Invalid operation" });
                    continue;
            }

            if (newStock < 0) {
                errors.push({ productId, error: "Stock cannot be negative" });
                continue;
            }

            product.stock = newStock;
            if (newStock > oldStock) {
                product.lastRestockAt = new Date();
            }

            await product.save();

            results.push({
                productId,
                name: product.name,
                oldStock,
                newStock,
                operation
            });

        } catch (error) {
            errors.push({
                productId: update.productId,
                error: error.message
            });
        }
    }

    return res.status(200).json(
        new ApiResponse(200, {
            successful: results,
            errors,
            summary: {
                total: updates.length,
                successful: results.length,
                failed: errors.length
            }
        }, "Bulk stock update completed")
    );
});

export {
    stockIn,
    stockOut,
    adjustStock,
    getLowStockProducts,
    getOutOfStockProducts,
    getInventoryStats,
    bulkUpdateStock
};
