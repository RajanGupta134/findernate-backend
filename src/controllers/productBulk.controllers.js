import Product from "../models/product.models.js";
import Category from "../models/category.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ POST /api/v1/products/bulk/import - Import products from CSV
const importProductsFromCSV = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ApiError(400, "CSV file is required");
    }

    const userId = req.user._id;
    const results = [];
    const errors = [];

    // Read and parse CSV file
    const csvData = [];

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => csvData.push(data))
        .on('end', async () => {
            try {
                for (let i = 0; i < csvData.length; i++) {
                    const row = csvData[i];
                    const rowIndex = i + 2; // +2 because CSV is 1-indexed and we skip header

                    try {
                        // Validate required fields
                        if (!row.name || !row.price || !row.category) {
                            errors.push({
                                row: rowIndex,
                                error: "Missing required fields: name, price, or category"
                            });
                            continue;
                        }

                        // Find or create category
                        let categoryDoc = await Category.findOne({
                            name: { $regex: new RegExp(`^${row.category}$`, 'i') },
                            isActive: true
                        });

                        if (!categoryDoc) {
                            // Create category if it doesn't exist
                            categoryDoc = await Category.create({
                                name: row.category,
                                slug: row.category.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                                isActive: true
                            });
                        }

                        // Find subcategory if provided
                        let subcategoryDoc = null;
                        if (row.subcategory) {
                            subcategoryDoc = await Category.findOne({
                                name: { $regex: new RegExp(`^${row.subcategory}$`, 'i') },
                                parentCategory: categoryDoc._id,
                                isActive: true
                            });

                            if (!subcategoryDoc) {
                                // Create subcategory
                                subcategoryDoc = await Category.create({
                                    name: row.subcategory,
                                    slug: row.subcategory.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                                    parentCategory: categoryDoc._id,
                                    level: 1,
                                    isActive: true
                                });
                            }
                        }

                        // Prepare product data
                        const productData = {
                            sellerId: userId,
                            name: row.name.trim(),
                            sku: row.sku || undefined, // Let auto-generation handle if empty
                            description: row.description || '',
                            price: parseFloat(row.price),
                            comparePrice: row.comparePrice ? parseFloat(row.comparePrice) : undefined,
                            costPrice: row.costPrice ? parseFloat(row.costPrice) : undefined,
                            stock: parseInt(row.stock) || 0,
                            minStock: parseInt(row.minStock) || 5,
                            category: categoryDoc._id,
                            subcategory: subcategoryDoc?._id,
                            brand: row.brand || '',
                            tags: row.tags ? row.tags.split(',').map(tag => tag.trim()) : [],
                            features: row.features ? row.features.split(',').map(feature => feature.trim()) : [],
                            weight: row.weight ? { value: parseFloat(row.weight), unit: row.weightUnit || 'kg' } : undefined,
                            status: row.status || 'draft',
                            isFeatured: row.isFeatured === 'true' || row.isFeatured === '1',
                            isDigital: row.isDigital === 'true' || row.isDigital === '1'
                        };

                        // Handle specifications
                        if (row.specifications) {
                            try {
                                productData.specifications = JSON.parse(row.specifications);
                            } catch (e) {
                                // If not JSON, treat as simple key-value pairs
                                const specs = row.specifications.split(',').map(spec => {
                                    const [name, value] = spec.split(':');
                                    return { name: name?.trim(), value: value?.trim() };
                                }).filter(spec => spec.name && spec.value);
                                productData.specifications = specs;
                            }
                        }

                        // Handle variants
                        if (row.variants) {
                            try {
                                productData.variants = JSON.parse(row.variants);
                            } catch (e) {
                                errors.push({
                                    row: rowIndex,
                                    error: "Invalid variants JSON format",
                                    field: "variants"
                                });
                            }
                        }

                        // Create product
                        const product = await Product.create(productData);
                        results.push({
                            row: rowIndex,
                            productId: product._id,
                            name: product.name,
                            sku: product.sku,
                            status: 'success'
                        });

                    } catch (error) {
                        console.error(`Error processing row ${rowIndex}:`, error);
                        errors.push({
                            row: rowIndex,
                            error: error.message || 'Unknown error occurred',
                            data: row
                        });
                    }
                }

                // Clean up uploaded file
                fs.unlinkSync(req.file.path);

                return res.status(200).json(
                    new ApiResponse(200, {
                        successful: results.length,
                        failed: errors.length,
                        total: csvData.length,
                        results,
                        errors
                    }, `Import completed: ${results.length} successful, ${errors.length} failed`)
                );

            } catch (error) {
                // Clean up uploaded file
                if (req.file.path && fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                throw new ApiError(500, `Import failed: ${error.message}`);
            }
        });
});

