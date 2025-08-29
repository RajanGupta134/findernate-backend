import mongoose from 'mongoose';

const VariantSchema = new mongoose.Schema({
    name: String, // e.g., "Size", "Color"
    value: String, // e.g., "Large", "Red"
    price: Number, // Additional price for this variant
    stock: Number,
    images: [{
        url: String,
        alt: String
    }]
}, { _id: true });

const ReviewSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: String,
    images: [String],
    isVerified: {
        type: Boolean,
        default: false
    },
    helpfulCount: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

const ProductSchema = new mongoose.Schema({
    sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        index: 'text'
    },
    slug: {
        type: String,
        unique: true,
        index: true
    },
    description: {
        type: String,
        trim: true,
        index: 'text'
    },
    price: {
        type: Number,
        required: true,
        min: 0,
        index: true
    },
    comparePrice: {
        type: Number, // Original price for showing discounts
        min: 0
    },
    costPrice: {
        type: Number, // Cost price for profit calculation
        min: 0
    },
    currency: {
        type: String,
        default: 'INR'
    },
    stock: {
        type: Number,
        default: 0,
        min: 0,
        index: true
    },
    minStock: {
        type: Number,
        default: 5 // Low stock alert threshold
    },
    trackStock: {
        type: Boolean,
        default: true
    },
    allowBackorder: {
        type: Boolean,
        default: false
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true,
        index: true
    },
    subcategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        index: true
    },
    brand: {
        type: String,
        trim: true,
        index: true
    },
    images: [{
        url: {
            type: String,
            required: true
        },
        alt: String,
        isPrimary: {
            type: Boolean,
            default: false
        },
        sortOrder: {
            type: Number,
            default: 0
        }
    }],
    variants: [VariantSchema],
    specifications: [{
        name: String,
        value: String
    }],
    features: [String],
    tags: [{
        type: String,
        index: true
    }],
    weight: {
        value: Number,
        unit: {
            type: String,
            enum: ['g', 'kg', 'lb', 'oz'],
            default: 'kg'
        }
    },
    dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: {
            type: String,
            enum: ['cm', 'inch', 'm'],
            default: 'cm'
        }
    },
    shippingClass: {
        type: String,
        enum: ['standard', 'express', 'fragile', 'heavy'],
        default: 'standard'
    },
    status: {
        type: String,
        enum: ['draft', 'active', 'inactive', 'archived'],
        default: 'draft',
        index: true
    },
    visibility: {
        type: String,
        enum: ['public', 'private', 'password'],
        default: 'public'
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    isFeatured: {
        type: Boolean,
        default: false,
        index: true
    },
    isDigital: {
        type: Boolean,
        default: false
    },
    digitalFileUrl: String,
    // Reviews and ratings
    reviews: [ReviewSchema],
    averageRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
        index: true
    },
    totalReviews: {
        type: Number,
        default: 0,
        index: true
    },
    // Analytics
    viewCount: {
        type: Number,
        default: 0
    },
    salesCount: {
        type: Number,
        default: 0,
        index: true
    },
    wishlistCount: {
        type: Number,
        default: 0
    },
    // Timestamps
    publishedAt: Date,
    lastRestockAt: Date,
    deletedAt: Date
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for discount percentage
ProductSchema.virtual('discountPercentage').get(function () {
    if (this.comparePrice && this.comparePrice > this.price) {
        return Math.round(((this.comparePrice - this.price) / this.comparePrice) * 100);
    }
    return 0;
});

// Virtual for stock status
ProductSchema.virtual('stockStatus').get(function () {
    if (!this.trackStock) return 'unlimited';
    if (this.stock === 0) return 'out_of_stock';
    if (this.stock <= this.minStock) return 'low_stock';
    return 'in_stock';
});

// Virtual for display price
ProductSchema.virtual('displayPrice').get(function () {
    return {
        amount: this.price,
        currency: this.currency,
        formatted: `${this.currency} ${this.price.toLocaleString()}`
    };
});

// Generate slug from name
ProductSchema.pre('save', function (next) {
    if (this.isModified('name') && !this.slug) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') + '-' + Date.now();
    }
    next();
});

// Update published date when status changes to active
ProductSchema.pre('save', function (next) {
    if (this.isModified('status') && this.status === 'active' && !this.publishedAt) {
        this.publishedAt = new Date();
    }
    next();
});

// Indexes for better performance
ProductSchema.index({ name: 'text', description: 'text', tags: 'text' });
ProductSchema.index({ sellerId: 1, status: 1, isActive: 1 });
ProductSchema.index({ category: 1, status: 1, isActive: 1 });
ProductSchema.index({ brand: 1, status: 1, isActive: 1 });
ProductSchema.index({ price: 1, status: 1, isActive: 1 });
ProductSchema.index({ createdAt: -1, status: 1, isActive: 1 });
ProductSchema.index({ averageRating: -1, status: 1, isActive: 1 });
ProductSchema.index({ salesCount: -1, status: 1, isActive: 1 });
ProductSchema.index({ isFeatured: 1, status: 1, isActive: 1 });

export default mongoose.model('Product', ProductSchema);
