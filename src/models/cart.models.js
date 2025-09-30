import mongoose from 'mongoose';

const CartItemSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },
    variantId: {
        type: mongoose.Schema.Types.ObjectId,
        required: false // Optional - only if product has variants
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    totalPrice: {
        type: Number,
        required: true,
        min: 0
    },
    // Store product details for faster access and in case product gets deleted
    productDetails: {
        name: String,
        images: [String],
        sku: String,
        currency: String
    },
    // Store variant details if applicable
    variantDetails: {
        name: String,
        value: String,
        sku: String,
        attributes: [{
            name: String,
            value: String
        }]
    },
    addedAt: {
        type: Date,
        default: Date.now
    }
}, { _id: true });

const CartSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true, // One cart per user
        index: true
    },
    items: [CartItemSchema],
    summary: {
        totalItems: {
            type: Number,
            default: 0,
            min: 0
        },
        totalQuantity: {
            type: Number,
            default: 0,
            min: 0
        },
        subtotal: {
            type: Number,
            default: 0,
            min: 0
        },
        currency: {
            type: String,
            default: 'INR'
        }
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for formatted subtotal
CartSchema.virtual('formattedSubtotal').get(function () {
    return `${this.summary.currency} ${this.summary.subtotal.toLocaleString()}`;
});

// Pre-save middleware to calculate cart summary
CartSchema.pre('save', function (next) {
    // Calculate summary
    this.summary.totalItems = this.items.length;
    this.summary.totalQuantity = this.items.reduce((total, item) => total + item.quantity, 0);
    this.summary.subtotal = this.items.reduce((total, item) => total + item.totalPrice, 0);
    this.lastUpdated = new Date();

    // Calculate total price for each item
    this.items.forEach(item => {
        item.totalPrice = item.price * item.quantity;
    });

    next();
});

// Index for efficient querying
CartSchema.index({ userId: 1, 'items.productId': 1 });
CartSchema.index({ userId: 1, 'items.variantId': 1 });

export const Cart = mongoose.model('Cart', CartSchema);