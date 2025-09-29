import Product from "../models/product.models.js";
import Business from "../models/business.models.js";
import { User } from "../models/user.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import { uploadBufferToBunny } from "../utlis/bunny.js";
import mongoose from "mongoose";

// Helper function to check if user is admin or vendor/seller

const checkProductPermission = async (userId, productId = null) => {
    const user = await User.findById(userId);

    if (user.role === 'admin') {
        return { isAdmin: true, canEdit: true };
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

    // Get business info if available (optional)
    let business = null;
    if (user.isBusinessProfile && user.businessProfileId) {
        business = await Business.findById(user.businessProfileId);
    }

    return { isAdmin: false, canEdit: true, business };
};

// ✅ POST /api/v1/products - Create new product (Admin/Vendor)
const createProduct = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { isAdmin, business } = await checkProductPermission(userId);

    // Parse form-data fields (some might be strings that need parsing)
    const parseField = (field) => {
        if (typeof field === 'string') {
            try {
                return JSON.parse(field);
            } catch (e) {
                return field;
            }
        }
        return field;
    };

    // Handle keys with extra spaces (common in form-data)
    const getFieldValue = (key) => {
        // Try exact key first
        if (req.body[key]) return req.body[key];

        // Try with trailing space
        if (req.body[key + ' ']) return req.body[key + ' '];

        // Try with leading space
        if (req.body[' ' + key]) return req.body[' ' + key];

        // Try with both spaces
        if (req.body[' ' + key + ' ']) return req.body[' ' + key + ' '];

        return null;
    };

    // Extract and clean fields from req.body
    const name = getFieldValue('name') ? getFieldValue('name').toString().trim() : '';
    const description = getFieldValue('description') ? getFieldValue('description').toString().trim() : '';
    const price = getFieldValue('price') ? parseFloat(getFieldValue('price')) : null;
    const comparePrice = getFieldValue('comparePrice') ? parseFloat(getFieldValue('comparePrice')) : null;
    const costPrice = getFieldValue('costPrice') ? parseFloat(getFieldValue('costPrice')) : null;
    const stock = getFieldValue('stock') ? parseInt(getFieldValue('stock')) : 0;
    const minStock = getFieldValue('minStock') ? parseInt(getFieldValue('minStock')) : 5;
    const trackStock = getFieldValue('trackStock') !== 'false';
    const allowBackorder = getFieldValue('allowBackorder') === 'true';
    const category = getFieldValue('category') ? getFieldValue('category').toString().trim() : '';
    const subcategory = getFieldValue('subcategory') ? getFieldValue('subcategory').toString().trim() : '';
    const brand = getFieldValue('brand') ? getFieldValue('brand').toString().trim() : '';
    const shippingClass = getFieldValue('shippingClass') ? getFieldValue('shippingClass').toString().trim() : 'standard';
    const status = getFieldValue('status') ? getFieldValue('status').toString().trim() : 'draft';
    const visibility = getFieldValue('visibility') ? getFieldValue('visibility').toString().trim() : 'public';
    const isFeatured = getFieldValue('isFeatured') === 'true';
    const isDigital = getFieldValue('isDigital') === 'true';
    const digitalFileUrl = getFieldValue('digitalFileUrl') ? getFieldValue('digitalFileUrl').toString().trim() : '';

    const {
        images,
        variants,
        specifications,
        features,
        tags,
        weight,
        dimensions
    } = req.body;

    // Validate required fields
    if (!name || !price) {
        throw new ApiError(400, "Name and price are required");
    }

    // Use provided category or default to 'general'
    const productCategory = category || 'general';
    const productSubcategory = subcategory || null;

    // Validate price fields
    if (comparePrice && comparePrice < price) {
        throw new ApiError(400, "Compare price must be greater than selling price");
    }

    // Generate SKU if not provided
    const productSku = req.body.sku || (() => {
        const baseSku = name
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase()
            .substring(0, 6);
        const timestamp = Date.now().toString().slice(-4);
        return `${baseSku}${timestamp}`;
    })();

    // Handle file uploads
    let uploadedImages = [];
    if (req.files && req.files.length > 0) {
        try {
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const uploadResult = await uploadBufferToBunny(
                    file.buffer,
                    'products',
                    file.originalname
                );

                uploadedImages.push({
                    url: uploadResult.secure_url,
                    alt: `${name} - Image ${i + 1}`,
                    isPrimary: i === 0, // First image is primary
                    sortOrder: i
                });
            }
        } catch (error) {
            throw new ApiError(500, `Image upload failed: ${error.message}`);
        }
    }

    // Parse JSON fields from form-data
    const parsedSpecifications = parseField(specifications) || [];
    const parsedFeatures = parseField(features) || [];
    const parsedTags = parseField(tags) || [];
    const parsedWeight = parseField(weight);
    const parsedDimensions = parseField(dimensions);
    const parsedVariants = parseField(variants) || [];

    // Combine uploaded images with any images provided in the body
    const bodyImages = parseField(images) || [];
    const finalImages = [...uploadedImages, ...bodyImages];

    const productData = {
        sellerId: userId,
        businessId: business?._id || null,
        name,
        sku: productSku,
        description,
        price,
        comparePrice,
        costPrice,
        stock: stock || 0,
        minStock: minStock || 5,
        trackStock: trackStock !== false,
        allowBackorder: allowBackorder || false,
        category: productCategory, // Use provided category or 'general'
        subcategory: productSubcategory, // Use provided subcategory
        brand,
        images: finalImages,
        variants: parsedVariants,
        specifications: parsedSpecifications,
        features: parsedFeatures,
        tags: parsedTags,
        weight: parsedWeight,
        dimensions: parsedDimensions,
        shippingClass: shippingClass || 'standard',
        status: status || 'draft',
        visibility: visibility || 'public',
        isFeatured: isFeatured || false,
        isDigital: isDigital || false,
        digitalFileUrl
    };

    const product = await Product.create(productData);

    // Populate seller and business information (business is optional)
    const populateOptions = [
        { path: 'sellerId', select: 'username firstName lastName' }
    ];

    if (product.businessId) {
        populateOptions.push({ path: 'businessId', select: 'businessName category subcategory' });
    }

    await product.populate(populateOptions);

    // Remove sensitive data for response
    const responseProduct = product.toObject();
    if (req.user.role !== 'admin' && product.sellerId.toString() !== req.user._id.toString()) {
        delete responseProduct.costPrice;
        delete responseProduct.sellerId;
        delete responseProduct.businessId;
    }

    // Clean up response structure - keep _id for database clarity, add productId for frontend
    responseProduct.productId = responseProduct._id;
    delete responseProduct.id; // Remove the virtual id field
    delete responseProduct.__v;

    // Clean variants - keep _id for database, add variantId for frontend
    if (responseProduct.variants) {
        responseProduct.variants = responseProduct.variants.map(variant => {
            const cleanVariant = { ...variant };
            cleanVariant.variantId = cleanVariant._id;
            delete cleanVariant.id; // Remove virtual id field only
            return cleanVariant;
        });
    }

    return res.status(201).json(
        new ApiResponse(201, responseProduct, "Product created successfully")
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

    // Remove sensitive data based on user role and ownership
    const isOwner = req.user && product.sellerId._id.toString() === req.user._id.toString();
    const isAdmin = req.user && req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
        delete result.costPrice;
        delete result.minStock;
        delete result.trackStock;
        delete result.allowBackorder;
        delete result.salesCount;
        delete result.viewCount;
        delete result.wishlistCount;

        // Clean seller info
        if (result.sellerId) {
            result.seller = {
                username: result.sellerId.username,
                firstName: result.sellerId.firstName,
                lastName: result.sellerId.lastName
            };
            delete result.sellerId;
        }

        // Clean business info
        if (result.businessId) {
            result.business = {
                businessName: result.businessId.businessName,
                logoUrl: result.businessId.logoUrl,
                rating: result.businessId.rating
            };
            delete result.businessId;
        }

        // Clean variants - remove sensitive data
        if (result.variants) {
            result.variants = result.variants.map(variant => ({
                id: variant._id,
                name: variant.name,
                value: variant.value,
                price: variant.price,
                images: variant.images,
                attributes: variant.attributes,
                isActive: variant.isActive,
                sortOrder: variant.sortOrder
            }));
        }
    }

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
        status = 'active',
        // Enhanced filtering options
        rating, // minimum rating
        tags, // comma-separated tags
        availability = 'all', // all, in_stock, out_of_stock, low_stock
        priceRange, // predefined ranges: budget, mid, premium
        dateRange, // today, week, month, year
        searchType = 'fuzzy' // exact, fuzzy, phrase
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

    // Enhanced search filter
    if (isSearchRequest) {
        const searchQuery = q.trim();

        switch (searchType) {
            case 'exact':
                filter.$or = [
                    { name: { $regex: `^${searchQuery}$`, $options: 'i' } },
                    { brand: { $regex: `^${searchQuery}$`, $options: 'i' } },
                    { tags: { $in: [new RegExp(`^${searchQuery}$`, 'i')] } }
                ];
                break;

            case 'phrase':
                filter.$or = [
                    { name: { $regex: searchQuery, $options: 'i' } },
                    { description: { $regex: searchQuery, $options: 'i' } }
                ];
                break;

            case 'fuzzy':
            default:
                // Use MongoDB text search for fuzzy matching
                filter.$text = { $search: searchQuery };
                break;
        }
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
        filter.category = { $regex: category, $options: 'i' };
    }
    if (subcategory) {
        filter.subcategory = { $regex: subcategory, $options: 'i' };
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

    // Enhanced availability filter
    switch (availability) {
        case 'in_stock':
            filter.$or = [
                { trackStock: false },
                { $and: [{ trackStock: true }, { stock: { $gt: 0 } }] }
            ];
            break;
        case 'out_of_stock':
            filter.$and = [
                { trackStock: true },
                { stock: 0 }
            ];
            break;
        case 'low_stock':
            filter.$and = [
                { trackStock: true },
                { $expr: { $lte: ['$stock', '$minStock'] } },
                { stock: { $gt: 0 } }
            ];
            break;
        case 'all':
        default:
            // Legacy inStock parameter support
            if (inStock === 'true') {
                filter.$or = [
                    { trackStock: false },
                    { $and: [{ trackStock: true }, { stock: { $gt: 0 } }] }
                ];
            }
            break;
    }

    // Rating filter
    if (rating) {
        filter.averageRating = { $gte: parseFloat(rating) };
    }

    // Tags filter
    if (tags) {
        const tagArray = tags.split(',').map(tag => tag.trim());
        filter.tags = { $in: tagArray.map(tag => new RegExp(tag, 'i')) };
    }

    // Predefined price ranges
    if (priceRange) {
        const priceRanges = {
            budget: { min: 0, max: 1000 },
            mid: { min: 1000, max: 5000 },
            premium: { min: 5000, max: Infinity }
        };

        const range = priceRanges[priceRange];
        if (range) {
            filter.price = { $gte: range.min };
            if (range.max !== Infinity) {
                filter.price.$lte = range.max;
            }
        }
    }

    // Date range filter
    if (dateRange) {
        const now = new Date();
        let startDate;

        switch (dateRange) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                break;
            case 'year':
                startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
                break;
        }

        if (startDate) {
            filter.createdAt = { $gte: startDate };
        }
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

    // Execute query - only select necessary fields for listing
    const products = await Product.find(filter)
        .populate('sellerId', 'username firstName lastName')
        .select('name slug price comparePrice currency images averageRating totalReviews trackStock stock minStock brand category isFeatured isActive displayPrice createdAt sellerId')
        .sort(sortOptions)
        .limit(parseInt(limit))
        .skip(skip);

    // Get total count for pagination
    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / parseInt(limit));

    // Enhanced search suggestions with multiple sources
    let suggestions = [];
    if (isSearchRequest && totalProducts < 5) {
        const searchTerm = q.toLowerCase();

        // Get suggestions from product names
        const nameMatches = await Product.find({
            status: 'active',
            isActive: true,
            name: { $regex: searchTerm, $options: 'i' }
        })
            .select('name')
            .limit(3);

        // Get suggestions from brands
        const brandMatches = await Product.distinct('brand', {
            status: 'active',
            isActive: true,
            brand: { $regex: searchTerm, $options: 'i' }
        });

        // Get suggestions from tags
        const tagMatches = await Product.find({
            status: 'active',
            isActive: true,
            tags: { $elemMatch: { $regex: searchTerm, $options: 'i' } }
        })
            .select('tags')
            .limit(3);

        // Combine suggestions
        suggestions = [
            ...nameMatches.map(p => ({ type: 'product', value: p.name })),
            ...brandMatches.slice(0, 2).map(brand => ({ type: 'brand', value: brand })),
            ...tagMatches.flatMap(p =>
                p.tags
                    .filter(tag => tag.toLowerCase().includes(searchTerm))
                    .map(tag => ({ type: 'tag', value: tag }))
            ).slice(0, 2)
        ];
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

    // Clean products data - remove sensitive fields for non-owners
    const cleanProducts = products.map(product => {
        const productObj = product.toObject();
        // Remove seller ID for public listing
        if (productObj.sellerId && productObj.sellerId._id) {
            productObj.seller = {
                username: productObj.sellerId.username,
                firstName: productObj.sellerId.firstName,
                lastName: productObj.sellerId.lastName
            };
            delete productObj.sellerId;
        }
        return productObj;
    });

    // Response data
    const responseData = {
        products: cleanProducts,
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

    // Parse form-data fields (same as create controller)
    const parseField = (field) => {
        if (typeof field === 'string') {
            try {
                return JSON.parse(field);
            } catch (e) {
                return field;
            }
        }
        return field;
    };

    // Handle keys with extra spaces (same as create controller)
    const getFieldValue = (key) => {
        if (updates[key]) return updates[key];
        if (updates[key + ' ']) return updates[key + ' '];
        if (updates[' ' + key]) return updates[' ' + key];
        if (updates[' ' + key + ' ']) return updates[' ' + key + ' '];
        return null;
    };

    // Clean and parse all form-data fields
    const fieldsToTrim = [
        'name', 'description', 'brand', 'category', 'subcategory',
        'shippingClass', 'status', 'visibility', 'digitalFileUrl'
    ];

    fieldsToTrim.forEach(field => {
        const value = getFieldValue(field);
        if (value && typeof value === 'string') {
            updates[field] = value.trim();
        }
    });

    // Parse numeric fields
    const numericFields = ['price', 'comparePrice', 'costPrice', 'stock', 'minStock'];
    numericFields.forEach(field => {
        const value = getFieldValue(field);
        if (value) {
            updates[field] = parseFloat(value);
        }
    });

    // Parse boolean fields
    const booleanFields = ['trackStock', 'allowBackorder', 'isFeatured', 'isDigital'];
    booleanFields.forEach(field => {
        const value = getFieldValue(field);
        if (value !== null && value !== undefined) {
            updates[field] = value === 'true' || value === true;
        }
    });

    // Parse JSON fields from form-data
    if (getFieldValue('specifications')) {
        updates.specifications = parseField(getFieldValue('specifications'));
    }
    if (getFieldValue('features')) {
        updates.features = parseField(getFieldValue('features'));
    }
    if (getFieldValue('tags')) {
        updates.tags = parseField(getFieldValue('tags'));
    }
    if (getFieldValue('weight')) {
        updates.weight = parseField(getFieldValue('weight'));
    }
    if (getFieldValue('dimensions')) {
        updates.dimensions = parseField(getFieldValue('dimensions'));
    }
    if (getFieldValue('variants')) {
        updates.variants = parseField(getFieldValue('variants'));
    }

    // Handle file uploads for updates
    if (req.files && req.files.length > 0) {
        try {
            let uploadedImages = [];
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const uploadResult = await uploadBufferToBunny(
                    file.buffer,
                    'products',
                    file.originalname
                );

                uploadedImages.push({
                    url: uploadResult.secure_url,
                    alt: `Product Image ${i + 1}`,
                    isPrimary: i === 0 && (!updates.images || updates.images.length === 0),
                    sortOrder: i
                });
            }

            // Combine uploaded images with any existing images from body
            const bodyImages = parseField(getFieldValue('images')) || [];
            updates.images = [...uploadedImages, ...bodyImages];
        } catch (error) {
            throw new ApiError(500, `Image upload failed: ${error.message}`);
        }
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
        .populate('sellerId', 'username firstName lastName');

    // Remove sensitive data for response
    const responseProduct = product.toObject();
    const isOwner = req.user._id.toString() === product.sellerId._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
        delete responseProduct.costPrice;
        delete responseProduct.sellerId;
        delete responseProduct.businessId;
    }

    return res.status(200).json(
        new ApiResponse(200, responseProduct, "Product updated successfully")
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

// ✅ POST /api/v1/products/:id/feature - Toggle featured status (Product owner)
const toggleFeaturedStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid product ID");
    }

    // Check product ownership (same as other product operations)
    await checkProductPermission(userId, id);

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
        .limit(10)
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
            $group: {
                _id: '$category',
                count: { $sum: 1 },
                categoryName: { $first: '$category' }
            }
        },
        {
            $project: {
                _id: 0,
                categoryName: 1,
                count: 1
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

// ✅ GET /api/v1/products/search/autocomplete - Search autocomplete/suggestions
const getSearchSuggestions = asyncHandler(async (req, res) => {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
        return res.status(200).json(
            new ApiResponse(200, { suggestions: [] }, "Search term too short")
        );
    }

    const searchTerm = q.trim().toLowerCase();

    try {
        // Get product name suggestions
        const productSuggestions = await Product.aggregate([
            {
                $match: {
                    status: 'active',
                    isActive: true,
                    name: { $regex: searchTerm, $options: 'i' }
                }
            },
            {
                $project: {
                    name: 1,
                    relevance: { $divide: [{ $strLenCP: '$name' }, 100] }
                }
            },
            { $sort: { relevance: 1, salesCount: -1 } },
            { $limit: 5 }
        ]);

        // Get brand suggestions
        const brandSuggestions = await Product.aggregate([
            {
                $match: {
                    status: 'active',
                    isActive: true,
                    brand: { $regex: searchTerm, $options: 'i' }
                }
            },
            {
                $group: {
                    _id: '$brand',
                    productCount: { $sum: 1 }
                }
            },
            { $sort: { productCount: -1 } },
            { $limit: 3 }
        ]);

        // Get category suggestions from actual product categories
        const allCategorySuggestions = await Product.distinct('category', {
            status: 'active',
            isActive: true,
            category: { $regex: searchTerm, $options: 'i' }
        });
        const categorySuggestions = allCategorySuggestions.slice(0, 3);

        // Popular search suggestions based on view count
        const popularProducts = await Product.find({
            status: 'active',
            isActive: true,
            $or: [
                { name: { $regex: searchTerm, $options: 'i' } },
                { tags: { $elemMatch: { $regex: searchTerm, $options: 'i' } } }
            ]
        })
            .select('name viewCount')
            .sort({ viewCount: -1 })
            .limit(3);

        // Format suggestions
        const suggestions = [
            ...productSuggestions.map(p => ({
                type: 'product',
                value: p.name,
                icon: '🛍️'
            })),
            ...brandSuggestions.map(b => ({
                type: 'brand',
                value: b._id,
                count: b.productCount,
                icon: '🏷️'
            })),
            ...categorySuggestions.map(c => ({
                type: 'category',
                value: c,
                icon: '📂'
            })),
            ...popularProducts.map(p => ({
                type: 'trending',
                value: p.name,
                views: p.viewCount,
                icon: '🔥'
            }))
        ].slice(0, parseInt(limit));

        // Remove duplicates
        const uniqueSuggestions = suggestions.filter((suggestion, index, self) =>
            index === self.findIndex(s => s.value === suggestion.value)
        );

        return res.status(200).json(
            new ApiResponse(200, {
                suggestions: uniqueSuggestions,
                query: q,
                count: uniqueSuggestions.length
            }, "Search suggestions retrieved successfully")
        );

    } catch (error) {
        console.error('Search suggestions error:', error);
        return res.status(200).json(
            new ApiResponse(200, { suggestions: [] }, "Error retrieving suggestions")
        );
    }
});

// ✅ GET /api/v1/products/filters/options - Get available filter options
const getFilterOptions = asyncHandler(async (req, res) => {
    try {
        // Get available brands
        const brands = await Product.distinct('brand', {
            status: 'active',
            isActive: true,
            brand: { $ne: null, $ne: '' }
        });

        // Get categories from actual products
        const categoryNames = await Product.distinct('category', {
            status: 'active',
            isActive: true,
            category: { $ne: null, $ne: '' }
        });

        const categories = categoryNames.sort().map(name => ({
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            _id: name
        }));

        // Get price range
        const priceStats = await Product.aggregate([
            {
                $match: { status: 'active', isActive: true }
            },
            {
                $group: {
                    _id: null,
                    minPrice: { $min: '$price' },
                    maxPrice: { $max: '$price' },
                    avgPrice: { $avg: '$price' }
                }
            }
        ]);

        // Get popular tags
        const popularTags = await Product.aggregate([
            { $match: { status: 'active', isActive: true } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]);

        return res.status(200).json(
            new ApiResponse(200, {
                brands: brands.sort(),
                categories,
                priceRange: priceStats[0] || { minPrice: 0, maxPrice: 0, avgPrice: 0 },
                popularTags: popularTags.map(tag => ({
                    name: tag._id,
                    count: tag.count
                })),
                availabilityOptions: [
                    { value: 'all', label: 'All Products' },
                    { value: 'in_stock', label: 'In Stock' },
                    { value: 'out_of_stock', label: 'Out of Stock' },
                    { value: 'low_stock', label: 'Low Stock' }
                ],
                priceRangeOptions: [
                    { value: 'budget', label: 'Budget (Under ₹1,000)', min: 0, max: 1000 },
                    { value: 'mid', label: 'Mid Range (₹1,000 - ₹5,000)', min: 1000, max: 5000 },
                    { value: 'premium', label: 'Premium (Above ₹5,000)', min: 5000, max: null }
                ],
                sortOptions: [
                    { value: 'relevance', label: 'Relevance' },
                    { value: 'price_asc', label: 'Price: Low to High' },
                    { value: 'price_desc', label: 'Price: High to Low' },
                    { value: 'rating', label: 'Customer Rating' },
                    { value: 'popularity', label: 'Popularity' },
                    { value: 'newest', label: 'Newest First' },
                    { value: 'name', label: 'Name A-Z' }
                ]
            }, "Filter options retrieved successfully")
        );

    } catch (error) {
        console.error('Filter options error:', error);
        throw new ApiError(500, "Error retrieving filter options");
    }
});

// ✅ POST /api/v1/products/:productId/reviews - Add product review
const addProductReview = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const userId = req.user._id;
    const { rating, comment, images = [] } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    if (!rating || rating < 1 || rating > 5) {
        throw new ApiError(400, "Rating must be between 1 and 5");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Check if user already reviewed this product
    const existingReview = product.reviews.find(
        review => review.userId.toString() === userId.toString()
    );

    if (existingReview) {
        throw new ApiError(400, "You have already reviewed this product");
    }

    // Add review
    const review = {
        userId,
        rating: parseInt(rating),
        comment: comment || '',
        images,
        isVerified: false, // Can be set to true by admin or based on purchase history
        helpfulCount: 0
    };

    product.reviews.push(review);

    // Recalculate average rating and total reviews
    const totalRating = product.reviews.reduce((sum, review) => sum + review.rating, 0);
    product.averageRating = totalRating / product.reviews.length;
    product.totalReviews = product.reviews.length;

    await product.save();

    // Populate user info for the new review
    await product.populate({
        path: 'reviews.userId',
        select: 'username firstName lastName profileImageUrl',
        model: 'User'
    });

    const newReview = product.reviews[product.reviews.length - 1];

    return res.status(201).json(
        new ApiResponse(201, {
            review: newReview,
            product: {
                averageRating: product.averageRating,
                totalReviews: product.totalReviews
            }
        }, "Review added successfully")
    );
});

// ✅ PUT /api/v1/products/:productId/reviews/:reviewId - Update product review
const updateProductReview = asyncHandler(async (req, res) => {
    const { productId, reviewId } = req.params;
    const userId = req.user._id;
    const { rating, comment, images } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(reviewId)) {
        throw new ApiError(400, "Invalid product or review ID");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    const review = product.reviews.id(reviewId);
    if (!review) {
        throw new ApiError(404, "Review not found");
    }

    // Check ownership
    if (review.userId.toString() !== userId.toString()) {
        throw new ApiError(403, "You can only update your own reviews");
    }

    // Update review fields
    if (rating !== undefined) {
        if (rating < 1 || rating > 5) {
            throw new ApiError(400, "Rating must be between 1 and 5");
        }
        review.rating = parseInt(rating);
    }

    if (comment !== undefined) {
        review.comment = comment;
    }

    if (images !== undefined) {
        review.images = images;
    }

    // Recalculate average rating
    const totalRating = product.reviews.reduce((sum, review) => sum + review.rating, 0);
    product.averageRating = totalRating / product.reviews.length;

    await product.save();

    return res.status(200).json(
        new ApiResponse(200, {
            review,
            product: {
                averageRating: product.averageRating,
                totalReviews: product.totalReviews
            }
        }, "Review updated successfully")
    );
});

// ✅ DELETE /api/v1/products/:productId/reviews/:reviewId - Delete product review
const deleteProductReview = asyncHandler(async (req, res) => {
    const { productId, reviewId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(reviewId)) {
        throw new ApiError(400, "Invalid product or review ID");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    const review = product.reviews.id(reviewId);
    if (!review) {
        throw new ApiError(404, "Review not found");
    }

    // Check ownership or admin
    if (review.userId.toString() !== userId.toString() && req.user.role !== 'admin') {
        throw new ApiError(403, "You can only delete your own reviews");
    }

    product.reviews.pull(reviewId);

    // Recalculate average rating and total reviews
    if (product.reviews.length > 0) {
        const totalRating = product.reviews.reduce((sum, review) => sum + review.rating, 0);
        product.averageRating = totalRating / product.reviews.length;
    } else {
        product.averageRating = 0;
    }
    product.totalReviews = product.reviews.length;

    await product.save();

    return res.status(200).json(
        new ApiResponse(200, {
            product: {
                averageRating: product.averageRating,
                totalReviews: product.totalReviews
            }
        }, "Review deleted successfully")
    );
});

// ✅ GET /api/v1/products/:productId/reviews - Get product reviews with pagination
const getProductReviews = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const {
        page = 1,
        limit = 10,
        rating, // Filter by specific rating
        sortBy = 'createdAt',
        sortOrder = 'desc',
        verified = false // Filter verified reviews only
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ApiError(400, "Invalid product ID");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    let reviews = [...product.reviews];

    // Filter by rating
    if (rating) {
        reviews = reviews.filter(review => review.rating === parseInt(rating));
    }

    // Filter verified reviews
    if (verified === 'true') {
        reviews = reviews.filter(review => review.isVerified);
    }

    // Sort reviews
    const sortField = sortBy === 'helpful' ? 'helpfulCount' : sortBy;
    reviews.sort((a, b) => {
        const aValue = a[sortField];
        const bValue = b[sortField];

        if (sortOrder === 'asc') {
            return aValue > bValue ? 1 : -1;
        } else {
            return aValue < bValue ? 1 : -1;
        }
    });

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedReviews = reviews.slice(skip, skip + parseInt(limit));

    // Populate user info for paginated reviews
    await Product.populate(paginatedReviews, {
        path: 'userId',
        select: 'username firstName lastName profileImageUrl'
    });

    // Calculate rating distribution
    const ratingDistribution = [1, 2, 3, 4, 5].map(star => {
        const count = product.reviews.filter(review => review.rating === star).length;
        const percentage = product.reviews.length > 0 ? (count / product.reviews.length) * 100 : 0;
        return { star, count, percentage: Math.round(percentage) };
    });

    return res.status(200).json(
        new ApiResponse(200, {
            reviews: paginatedReviews,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: reviews.length,
                totalPages: Math.ceil(reviews.length / parseInt(limit)),
                hasNextPage: page < Math.ceil(reviews.length / parseInt(limit)),
                hasPrevPage: page > 1
            },
            summary: {
                averageRating: product.averageRating,
                totalReviews: product.totalReviews,
                ratingDistribution,
                verifiedReviews: product.reviews.filter(r => r.isVerified).length
            },
            filters: {
                rating,
                verified,
                sortBy,
                sortOrder
            }
        }, "Product reviews retrieved successfully")
    );
});

// ✅ POST /api/v1/products/:productId/reviews/:reviewId/helpful - Mark review as helpful
const markReviewHelpful = asyncHandler(async (req, res) => {
    const { productId, reviewId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(reviewId)) {
        throw new ApiError(400, "Invalid product or review ID");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    const review = product.reviews.id(reviewId);
    if (!review) {
        throw new ApiError(404, "Review not found");
    }

    review.helpfulCount += 1;
    await product.save();

    return res.status(200).json(
        new ApiResponse(200, { helpfulCount: review.helpfulCount }, "Review marked as helpful")
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
    getProductAnalytics,
    getSearchSuggestions,
    getFilterOptions,
    addProductReview,
    updateProductReview,
    deleteProductReview,
    getProductReviews,
    markReviewHelpful
};
