import { User } from "../models/user.models.js";
import Business from "../models/business.models.js";
import Post from "../models/userPost.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";

// Predefined business categories
const BUSINESS_CATEGORIES = [
    "Technology & Software",
    "E-commerce & Retail",
    "Health & Wellness",
    "Education & Training",
    "Finance & Accounting",
    "Marketing & Advertising",
    "Real Estate",
    "Travel & Hospitality",
    "Food & Beverage",
    "Fashion & Apparel",
    "Automotive",
    "Construction & Engineering",
    "Legal & Consulting",
    "Entertainment & Media",
    "Art & Design",
    "Logistics & Transportation",
    "Agriculture & Farming",
    "Manufacturing & Industrial",
    "Non-profit & NGOs",
    "Telecommunications"
];

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

    // Validate category against predefined list
    if (!BUSINESS_CATEGORIES.includes(category)) {
        throw new ApiError(400, `Invalid category. Must be one of: ${BUSINESS_CATEGORIES.join(', ')}`);
    }

    const trimmedBusinessName = businessName.trim();
    const normalizedCategory = category.trim();

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

    // Handle tags: prioritize manual tags from request body, fallback to auto-generation
    let finalTags = [];

    if (tags && Array.isArray(tags) && tags.length > 0) {
        // Validate and use manual tags provided in request body
        finalTags = tags
            .filter(tag => typeof tag === 'string' && tag.trim().length > 0)
            .map(tag => tag.toLowerCase().trim());

        if (finalTags.length === 0) {
            throw new ApiError(400, "Tags must be non-empty strings");
        }

    } else {
        // Fallback to auto-generated tags if no manual tags provided
        const autoTags = extractTagsFromText(trimmedBusinessName, description, normalizedCategory);
        finalTags = autoTags.map(tag => tag.toLowerCase());

    }

    const uniqueTags = [...new Set(finalTags)];

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
        new ApiResponse(201, {
            business,
            businessId: business._id,
            planSelectionRequired: true
        }, "Business profile created successfully.")
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

// GET /api/v1/business/profile
export const getBusinessProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const business = await Business.findOne({ userId }).lean();
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    // Remove rating from response
    const businessObj = { ...business };
    if (businessObj.rating !== undefined) {
        delete businessObj.rating;
    }

    return res.status(200).json(
        new ApiResponse(200, { business: businessObj }, "Business profile fetched successfully")
    );
});

// GET /api/v1/business/:id
export const getBusinessById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const business = await Business.findById(id)
        .select("-gstNumber -rating")
        .lean();

    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    // Get the business owner's username and avatar
    const owner = await User.findById(business.userId)
        .select("username avatar fullName")
        .lean();

    if (!owner) {
        throw new ApiError(404, "Business owner not found");
    }

    return res.status(200).json(
        new ApiResponse(200, {
            business,
            owner
        }, "Business profile fetched successfully")
    );
});

// PATCH /api/v1/business/update
export const updateBusinessProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    const {
        businessName,
        businessType,
        description,
        category,
        contact,
        location,
        website,
        tags
    } = req.body;

    // Validate if businessName is provided and it's not already taken by another business
    if (businessName) {
        const trimmedBusinessName = businessName.trim();
        const existingBusinessByName = await Business.findOne({
            businessName: trimmedBusinessName,
            userId: { $ne: userId } // Exclude current user
        });

        if (existingBusinessByName) {
            throw new ApiError(409, "Business name already in use");
        }

        business.businessName = trimmedBusinessName;
    }

    // Update category if provided
    if (category) {
        // Validate category against predefined list
        if (!BUSINESS_CATEGORIES.includes(category)) {
            throw new ApiError(400, `Invalid category. Must be one of: ${BUSINESS_CATEGORIES.join(', ')}`);
        }
        business.category = category.trim();
    }

    // Update other fields if provided
    if (businessType) business.businessType = businessType;
    if (description) business.description = description;
    if (location) business.location = location;

    // Validate and update contact information
    if (contact) {
        if (contact.email) {
            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(contact.email)) {
                throw new ApiError(400, "Invalid contact.email format");
            }
        }

        if (contact.website && !/^https?:\/\/.+/.test(contact.website)) {
            throw new ApiError(400, "Invalid contact.website URL");
        }

        business.contact = { ...business.contact, ...contact };
    }

    // Validate website URL
    if (website) {
        if (!/^https?:\/\/.+/.test(website)) {
            throw new ApiError(400, "Invalid website URL");
        }
        business.website = website;
    }

    // Update tags: prioritize manual tags from request body
    if (tags && Array.isArray(tags)) {
        if (tags.length > 0) {
            // Validate and use only manual tags provided in request body
            const manualTags = tags
                .filter(tag => typeof tag === 'string' && tag.trim().length > 0)
                .map(tag => tag.toLowerCase().trim());

            if (manualTags.length === 0) {
                throw new ApiError(400, "Tags must be non-empty strings");
            }

            business.tags = [...new Set(manualTags)];

        } else {
            // If empty array provided, clear tags or fallback to auto-generation
            const autoTags = extractTagsFromText(
                business.businessName,
                business.description,
                business.category
            );
            business.tags = [...new Set(autoTags.map(tag => tag.toLowerCase()))];

        }
    }

    await business.save();

    // Remove rating from response
    const businessObj = business.toObject();
    delete businessObj.rating;

    return res.status(200).json(
        new ApiResponse(200, { business: businessObj }, "Business profile updated successfully")
    );
});


// GET /api/v1/business/my-category
export const getMyBusinessCategory = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const business = await Business.findOne({ userId }).select('category businessName').lean();
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    return res.status(200).json(
        new ApiResponse(200, {
            category: business.category,
            businessName: business.businessName
        }, "Business category fetched successfully")
    );
});

// 🔧 Helper function to update existing businesses with active subscriptions
export const updateExistingActiveBusinesses = asyncHandler(async (req, res) => {
    try {
        // Find businesses with active subscription but not verified
        const result = await Business.updateMany(
            {
                subscriptionStatus: 'active',
                isVerified: false
            },
            {
                isVerified: true
            }
        );

        return res.status(200).json(
            new ApiResponse(200, {
                modifiedCount: result.modifiedCount,
                matchedCount: result.matchedCount
            }, `Updated ${result.modifiedCount} businesses with active subscriptions to verified status`)
        );
    } catch (error) {
        throw new ApiError(500, "Error updating existing businesses: " + error.message);
    }
});
