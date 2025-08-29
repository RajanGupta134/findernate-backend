import Product from "../models/product.models.js";
import Category from "../models/category.models.js";
import Business from "../models/business.models.js";
import { User } from "../models/user.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import mongoose from "mongoose";

// Helper function to check if user is admin or vendor/seller

const checkProductPermission = async (userId, productId = null) => {
    const user = await User.findById(userId);

    if (user.role === 'admin') {
        return { isAdmin: true, canEdit: true };
    }

    // Check if user has a business profile
    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(403, "Business profile required to manage products");
    }

    // If editing existing product, check ownership
    if (productId) {
        const product = await Product.findById(productId);
        if (!product) {
            throw new ApiError(404, "Product not found");
        }

        if (product.sellerId.toString() !== userId.toString()) {
            throw new ApiError(403, "You can only edit your own products");
        }
    }

    return { isAdmin: false, canEdit: true, business };
};

// ✅ POST /api/v1/products - Create new product (Admin/Vendor)
const createProduct = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { isAdmin, business } = await checkProductPermission(userId);

    const {
        name,
        description,
        price,
        comparePrice,
        costPrice,
        stock,
        minStock,
        trackStock,
        allowBackorder,
        category,
        subcategory,
        brand,
        images,
        variants,
        specifications,
        features,
        tags,
        weight,
        dimensions,
        shippingClass,
        status,
        visibility,
        isFeatured,
        isDigital,
        digitalFileUrl
    } = req.body;

    // Validate required fields
    if (!name || !price || !category) {
        throw new ApiError(400, "Name, price, and category are required");
    }

    // Find category by name or ID
    let categoryDoc;
    if (mongoose.Types.ObjectId.isValid(category)) {
        // If it's a valid ObjectId, search by ID
        categoryDoc = await Category.findById(category);
    } else {
        // If it's not an ObjectId, search by name (case-insensitive)
        categoryDoc = await Category.findOne({
            name: { $regex: new RegExp(`^${category}$`, 'i') },
            isActive: true
        });
    }

    if (!categoryDoc) {
        throw new ApiError(404, `Category '${category}' not found`);
    }

    // Validate subcategory if provided
    let subcategoryDoc = null;
    if (subcategory) {
        if (mongoose.Types.ObjectId.isValid(subcategory)) {
            // Search by ID
            subcategoryDoc = await Category.findById(subcategory);
        } else {
            // Search by name, and it should be a child of the main category
            subcategoryDoc = await Category.findOne({
                name: { $regex: new RegExp(`^${subcategory}$`, 'i') },
                parentCategory: categoryDoc._id,
                isActive: true
            });
        }

        if (!subcategoryDoc) {
            throw new ApiError(404, `Subcategory '${subcategory}' not found under category '${categoryDoc.name}'`);
        }

        // Ensure subcategory belongs to the main category
        if (subcategoryDoc.parentCategory?.toString() !== categoryDoc._id.toString()) {
            throw new ApiError(400, `Subcategory '${subcategory}' must belong to category '${categoryDoc.name}'`);
        }
    }

    // Validate price fields
    if (comparePrice && comparePrice < price) {
        throw new ApiError(400, "Compare price must be greater than selling price");
    }

    const productData = {
        sellerId: userId,
        businessId: business?._id,
        name,
        description,
        price,
        comparePrice,
        costPrice,
        stock: stock || 0,
        minStock: minStock || 5,
        trackStock: trackStock !== false,
        allowBackorder: allowBackorder || false,
        category: categoryDoc._id, // Use the found category's ObjectId
        subcategory: subcategoryDoc?._id, // Use the found subcategory's ObjectId
        brand,
        images: images || [],
        variants: variants || [],
        specifications: specifications || [],
        features: features || [],
        tags: tags || [],
        weight,
        dimensions,
        shippingClass: shippingClass || 'standard',
        status: status || 'draft',
        visibility: visibility || 'public',
        isFeatured: isFeatured || false,
        isDigital: isDigital || false,
        digitalFileUrl
    };

    const product = await Product.create(productData);

    // Populate category and subcategory information
    await product.populate([
        { path: 'category', select: 'name slug' },
        { path: 'subcategory', select: 'name slug' },
        { path: 'sellerId', select: 'username firstName lastName' }
    ]);

    return res.status(201).json(
        new ApiResponse(201, product, "Product created successfully")
    );
});

// ✅ GET /api/v1/products/:id - Get single product details
const getProductById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { includeReviews = false, reviewsLimit = 5 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid product ID");
    }

    let product = await Product.findOne({
        _id: id,
        status: 'active',
        isActive: true
    })
        .populate('category', 'name slug path')
        .populate('subcategory', 'name slug path')
        .populate('sellerId', 'username firstName lastName')
        .populate('businessId', 'businessName logoUrl rating location contact');

    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Increment view count
    await Product.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });

    let result = product.toObject();

    // Include reviews if requested
    if (includeReviews && product.reviews.length > 0) {
        // Populate user info for reviews
        await product.populate({
            path: 'reviews.userId',
            select: 'username firstName lastName profilePicture'
        });

        result.reviews = product.reviews
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, parseInt(reviewsLimit));
    }

    // Get related products from same category
    const relatedProducts = await Product.find({
        category: product.category._id,
        _id: { $ne: id },
        status: 'active',
        isActive: true
    })
        .select('name slug price images averageRating totalReviews')
        .limit(4)
        .sort({ averageRating: -1, salesCount: -1 });

    result.relatedProducts = relatedProducts;

    return res.status(200).json(
        new ApiResponse(200, result, "Product retrieved successfully")
    );
});

