import Category from "../models/category.models.js";
import Product from "../models/product.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import mongoose from "mongoose";

// ✅ POST /api/v1/admin/categories - Create new category
export const createCategory = asyncHandler(async (req, res) => {
    const {
        name,
        description,
        parentCategory,
        image,
        icon,
        sortOrder,
        metaTitle,
        metaDescription,
        attributes
    } = req.body;

    // Check if category with same name exists
    const existingCategory = await Category.findOne({
        name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existingCategory) {
        throw new ApiError(400, "Category with this name already exists");
    }

    // Validate parent category if provided
    if (parentCategory) {
        const parent = await Category.findById(parentCategory);
        if (!parent) {
            throw new ApiError(404, "Parent category not found");
        }
        // Check depth limit (max 3 levels)
        if (parent.level >= 2) {
            throw new ApiError(400, "Maximum category depth exceeded (3 levels)");
        }
    }

    const category = await Category.create({
        name,
        description,
        parentCategory: parentCategory || null,
        image,
        icon,
        sortOrder: sortOrder || 0,
        metaTitle,
        metaDescription,
        attributes: attributes || []
    });

    return res.status(201).json(
        new ApiResponse(201, category, "Category created successfully")
    );
});

// ✅ GET /api/v1/categories - Get all categories with hierarchy
export const getAllCategories = asyncHandler(async (req, res) => {
    const {
        level,
        parentId,
        includeInactive = false,
        includeProductCount = false,
        search
    } = req.query;

    let filter = {};

    // Filter by active status
    if (!includeInactive) {
        filter.isActive = true;
    }

    // Filter by level
    if (level !== undefined) {
        filter.level = parseInt(level);
    }

    // Filter by parent category
    if (parentId) {
        filter.parentCategory = parentId;
    } else if (level === undefined && !parentId) {
        // If no level or parent specified, get root categories by default
        filter.parentCategory = null;
    }

    // Search functionality
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }

    let query = Category.find(filter)
        .sort({ sortOrder: 1, name: 1 });

    // Populate subcategories if needed
    if (!parentId && level === undefined) {
        query = query.populate({
            path: 'subcategories',
            match: { isActive: includeInactive ? undefined : true },
            options: { sort: { sortOrder: 1, name: 1 } },
            populate: {
                path: 'subcategories',
                match: { isActive: includeInactive ? undefined : true },
                options: { sort: { sortOrder: 1, name: 1 } }
            }
        });
    }

    const categories = await query;

    // Add product count if requested
    if (includeProductCount) {
        for (let category of categories) {
            const productCount = await Product.countDocuments({
                category: category._id,
                status: 'active',
                isActive: true
            });
            category.productCount = productCount;
        }
    }

    return res.status(200).json(
        new ApiResponse(200, categories, "Categories retrieved successfully")
    );
});

// ✅ GET /api/v1/categories/:id - Get single category by ID
export const getCategoryById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { includeProducts = false, limit = 10, page = 1 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid category ID");
    }

    const category = await Category.findById(id)
        .populate('subcategories', null, { isActive: true })
        .populate('parentCategory', 'name slug path');

    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    let result = category.toObject();

    // Include products if requested
    if (includeProducts) {
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const products = await Product.find({
            category: id,
            status: 'active',
            isActive: true
        })
            .select('name slug price images averageRating totalReviews')
            .limit(parseInt(limit))
            .skip(skip)
            .sort({ createdAt: -1 });

        const totalProducts = await Product.countDocuments({
            category: id,
            status: 'active',
            isActive: true
        });

        result.products = {
            items: products,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalProducts,
                totalPages: Math.ceil(totalProducts / parseInt(limit))
            }
        };
    }

    return res.status(200).json(
        new ApiResponse(200, result, "Category retrieved successfully")
    );
});