// ✅ GET /api/v1/products/bulk/export - Export products to CSV
const exportProductsToCSV = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const {
        category,
        status = 'all',
        includeVariants = false,
        dateFrom,
        dateTo
    } = req.query;

    // Build filter
    const filter = {};

    // User/Admin filter
    if (req.user.role !== 'admin') {
        filter.sellerId = userId;
    }

    if (status !== 'all') {
        filter.status = status;
    }

    if (category) {
        filter.category = category;
    }

    // Date range filter
    if (dateFrom || dateTo) {
        filter.createdAt = {};
        if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
        if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    try {
        const products = await Product.find(filter)
            .populate('category', 'name')
            .populate('subcategory', 'name')
            .populate('sellerId', 'username firstName lastName')
            .sort({ createdAt: -1 });

        if (products.length === 0) {
            return res.status(200).json(
                new ApiResponse(200, { message: "No products found to export" }, "Export completed")
            );
        }

        // Prepare CSV data
        const csvData = [];

        products.forEach(product => {
            const baseData = {
                id: product._id,
                name: product.name,
                sku: product.sku,
                description: product.description || '',
                price: product.price,
                comparePrice: product.comparePrice || '',
                costPrice: product.costPrice || '',
                stock: product.stock,
                minStock: product.minStock,
                category: product.category?.name || '',
                subcategory: product.subcategory?.name || '',
                brand: product.brand || '',
                tags: product.tags.join(', '),
                features: product.features.join(', '),
                specifications: JSON.stringify(product.specifications),
                weight: product.weight?.value || '',
                weightUnit: product.weight?.unit || '',
                status: product.status,
                isFeatured: product.isFeatured,
                isDigital: product.isDigital,
                averageRating: product.averageRating,
                totalReviews: product.totalReviews,
                viewCount: product.viewCount,
                salesCount: product.salesCount,
                createdAt: product.createdAt,
                seller: product.sellerId?.username || ''
            };

            if (includeVariants && product.variants.length > 0) {
                // Include each variant as a separate row
                product.variants.forEach(variant => {
                    csvData.push({
                        ...baseData,
                        variantId: variant._id,
                        variantSku: variant.sku,
                        variantName: variant.name,
                        variantValue: variant.value,
                        variantPrice: variant.price,
                        variantStock: variant.stock,
                        variantAttributes: JSON.stringify(variant.attributes)
                    });
                });
            } else {
                csvData.push(baseData);
            }
        });

        // Define CSV headers
        const headers = [
            { id: 'id', title: 'Product ID' },
            { id: 'name', title: 'Product Name' },
            { id: 'sku', title: 'SKU' },
            { id: 'description', title: 'Description' },
            { id: 'price', title: 'Price' },
            { id: 'comparePrice', title: 'Compare Price' },
            { id: 'costPrice', title: 'Cost Price' },
            { id: 'stock', title: 'Stock' },
            { id: 'minStock', title: 'Min Stock' },
            { id: 'category', title: 'Category' },
            { id: 'subcategory', title: 'Subcategory' },
            { id: 'brand', title: 'Brand' },
            { id: 'tags', title: 'Tags' },
            { id: 'features', title: 'Features' },
            { id: 'specifications', title: 'Specifications' },
            { id: 'weight', title: 'Weight' },
            { id: 'weightUnit', title: 'Weight Unit' },
            { id: 'status', title: 'Status' },
            { id: 'isFeatured', title: 'Featured' },
            { id: 'isDigital', title: 'Digital' },
            { id: 'averageRating', title: 'Average Rating' },
            { id: 'totalReviews', title: 'Total Reviews' },
            { id: 'viewCount', title: 'View Count' },
            { id: 'salesCount', title: 'Sales Count' },
            { id: 'createdAt', title: 'Created At' },
            { id: 'seller', title: 'Seller' }
        ];

        if (includeVariants) {
            headers.push(
                { id: 'variantId', title: 'Variant ID' },
                { id: 'variantSku', title: 'Variant SKU' },
                { id: 'variantName', title: 'Variant Name' },
                { id: 'variantValue', title: 'Variant Value' },
                { id: 'variantPrice', title: 'Variant Price' },
                { id: 'variantStock', title: 'Variant Stock' },
                { id: 'variantAttributes', title: 'Variant Attributes' }
            );
        }

        // Generate filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `products-export-${timestamp}.csv`;
        const filepath = path.join(__dirname, '../temp', filename);

        // Ensure temp directory exists
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create CSV writer
        const csvWriter = createObjectCsvWriter({
            path: filepath,
            header: headers
        });

        // Write CSV file
        await csvWriter.writeRecords(csvData);

        // Send file as response
        res.download(filepath, filename, (err) => {
            if (err) {
                console.error('File download error:', err);
            }
            // Clean up file after sending
            setTimeout(() => {
                if (fs.existsSync(filepath)) {
                    fs.unlinkSync(filepath);
                }
            }, 60000); // Delete after 1 minute
        });

    } catch (error) {
        console.error('Export error:', error);
        throw new ApiError(500, `Export failed: ${error.message}`);
    }
});