// ✅ GET /api/v1/products - Unified product listing with search, pagination, sorting, filtering
const getProducts = asyncHandler(async (req, res) => {
    const {
        q, // search query (optional)
        page = 1,
        limit = 12,
        category,
        subcategory,
        brand,
        minPrice,
        maxPrice,
        inStock = false,
        featured = false,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        sellerId,
        status = 'active'
    } = req.query;

    // Check if this is a search request
    const isSearchRequest = q && q.trim().length >= 2;

    // Build filter object
    const filter = {
        isActive: true
    };

    // Status filter (for admin/vendor views)
    if (req.user?.role === 'admin' || sellerId) {
        filter.status = status;
    } else {
        filter.status = 'active';
    }

    // Search filter (if search query provided)
    if (isSearchRequest) {
        filter.$text = { $search: q.trim() };
    }

    // Seller filter (for vendor's own products)
    if (sellerId) {
        const permission = await checkProductPermission(req.user._id);
        if (!permission.isAdmin && sellerId !== req.user._id.toString()) {
            throw new ApiError(403, "You can only view your own products");
        }
        filter.sellerId = sellerId;
    }

    // Category filters
    if (category) {
        filter.category = category;
    }
    if (subcategory) {
        filter.subcategory = subcategory;
    }

    // Brand filter
    if (brand) {
        filter.brand = { $regex: brand, $options: 'i' };
    }

    // Price range filter
    if (minPrice || maxPrice) {
        filter.price = {};
        if (minPrice) filter.price.$gte = parseFloat(minPrice);
        if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }

    // Stock filter
    if (inStock === 'true') {
        filter.$or = [
            { trackStock: false },
            { $and: [{ trackStock: true }, { stock: { $gt: 0 } }] }
        ];
    }

    // Featured filter
    if (featured === 'true') {
        filter.isFeatured = true;
    }

    // Sorting - handle search relevance
    const sortOptions = {};
    const allowedSortFields = [
        'createdAt', 'price', 'name', 'averageRating',
        'salesCount', 'viewCount', 'totalReviews', 'relevance'
    ];

    if (isSearchRequest && sortBy === 'relevance') {
        sortOptions.score = { $meta: 'textScore' };
    } else if (isSearchRequest && sortBy === 'createdAt' && !req.query.sortBy) {
        // Default to relevance for search when no sortBy specified
        sortOptions.score = { $meta: 'textScore' };
    } else if (allowedSortFields.includes(sortBy)) {
        sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    } else {
        sortOptions.createdAt = -1;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const products = await Product.find(filter)
        .populate('category', 'name slug')
        .populate('subcategory', 'name slug')
        .populate('sellerId', 'username firstName lastName')
        .select('-reviews') // Exclude reviews for listing
        .sort(sortOptions)
        .limit(parseInt(limit))
        .skip(skip);

    // Get total count for pagination
    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / parseInt(limit));

    // Search suggestions (if search request with few results)
    let suggestions = [];
    if (isSearchRequest && totalProducts < 5) {
        const suggestionProducts = await Product.find({
            status: 'active',
            isActive: true,
            name: { $regex: q, $options: 'i' }
        })
            .select('name')
            .limit(5);

        suggestions = suggestionProducts.map(p => p.name);
    }

    // Pagination info
    const pagination = {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalProducts,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
    };

    // Response data
    const responseData = {
        products,
        pagination,
        filters: {
            category,
            subcategory,
            brand,
            minPrice,
            maxPrice,
            inStock,
            featured,
            sortBy,
            sortOrder
        }
    };

    // Add search-specific data if this was a search request
    if (isSearchRequest) {
        responseData.searchQuery = q;
        responseData.suggestions = suggestions;
        responseData.resultsFound = totalProducts;
    }

    const message = isSearchRequest ? "Search completed successfully" : "Products retrieved successfully";

    return res.status(200).json(
        new ApiResponse(200, responseData, message)
    );
});



