import { User } from "../models/user.models.js";
import Business from "../models/business.models.js";
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
        return res.status(200).json(
            new ApiResponse(200, {
                alreadyBusiness: true,
                businessProfile: business
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
        aadhaarNumber
    });

    // Update user profile
    user.isBusinessProfile = true;
    user.businessProfileId = business._id;
    await user.save();

    return res.status(201).json(
        new ApiResponse(201, { business, tags: uniqueTags }, "Business profile created successfully")
    );
});

// ✅ DELETE /api/v1/business/delete
export const deleteBusinessProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    await Business.deleteOne({ userId });
    user.isBusinessProfile = false;
    user.businessProfileId = undefined;
    await user.save();

    return res.status(200).json(
        new ApiResponse(200, null, "Business profile deleted successfully")
    );
});