// ✅ POST /api/v1/products/bulk/update-prices - Bulk update product prices
const bulkUpdatePrices = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { updates, updateType = 'absolute' } = req.body; // absolute or percentage

    if (!Array.isArray(updates)) {
        throw new ApiError(400, "Updates must be an array");
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
        try {
            const { productId, sku, price, comparePrice } = update;

            let filter = {};
            if (productId) {
                filter._id = productId;
            } else if (sku) {
                filter.sku = sku.toUpperCase();
            } else {
                errors.push({ update, error: "Either productId or sku is required" });
                continue;
            }

            // Add seller filter for non-admins
            if (req.user.role !== 'admin') {
                filter.sellerId = userId;
            }

            const product = await Product.findOne(filter);
            if (!product) {
                errors.push({ update, error: "Product not found or access denied" });
                continue;
            }

            const updateData = {};

            if (price !== undefined) {
                if (updateType === 'percentage') {
                    updateData.price = product.price * (1 + price / 100);
                } else {
                    updateData.price = price;
                }
            }

            if (comparePrice !== undefined) {
                if (updateType === 'percentage') {
                    updateData.comparePrice = (product.comparePrice || product.price) * (1 + comparePrice / 100);
                } else {
                    updateData.comparePrice = comparePrice;
                }
            }

            await Product.findByIdAndUpdate(product._id, updateData);
            results.push({
                productId: product._id,
                sku: product.sku,
                name: product.name,
                oldPrice: product.price,
                newPrice: updateData.price || product.price,
                status: 'success'
            });

        } catch (error) {
            errors.push({ update, error: error.message });
        }
    }

    return res.status(200).json(
        new ApiResponse(200, {
            successful: results.length,
            failed: errors.length,
            total: updates.length,
            results,
            errors
        }, `Bulk price update completed: ${results.length} successful, ${errors.length} failed`)
    );
});

// ✅ GET /api/v1/products/bulk/template - Download CSV template
const downloadCSVTemplate = asyncHandler(async (req, res) => {
    const templateData = [{
        name: 'Sample Product',
        sku: 'SAMPLE001',
        description: 'This is a sample product description',
        price: 999,
        comparePrice: 1299,
        costPrice: 700,
        stock: 100,
        minStock: 10,
        category: 'Electronics',
        subcategory: 'Mobile Phones',
        brand: 'Sample Brand',
        tags: 'tag1, tag2, tag3',
        features: 'feature1, feature2, feature3',
        specifications: '{"Screen": "6.1 inch", "RAM": "8GB", "Storage": "128GB"}',
        weight: 0.5,
        weightUnit: 'kg',
        status: 'draft',
        isFeatured: false,
        isDigital: false,
        variants: '[]'
    }];

    const headers = [
        { id: 'name', title: 'Product Name (Required)' },
        { id: 'sku', title: 'SKU (Leave empty for auto-generation)' },
        { id: 'description', title: 'Description' },
        { id: 'price', title: 'Price (Required)' },
        { id: 'comparePrice', title: 'Compare Price' },
        { id: 'costPrice', title: 'Cost Price' },
        { id: 'stock', title: 'Stock Quantity' },
        { id: 'minStock', title: 'Minimum Stock' },
        { id: 'category', title: 'Category (Required)' },
        { id: 'subcategory', title: 'Subcategory' },
        { id: 'brand', title: 'Brand' },
        { id: 'tags', title: 'Tags (comma-separated)' },
        { id: 'features', title: 'Features (comma-separated)' },
        { id: 'specifications', title: 'Specifications (JSON format)' },
        { id: 'weight', title: 'Weight Value' },
        { id: 'weightUnit', title: 'Weight Unit' },
        { id: 'status', title: 'Status (draft/active/inactive)' },
        { id: 'isFeatured', title: 'Featured (true/false)' },
        { id: 'isDigital', title: 'Digital Product (true/false)' },
        { id: 'variants', title: 'Variants (JSON format)' }
    ];

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `product-import-template-${timestamp}.csv`;
    const filepath = path.join(__dirname, '../temp', filename);

    // Ensure temp directory exists
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const csvWriter = createObjectCsvWriter({
        path: filepath,
        header: headers
    });

    await csvWriter.writeRecords(templateData);

    res.download(filepath, filename, (err) => {
        if (err) {
            console.error('Template download error:', err);
        }
        // Clean up file after sending
        setTimeout(() => {
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        }, 60000);
    });
});

export {
    importProductsFromCSV,
    exportProductsToCSV,
    bulkUpdatePrices,
    downloadCSVTemplate
};