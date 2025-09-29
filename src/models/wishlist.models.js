import mongoose from 'mongoose';

const WishlistSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },
    addedAt: {
        type: Date,
        default: Date.now
    },
    notes: {
        type: String,
        trim: true,
        maxlength: 500
    }
}, {
    timestamps: true
});

// Compound index to ensure a user can't add the same product twice
WishlistSchema.index({ userId: 1, productId: 1 }, { unique: true });

// Index for efficient querying
WishlistSchema.index({ userId: 1, addedAt: -1 });

export const Wishlist = mongoose.model('Wishlist', WishlistSchema);