// ✅ PUT /api/v1/admin/categories/:id - Update category
export const updateCategory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid category ID");
    }

    const category = await Category.findById(id);
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    // Check if trying to update name and if new name already exists
    if (updates.name && updates.name !== category.name) {
        const existingCategory = await Category.findOne({
            name: { $regex: new RegExp(`^${updates.name}$`, 'i') },
            _id: { $ne: id }
        });

        if (existingCategory) {
            throw new ApiError(400, "Category with this name already exists");
        }
    }

    // Validate parent category if being updated
    if (updates.parentCategory) {
        const parent = await Category.findById(updates.parentCategory);
        if (!parent) {
            throw new ApiError(404, "Parent category not found");
        }

        // Prevent circular reference
        if (parent._id.toString() === id) {
            throw new ApiError(400, "Category cannot be its own parent");
        }

        // Check if the parent is a descendant of current category
        let currentParent = parent;
        while (currentParent.parentCategory) {
            if (currentParent.parentCategory.toString() === id) {
                throw new ApiError(400, "Cannot set a descendant as parent category");
            }
            currentParent = await Category.findById(currentParent.parentCategory);
            if (!currentParent) break;
        }
    }

    const updatedCategory = await Category.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
    );

    return res.status(200).json(
        new ApiResponse(200, updatedCategory, "Category updated successfully")
    );
});

// ✅ DELETE /api/v1/admin/categories/:id - Delete category
export const deleteCategory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { force = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid category ID");
    }

    const category = await Category.findById(id);
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    // Check if category has subcategories
    const hasSubcategories = await Category.countDocuments({ parentCategory: id });
    if (hasSubcategories > 0 && !force) {
        throw new ApiError(400, "Cannot delete category with subcategories. Use force=true to delete all.");
    }

    // Check if category has products
    const hasProducts = await Product.countDocuments({ category: id });
    if (hasProducts > 0 && !force) {
        throw new ApiError(400, "Cannot delete category with products. Use force=true to move products to uncategorized.");
    }

    // If force delete, handle subcategories and products
    if (force) {
        // Delete all subcategories recursively
        const subcategories = await Category.find({ parentCategory: id });
        for (let subcategory of subcategories) {
            await deleteCategory({ params: { id: subcategory._id }, query: { force: true } });
        }

        // Move products to null category or handle as needed
        await Product.updateMany(
            { category: id },
            { $unset: { category: 1 } }
        );
    }

    await Category.findByIdAndDelete(id);

    return res.status(200).json(
        new ApiResponse(200, null, "Category deleted successfully")
    );
});

// ✅ POST /api/v1/admin/categories/:id/toggle-status - Toggle category active status
export const toggleCategoryStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid category ID");
    }

    const category = await Category.findById(id);
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    category.isActive = !category.isActive;
    await category.save();

    return res.status(200).json(
        new ApiResponse(200, category, `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`)
    );
});

// ✅ GET /api/v1/categories/tree - Get category tree structure
export const getCategoryTree = asyncHandler(async (req, res) => {
    const { includeInactive = false } = req.query;

    const buildTree = async (parentId = null) => {
        const filter = { parentCategory: parentId };
        if (!includeInactive) {
            filter.isActive = true;
        }

        const categories = await Category.find(filter)
            .sort({ sortOrder: 1, name: 1 })
            .lean();

        for (let category of categories) {
            category.children = await buildTree(category._id);

            // Add product count
            category.productCount = await Product.countDocuments({
                category: category._id,
                status: 'active',
                isActive: true
            });
        }

        return categories;
    };

    const tree = await buildTree();

    return res.status(200).json(
        new ApiResponse(200, tree, "Category tree retrieved successfully")
    );
});

// ✅ GET /api/v1/categories/breadcrumb/:id - Get category breadcrumb
export const getCategoryBreadcrumb = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid category ID");
    }

    const category = await Category.findById(id);
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    const breadcrumb = [];
    let currentCategory = category;

    // Build breadcrumb from current category to root
    while (currentCategory) {
        breadcrumb.unshift({
            id: currentCategory._id,
            name: currentCategory.name,
            slug: currentCategory.slug
        });

        if (currentCategory.parentCategory) {
            currentCategory = await Category.findById(currentCategory.parentCategory);
        } else {
            currentCategory = null;
        }
    }

    return res.status(200).json(
        new ApiResponse(200, breadcrumb, "Category breadcrumb retrieved successfully")
    );
});