// ✅ PUT /api/v1/products/:id - Update product (Admin/Vendor)
const updateProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid product ID");
    }

    await checkProductPermission(userId, id);

    const updates = req.body;

    // Validate category if being updated
    if (updates.category) {
        let categoryDoc;
        if (mongoose.Types.ObjectId.isValid(updates.category)) {
            categoryDoc = await Category.findById(updates.category);
        } else {
            categoryDoc = await Category.findOne({
                name: { $regex: new RegExp(`^${updates.category}$`, 'i') },
                isActive: true
            });
        }

        if (!categoryDoc) {
            throw new ApiError(404, `Category '${updates.category}' not found`);
        }

        // Replace category name with ObjectId
        updates.category = categoryDoc._id;
    }

    // Validate subcategory if being updated
    if (updates.subcategory) {
        let subcategoryDoc;
        if (mongoose.Types.ObjectId.isValid(updates.subcategory)) {
            subcategoryDoc = await Category.findById(updates.subcategory);
        } else {
            // If category is also being updated, use the new category, otherwise get current product's category
            let parentCategoryId = updates.category;
            if (!parentCategoryId) {
                const currentProduct = await Product.findById(id).select('category');
                parentCategoryId = currentProduct.category;
            }

            subcategoryDoc = await Category.findOne({
                name: { $regex: new RegExp(`^${updates.subcategory}$`, 'i') },
                parentCategory: parentCategoryId,
                isActive: true
            });
        }

        if (!subcategoryDoc) {
            throw new ApiError(404, `Subcategory '${updates.subcategory}' not found`);
        }

        // Replace subcategory name with ObjectId
        updates.subcategory = subcategoryDoc._id;
    }

    // Validate price fields
    if (updates.comparePrice && updates.price && updates.comparePrice < updates.price) {
        throw new ApiError(400, "Compare price must be greater than selling price");
    }

    const product = await Product.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
    )
        .populate('category', 'name slug')
        .populate('subcategory', 'name slug')
        .populate('sellerId', 'username firstName lastName');

    return res.status(200).json(
        new ApiResponse(200, product, "Product updated successfully")
    );
});

// ✅ DELETE /api/v1/products/:id - Delete product (Admin/Vendor)
const deleteProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;
    const { permanent = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid product ID");
    }

    await checkProductPermission(userId, id);

    if (permanent === 'true') {
        // Permanent deletion
        await Product.findByIdAndDelete(id);
        return res.status(200).json(
            new ApiResponse(200, null, "Product permanently deleted")
        );
    } else {
        // Soft deletion - mark as inactive
        const product = await Product.findByIdAndUpdate(
            id,
            {
                isActive: false,
                status: 'archived',
                deletedAt: new Date()
            },
            { new: true }
        );

        return res.status(200).json(
            new ApiResponse(200, product, "Product archived successfully")
        );
    }
});

// ✅ POST /api/v1/products/:id/toggle-status - Toggle product status
const toggleProductStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid product ID");
    }

    await checkProductPermission(userId, id);

    const product = await Product.findById(id);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    product.isActive = !product.isActive;
    await product.save();

    return res.status(200).json(
        new ApiResponse(200, product, `Product ${product.isActive ? 'activated' : 'deactivated'} successfully`)
    );
});

// ✅ POST /api/v1/products/:id/feature - Toggle featured status (Admin only)
const toggleFeaturedStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    // Check if user is admin
    const user = await User.findById(userId);
    if (user.role !== 'admin') {
        throw new ApiError(403, "Only admins can manage featured products");
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid product ID");
    }

    const product = await Product.findById(id);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    product.isFeatured = !product.isFeatured;
    await product.save();

    return res.status(200).json(
        new ApiResponse(200, product, `Product ${product.isFeatured ? 'featured' : 'unfeatured'} successfully`)
    );
});

// ✅ GET /api/v1/products/analytics/dashboard - Product analytics for vendor
const getProductAnalytics = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { period = '30' } = req.query; // days

    await checkProductPermission(userId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Get basic stats
    const totalProducts = await Product.countDocuments({
        sellerId: userId,
        isActive: true
    });

    const activeProducts = await Product.countDocuments({
        sellerId: userId,
        status: 'active',
        isActive: true
    });

    const outOfStockProducts = await Product.countDocuments({
        sellerId: userId,
        trackStock: true,
        stock: 0,
        isActive: true
    });

    const lowStockProducts = await Product.countDocuments({
        sellerId: userId,
        trackStock: true,
        $expr: { $lte: ['$stock', '$minStock'] },
        stock: { $gt: 0 },
        isActive: true
    });

    // Get top performing products
    const topProducts = await Product.find({
        sellerId: userId,
        status: 'active',
        isActive: true
    })
        .sort({ salesCount: -1, viewCount: -1 })
        .limit(5)
        .select('name salesCount viewCount averageRating totalReviews');

    // Category distribution
    const categoryStats = await Product.aggregate([
        {
            $match: {
                sellerId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }
        },
        {
            $lookup: {
                from: 'categories',
                localField: 'category',
                foreignField: '_id',
                as: 'categoryInfo'
            }
        },
        {
            $group: {
                _id: '$category',
                count: { $sum: 1 },
                categoryName: { $first: { $arrayElemAt: ['$categoryInfo.name', 0] } }
            }
        },
        { $sort: { count: -1 } }
    ]);

    return res.status(200).json(
        new ApiResponse(200, {
            stats: {
                totalProducts,
                activeProducts,
                outOfStockProducts,
                lowStockProducts
            },
            topProducts,
            categoryDistribution: categoryStats,
            period: `${period} days`
        }, "Product analytics retrieved successfully")
    );
});

export {
    createProduct,
    getProductById,
    getProducts,
    updateProduct,
    deleteProduct,
    toggleProductStatus,
    toggleFeaturedStatus,
    getProductAnalytics
};
