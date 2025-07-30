import { User } from "../models/user.models.js";
import Business from "../models/business.models.js";
import Post from "../models/userPost.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";

function extractTagsFromText(...fields) {
    const text = fields.filter(Boolean).join(' ').toLowerCase();
    const words = text.match(/\b\w+\b/g) || [];
    const stopwords = new Set(['the', 'and', 'for', 'with', 'new', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'by', 'is', 'we']);
    return [...new Set(words.filter(word => word.length > 2 && !stopwords.has(word)))];
}

// ✅ POST /api/v1/users/switch-to-business
export const switchToBusinessProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const user = await User.findById(userId).populate("businessProfileId").lean();
    if (!user) throw new ApiError(404, "User not found");

    // Check if business profile exists
    const business = await Business.findOne({ userId }).lean();
    if (user.isBusinessProfile && business) {
        const businessObj = { ...business };
        if (businessObj.rating !== undefined) {
            delete businessObj.rating;
        }
        return res.status(200).json(
            new ApiResponse(200, {
                alreadyBusiness: true,
                businessProfile: businessObj
            }, "Switched to business profile")
        );
    }

    // If not, prompt for registration
    return res.status(200).json(
        new ApiResponse(200, { alreadyBusiness: false }, "Business profile registration required")
    );
});

// ✅ POST /api/v1/business/create
export const createBusinessProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    // Check if user already has business profile
    const existingBusiness = await Business.findOne({ userId });
    if (existingBusiness) {
        throw new ApiError(409, "Business profile already exists");
    }

    // Extract and normalize input
    const {
        businessName,
        businessType,
        description,
        category,
        contact,
        location,
        rating,
        tags,
        website,
        gstNumber,
        aadhaarNumber
    } = req.body;

    if (!businessName || !category || !contact || !contact.email) {
        throw new ApiError(400, "businessName, category, and contact.email are required");
    }

    const trimmedBusinessName = businessName.trim();
    const normalizedCategory = category.trim().toLowerCase();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contact.email)) {
        throw new ApiError(400, "Invalid contact.email format");
    }

    // Validate website (if provided)
    if (website && !/^https?:\/\/.+/.test(website)) {
        throw new ApiError(400, "Invalid website URL");
    }
    if (contact.website && !/^https?:\/\/.+/.test(contact.website)) {
        throw new ApiError(400, "Invalid contact.website URL");
    }

    // Check for duplicate business name
    const existingBusinessByName = await Business.findOne({ businessName: trimmedBusinessName });
    if (existingBusinessByName) {
        throw new ApiError(409, "Business name already in use");
    }

    // Check for duplicate GST number
    if (gstNumber) {
        const existingGST = await Business.findOne({ gstNumber });
        if (existingGST) {
            throw new ApiError(409, "GST number already registered");
        }
    }

    // Automatically generate tags from businessName, description, and category
    const autoTags = extractTagsFromText(trimmedBusinessName, description, normalizedCategory);
    const uniqueTags = [...new Set(autoTags.map(tag => tag.toLowerCase()))];

    // Create the business profile
    const business = await Business.create({
        userId,
        businessName: trimmedBusinessName,
        businessType,
        description,
        category: normalizedCategory,
        contact,
        location,
        rating,
        tags: uniqueTags,
        website,
        gstNumber,
        aadhaarNumber,
        plan: 'Free',
        subscriptionStatus: 'pending'
    });

    // Update user profile
    user.isBusinessProfile = true;
    user.businessProfileId = business._id;
    await user.save();

    return res.status(201).json(
        new ApiResponse(201, { business, tags: uniqueTags, planSelectionRequired: true }, "Business profile created successfully. Please select a subscription plan.")
    );
});

//  DELETE /api/v1/business/delete
export const deleteBusinessProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    // Delete all business-related posts
    const deletedPosts = await Post.deleteMany({
        userId,
        contentType: 'business'
    });

    // Delete the business profile
    await Business.deleteOne({ userId });

    // Update user profile
    user.isBusinessProfile = false;
    user.businessProfileId = undefined;
    await user.save();

    return res.status(200).json(
        new ApiResponse(200, {
            deletedPostsCount: deletedPosts.deletedCount
        }, `Business profile and ${deletedPosts.deletedCount} business posts deleted successfully`)
    );
});

// POST /api/v1/business/select-plan
export const selectBusinessPlan = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { plan } = req.body;
    const validPlans = ['Free', 'Small Business', 'Corporate'];
    if (!validPlans.includes(plan)) {
        throw new ApiError(400, 'Invalid plan selected');
    }

    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(404, 'Business profile not found');
    }

    // Only allow plan selection if user is a business profile
    if (!req.user.isBusinessProfile) {
        throw new ApiError(403, 'Only business accounts can select a plan');
    }

    // Set subscriptionStatus: 'active' for Free, 'pending' for paid plans
    let subscriptionStatus = 'active';
    if (plan === 'Small Business' || plan === 'Corporate') {
        subscriptionStatus = 'pending'; // Payment required
    }

    business.plan = plan;
    business.subscriptionStatus = subscriptionStatus;
    await business.save();

    // Remove 'rating' from the business object in the response
    const businessObj = business.toObject();
    delete businessObj.rating;

    return res.status(200).json(
        new ApiResponse(200, {
            business: businessObj,
            plan: business.plan,
            subscriptionStatus: business.subscriptionStatus
        }, 'Plan selected successfully')
    );
});
