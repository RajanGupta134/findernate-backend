import mongoose from 'mongoose';

const SocialMediaSchema = new mongoose.Schema({
    platform: String,
    url: String
}, { _id: false });

const ContactSchema = new mongoose.Schema({
    phone: String,
    email: { type: String, lowercase: true },
    website: String,
    socialMedia: [SocialMediaSchema]
}, { _id: false });

const LocationSchema = new mongoose.Schema({
    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String
}, { _id: false });

const BusinessSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true, // Ensure one business profile per user
        index: true
    },
    businessName: { type: String, required: true, trim: true },
    businessType: { type: String },
    description: { type: String },
    category: { type: String, required: true },
    contact: ContactSchema,
    location: LocationSchema,
    rating: { type: Number },
    tags: [String],
    website: { type: String },
    gstNumber: { type: String, unique: true, sparse: true },
    aadhaarNumber: { type: String },
    logoUrl: { type: String },
    isVerified: { type: Boolean, default: false },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    insights: {
        views: { type: Number, default: 0 },
        clicks: { type: Number, default: 0 },
        conversions: { type: Number, default: 0 }
    },
    plan: {
        type: String,
        enum: ['Free', 'Small Business', 'Corporate'],
        default: 'Free'
    },
    subscriptionStatus: {
        type: String,
        enum: ['active', 'inactive', 'pending'],
        default: 'pending'
    }
}, { timestamps: true });

// 🚀 Auto-verify business when subscription becomes active
BusinessSchema.pre('save', async function (next) {
    // Check if subscriptionStatus is being modified and set to 'active'
    if (this.isModified('subscriptionStatus') && this.subscriptionStatus === 'active') {
        // Automatically verify the business
        this.isVerified = true;

    }
    next();
});

export default mongoose.model('Business', BusinessSchema);
