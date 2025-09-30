import mongoose from 'mongoose';

const OrderItemSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    variantId: {
        type: mongoose.Schema.Types.ObjectId,
        required: false
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
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
    productDetails: {
        name: String,
        images: [String],
        sku: String,
        currency: String
    },
    variantDetails: {
        name: String,
        value: String,
        sku: String,
        attributes: [{
            name: String,
            value: String
        }]
    },
    sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { _id: true });

const OrderSchema = new mongoose.Schema({
    orderId: {
        type: String,
        unique: true,
        required: true
    },
    buyerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    items: [OrderItemSchema],
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    subtotal: {
        type: Number,
        required: true,
        min: 0
    },
    shippingCost: {
        type: Number,
        default: 0,
        min: 0
    },
    taxes: {
        type: Number,
        default: 0,
        min: 0
    },
    discount: {
        type: Number,
        default: 0,
        min: 0
    },
    currency: {
        type: String,
        default: 'INR'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
        default: 'pending'
    },
    orderStatus: {
        type: String,
        enum: ['placed', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
        default: 'placed'
    },
    shippingAddress: {
        fullName: String,
        phone: String,
        street: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
        landmark: String
    },
    billingAddress: {
        fullName: String,
        phone: String,
        street: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
        landmark: String
    },
    paymentMethod: {
        type: String,
        enum: ['card', 'upi', 'wallet', 'cod', 'netbanking'],
        default: 'cod'
    },
    paymentId: {
        type: String
    },
    trackingInfo: {
        trackingNumber: String,
        courier: String,
        estimatedDelivery: Date
    },
    notes: {
        customerNotes: String,
        adminNotes: String
    },
    placedAt: {
        type: Date,
        default: Date.now
    },
    confirmedAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Pre-save middleware to generate order ID and update timestamps
OrderSchema.pre('save', function(next) {
    if (this.isNew) {
        this.orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }
    this.updatedAt = new Date();
    next();
});

// Virtual for formatted total amount
OrderSchema.virtual('formattedTotal').get(function() {
    return `${this.currency} ${this.totalAmount.toLocaleString()}`;
});

// Indexes for efficient querying
OrderSchema.index({ buyerId: 1, placedAt: -1 });
// OrderSchema.index({ orderId: 1 }); // REMOVED: orderId already has unique index from schema definition
OrderSchema.index({ orderStatus: 1 });
OrderSchema.index({ paymentStatus: 1 });
OrderSchema.index({ 'items.sellerId': 1, placedAt: -1 });

export default mongoose.model('Order', OrderSchema);
