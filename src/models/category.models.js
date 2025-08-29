import mongoose from 'mongoose';

const CategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        index: true
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        index: true
    },
    description: {
        type: String,
        trim: true
    },
    parentCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null,
        index: true
    },
    level: {
        type: Number,
        default: 0, // 0 for main category, 1 for subcategory, etc.
        index: true
    },
    image: {
        url: String,
        alt: String
    },
    icon: String, // Icon class or emoji
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    sortOrder: {
        type: Number,
        default: 0
    },
    metaTitle: String,
    metaDescription: String,
    attributes: [{
        name: String,
        type: {
            type: String,
            enum: ['text', 'number', 'boolean', 'select', 'multiselect'],
            default: 'text'
        },
        options: [String], // For select/multiselect types
        required: {
            type: Boolean,
            default: false
        }
    }],
    // SEO and analytics
    path: String, // Full category path like "Electronics/Mobile Phones"
    productCount: {
        type: Number,
        default: 0,
        index: true
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for subcategories
CategorySchema.virtual('subcategories', {
    ref: 'Category',
    localField: '_id',
    foreignField: 'parentCategory'
});

// Generate slug from name
CategorySchema.pre('save', function (next) {
    if (this.isModified('name')) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
    next();
});

// Generate path for category hierarchy
CategorySchema.pre('save', async function (next) {
    if (this.parentCategory) {
        const parent = await mongoose.model('Category').findById(this.parentCategory);
        if (parent) {
            this.path = parent.path ? `${parent.path}/${this.name}` : this.name;
            this.level = parent.level + 1;
        }
    } else {
        this.path = this.name;
        this.level = 0;
    }
    next();
});

// Index for text search
CategorySchema.index({ name: 'text', description: 'text' });

// Compound indexes for better query performance
CategorySchema.index({ isActive: 1, level: 1, sortOrder: 1 });
CategorySchema.index({ parentCategory: 1, isActive: 1, sortOrder: 1 });

export default mongoose.model('Category', CategorySchema);
