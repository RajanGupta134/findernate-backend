import { User } from "../models/user.models.js";
import Business from "../models/business.models.js";
import Post from "../models/userPost.models.js";
import BusinessRating from "../models/businessRating.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
// import { asyncHandler } from "../utlis/asyncHandler.js";
import { getCoordinates } from "../utlis/getCoordinates.js";
import mongoose from "mongoose";

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

    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    // Check if business profile exists
    let business = await Business.findOne({ userId });

    if (business) {
        // Business profile exists, just switch to it
        if (!user.isBusinessProfile) {
            user.isBusinessProfile = true;
            user.businessProfileId = business._id;
            await user.save();
        }

        const businessObj = business.toObject();
        if (businessObj.rating !== undefined) {
            delete businessObj.rating;
        }

        return res.status(200).json(
            new ApiResponse(200, {
                alreadyBusiness: true,
                businessProfile: businessObj,
                message: user.isBusinessProfile ? "Already on business profile" : "Switched to existing business profile"
            }, "Switched to business profile")
        );
    }

    // No business profile exists, create a basic one automatically
    business = await Business.create({
        userId,
        businessName: user.fullName || user.username, // Use user's name as default business name
        businessType: '',
        description: '',
        category: '',
        contact: {
            email: user.email || '',
            phone: user.phoneNumber || ''
        },
        location: {
            address: user.address || '',
            city: '',
            state: '',
            country: ''
        },
        tags: [],
        plan: 'plan1',
        subscriptionStatus: 'pending'
    });

    // Update user profile to business mode
    user.isBusinessProfile = true;
    user.businessProfileId = business._id;
    await user.save();

    // Remove rating from response
    const businessObj = business.toObject();
    if (businessObj.rating !== undefined) {
        delete businessObj.rating;
    }

    return res.status(201).json(
        new ApiResponse(201, {
            alreadyBusiness: false,
            businessProfile: businessObj,
            businessId: business._id,
            message: "Business profile created and switched successfully"
        }, "Business profile created and switched to business mode")
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
        subcategory,
        contact,
        location,
        rating,
        tags,
        website,
        gstNumber,
        aadhaarNumber
    } = req.body;

    // All fields are now optional - no required field validation

    // Validate category against predefined list (only if category is provided)
    if (category && !BUSINESS_CATEGORIES.includes(category)) {
        throw new ApiError(400, `Invalid category. Must be one of: ${BUSINESS_CATEGORIES.join(', ')}`);
    }

    const trimmedBusinessName = businessName ? businessName.trim() : '';
    const normalizedCategory = category ? category.trim() : '';
    const normalizedSubcategory = subcategory ? subcategory.trim() : '';

    // Validate email format (only if contact.email is provided)
    if (contact && contact.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(contact.email)) {
            throw new ApiError(400, "Invalid contact.email format");
        }
    }

    // Validate website (if provided)
    if (website && !/^https?:\/\/.+/.test(website)) {
        throw new ApiError(400, "Invalid website URL");
    }
    if (contact && contact.website && !/^https?:\/\/.+/.test(contact.website)) {
        throw new ApiError(400, "Invalid contact.website URL");
    }

    // Check for duplicate business name (only if business name is provided)
    if (trimmedBusinessName) {
        const existingBusinessByName = await Business.findOne({ businessName: trimmedBusinessName });
        if (existingBusinessByName) {
            throw new ApiError(409, "Business name already in use");
        }
    }

    // Validate GST number format and check for duplicates
    if (gstNumber) {
        // Check GST number length (must be at least 15 characters)
        if (gstNumber.length < 15) {
            throw new ApiError(400, "GST number must be at least 15 characters long");
        }

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
        const autoTags = extractTagsFromText(trimmedBusinessName, description, normalizedCategory, normalizedSubcategory);
        finalTags = autoTags.map(tag => tag.toLowerCase());

    }

    const uniqueTags = [...new Set(finalTags)];

    // Handle location coordinates resolution
    let resolvedLocation = location || {};
    if (location && (location.address || location.city)) {
        const locationString = [location.address, location.city, location.state, location.country]
            .filter(Boolean)
            .join(', ');

        if (locationString) {
            try {
                const coords = await getCoordinates(locationString);
                if (coords?.latitude && coords?.longitude) {
                    resolvedLocation.coordinates = {
                        type: "Point",
                        coordinates: [coords.longitude, coords.latitude]
                    };
                    resolvedLocation.isLiveLocationEnabled = true;
                    resolvedLocation.lastLocationUpdate = new Date();
                }
            } catch (error) {
                console.log('Could not resolve coordinates for business location:', error);
                // Continue without coordinates if resolution fails
            }
        }
    }

    // Create the business profile
    const business = await Business.create({
        userId,
        businessName: trimmedBusinessName,
        businessType,
        description,
        category: normalizedCategory,
        subcategory: normalizedSubcategory,
        contact,
        location: resolvedLocation,
        rating,
        tags: uniqueTags,
        website,
        gstNumber,
        aadhaarNumber,
        plan: 'plan1',
        subscriptionStatus: 'active'
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

    // Define all available plans with simple naming convention
    const allPlans = ['plan1', 'plan2', 'plan3', 'plan4'];
    const validPlans = ['plan1', 'plan2', 'plan3', 'plan4'];

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

    // Get current plan and validate upgrade restrictions
    // Handle legacy plan names (Free, Small Business, Corporate, Enterprise)
    let currentPlan = business.plan || 'plan1';

    // Map legacy plan names to new plan names
    const planMapping = {
        'Free': 'plan1',
        'Small Business': 'plan2',
        'Corporate': 'plan3',
        'Enterprise': 'plan4'
    };

    // Convert legacy plan name to new format if needed
    if (planMapping[currentPlan]) {
        currentPlan = planMapping[currentPlan];
    }

    const currentPlanIndex = allPlans.indexOf(currentPlan);
    const selectedPlanIndex = allPlans.indexOf(plan);

    // Define upgrade restrictions based on current plan
    let allowedUpgrades = [];

    if (currentPlan === 'plan1') {
        // plan1 users can upgrade to plan2, plan3, or plan4
        allowedUpgrades = ['plan2', 'plan3', 'plan4'];
    } else if (currentPlan === 'plan2') {
        // plan2 users can upgrade to plan3 or plan4
        allowedUpgrades = ['plan3', 'plan4'];
    } else if (currentPlan === 'plan3') {
        // plan3 users can upgrade to plan4
        allowedUpgrades = ['plan4'];
    } else if (currentPlan === 'plan4') {
        // plan4 users cannot upgrade further (highest tier)
        allowedUpgrades = [];
    }

    // Check if the selected plan is allowed for upgrade
    if (!allowedUpgrades.includes(plan)) {
        const errorMessage = currentPlan === 'plan4'
            ? 'plan4 is the highest tier plan. No further upgrades available.'
            : `Cannot upgrade from ${currentPlan} to ${plan}. Allowed upgrades: ${allowedUpgrades.join(', ')}`;

        throw new ApiError(400, errorMessage);
    }

    // Set subscriptionStatus: 'active' for all plans
    let subscriptionStatus = 'active';

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
            subscriptionStatus: business.subscriptionStatus,
            allowedUpgrades: allowedUpgrades,
            currentPlan: currentPlan
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
        .select("-gstNumber")
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

    // Get rating summary
    const ratingStats = await BusinessRating.aggregate([
        { $match: { businessId: new mongoose.Types.ObjectId(id) } },
        {
            $group: {
                _id: null,
                totalRatings: { $sum: 1 },
                averageRating: { $avg: '$rating' }
            }
        }
    ]);

    const ratingInfo = ratingStats.length > 0 ? {
        averageRating: Math.round(ratingStats[0].averageRating * 10) / 10,
        totalRatings: ratingStats[0].totalRatings
    } : {
        averageRating: 0,
        totalRatings: 0
    };

    return res.status(200).json(
        new ApiResponse(200, {
            business: {
                ...business,
                rating: ratingInfo.averageRating,
                totalRatings: ratingInfo.totalRatings
            },
            owner
        }, "Business profile fetched successfully")
    );
});

// PATCH /api/v1/business/update  
// Any business plan (plan1, plan2, plan3, plan4) can update their profile including category
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
        subcategory,
        contact,
        location,
        website,
        tags,
        gstNumber
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

    // Validate GST number format and check for duplicates if provided
    if (gstNumber !== undefined) {
        if (gstNumber) {
            // Check GST number length (must be at least 15 characters)
            if (gstNumber.length < 15) {
                throw new ApiError(400, "GST number must be at least 15 characters long");
            }

            // Check for duplicate GST number (excluding current business)
            const existingGST = await Business.findOne({
                gstNumber,
                userId: { $ne: userId }
            });
            if (existingGST) {
                throw new ApiError(409, "GST number already registered");
            }
        }
        business.gstNumber = gstNumber;
    }

    // Update category if provided
    if (category) {
        // Validate category against predefined list
        if (!BUSINESS_CATEGORIES.includes(category)) {
            throw new ApiError(400, `Invalid category. Must be one of: ${BUSINESS_CATEGORIES.join(', ')}`);
        }
        business.category = category.trim();
    }

    // Update subcategory if provided
    if (subcategory) {
        business.subcategory = subcategory.trim();
    }

    // Update other fields if provided
    if (businessType) business.businessType = businessType;
    if (description) business.description = description;

    // Handle location updates with coordinate resolution
    if (location) {
        let resolvedLocation = { ...business.location, ...location };

        // If address or city is updated, try to resolve coordinates
        if (location.address || location.city || location.state || location.country) {
            const locationString = [
                resolvedLocation.address,
                resolvedLocation.city,
                resolvedLocation.state,
                resolvedLocation.country
            ].filter(Boolean).join(', ');

            if (locationString) {
                try {
                    const coords = await getCoordinates(locationString);
                    if (coords?.latitude && coords?.longitude) {
                        resolvedLocation.coordinates = {
                            type: "Point",
                            coordinates: [coords.longitude, coords.latitude]
                        };
                        resolvedLocation.isLiveLocationEnabled = true;
                        resolvedLocation.lastLocationUpdate = new Date();
                    }
                } catch (error) {
                    console.log('Could not resolve coordinates for updated location:', error);
                    // Continue without updating coordinates if resolution fails
                }
            }
        }

        business.location = resolvedLocation;
    }

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
                business.category,
                business.subcategory
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

    const business = await Business.findOne({ userId }).select('category subcategory businessName').lean();
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    return res.status(200).json(
        new ApiResponse(200, {
            category: business.category,
            subcategory: business.subcategory,
            businessName: business.businessName
        }, "Business category and subcategory fetched successfully")
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

// 📍 PATCH /api/v1/business/live-location
export const updateLiveLocation = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { latitude, longitude, address } = req.body;

    if (!latitude || !longitude) {
        throw new ApiError(400, "Latitude and longitude are required for live location");
    }

    // Validate coordinate ranges
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new ApiError(400, "Invalid coordinates provided");
    }

    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    // Update live location
    business.location = {
        ...business.location,
        coordinates: {
            type: "Point",
            coordinates: [longitude, latitude]
        },
        isLiveLocationEnabled: true,
        lastLocationUpdate: new Date()
    };

    // If address is provided, update it too
    if (address) {
        business.location.address = address;
    }

    await business.save();

    return res.status(200).json(
        new ApiResponse(200, {
            location: business.location,
            message: "Live location updated successfully"
        }, "Live location updated successfully")
    );
});

// 📍 POST /api/v1/business/toggle-live-location
export const toggleLiveLocation = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        throw new ApiError(400, "enabled field must be a boolean value");
    }

    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    // Initialize location if it doesn't exist
    if (!business.location) {
        business.location = {};
    }

    business.location.isLiveLocationEnabled = enabled;
    await business.save();

    return res.status(200).json(
        new ApiResponse(200, {
            isLiveLocationEnabled: business.location.isLiveLocationEnabled
        }, `Live location ${enabled ? 'enabled' : 'disabled'} successfully`)
    );
});

// 🔍 GET /api/v1/business/nearby?latitude=X&longitude=Y&radius=Z
export const getNearbyBusinesses = asyncHandler(async (req, res) => {
    const { latitude, longitude, radius = 5000, category, limit = 20 } = req.query;

    if (!latitude || !longitude) {
        throw new ApiError(400, "Latitude and longitude are required");
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radiusInMeters = parseFloat(radius);

    // Validate coordinates
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new ApiError(400, "Invalid coordinates provided");
    }

    // Build query
    let query = {
        'location.coordinates': {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                },
                $maxDistance: radiusInMeters
            }
        },
        'location.isLiveLocationEnabled': true,
        subscriptionStatus: 'active'
    };

    // Filter by category if provided
    if (category && BUSINESS_CATEGORIES.includes(category)) {
        query.category = category;
    }

    const nearbyBusinesses = await Business.find(query)
        .select('-gstNumber -aadhaarNumber')
        .populate('userId', 'username fullName profileImageUrl')
        .limit(parseInt(limit))
        .lean();

    // Calculate distance for each business and add rating info
    const businessesWithDistance = await Promise.all(nearbyBusinesses.map(async (business) => {
        let businessWithDistance = { ...business };

        if (business.location?.coordinates?.coordinates) {
            const [businessLng, businessLat] = business.location.coordinates.coordinates;
            const distance = calculateDistance(lat, lng, businessLat, businessLng);
            businessWithDistance.distance = Math.round(distance * 100) / 100; // Round to 2 decimal places
        }

        // Get rating info for each business
        const ratingStats = await BusinessRating.aggregate([
            { $match: { businessId: new mongoose.Types.ObjectId(business._id) } },
            {
                $group: {
                    _id: null,
                    totalRatings: { $sum: 1 },
                    averageRating: { $avg: '$rating' }
                }
            }
        ]);

        businessWithDistance.rating = ratingStats.length > 0
            ? Math.round(ratingStats[0].averageRating * 10) / 10
            : 0;
        businessWithDistance.totalRatings = ratingStats.length > 0
            ? ratingStats[0].totalRatings
            : 0;

        return businessWithDistance;
    }));

    return res.status(200).json(
        new ApiResponse(200, {
            businesses: businessesWithDistance,
            count: businessesWithDistance.length,
            searchCenter: { latitude: lat, longitude: lng },
            radiusInMeters
        }, "Nearby businesses fetched successfully")
    );
});

// 🧮 Helper function to calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in kilometers
    return distance;
}

// PATCH /api/v1/business/update-category
// Any business plan (plan1, plan2, plan3, plan4) can update category
export const updateBusinessCategory = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { category, subcategory } = req.body;

    // Validate required field
    if (!category) {
        throw new ApiError(400, "Category is required");
    }

    // Validate category against predefined list
    if (!BUSINESS_CATEGORIES.includes(category)) {
        throw new ApiError(400, `Invalid category. Must be one of: ${BUSINESS_CATEGORIES.join(', ')}`);
    }

    // Find the business profile
    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    // Check if user has business profile enabled
    if (!req.user.isBusinessProfile) {
        throw new ApiError(403, "Only business accounts can update category");
    }

    // Update the category
    business.category = category.trim();

    // Update subcategory if provided
    if (subcategory) {
        business.subcategory = subcategory.trim();
    }

    await business.save();

    // Remove rating from response
    const businessObj = business.toObject();
    delete businessObj.rating;

    return res.status(200).json(
        new ApiResponse(200, {
            business: businessObj,
            updatedCategory: business.category,
            updatedSubcategory: business.subcategory
        }, "Business category updated successfully")
    );
});

// GET /api/v1/business/categories - Get all available business categories
export const getBusinessCategories = asyncHandler(async (req, res) => {
    return res.status(200).json(
        new ApiResponse(200, {
            categories: BUSINESS_CATEGORIES,
            totalCategories: BUSINESS_CATEGORIES.length
        }, "Business categories fetched successfully")
    );
});



// ✅ POST /api/v1/business/:businessId/rate
export const rateBusiness = asyncHandler(async (req, res) => {
    const { businessId } = req.params;
    const userId = req.user._id;
    const { rating } = req.body;

    // Validate required fields
    if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new ApiError(400, "Rating must be a number between 1 and 5");
    }

    // Check if business exists
    const business = await Business.findById(businessId);
    if (!business) {
        throw new ApiError(404, "Business not found");
    }

    // Prevent users from rating their own business
    if (business.userId.toString() === userId.toString()) {
        throw new ApiError(403, "Cannot rate your own business");
    }

    // Check if user has already rated this business
    const existingRating = await BusinessRating.findOne({ businessId, userId });

    if (existingRating) {
        // Update existing rating
        existingRating.rating = rating;
        await existingRating.save();
    } else {
        // Create new rating
        await BusinessRating.create({
            businessId,
            userId,
            rating
        });
    }

    // Calculate and update business average rating
    const allRatings = await BusinessRating.find({ businessId });
    const totalRating = allRatings.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = totalRating / allRatings.length;

    // Update business rating
    business.rating = Math.round(averageRating * 10) / 10; // Round to 1 decimal place
    await business.save();

    return res.status(200).json(
        new ApiResponse(200, {
            rating: existingRating ? "updated" : "created",
            businessRating: business.rating,
            totalRatings: allRatings.length
        }, `Business rating ${existingRating ? 'updated' : 'created'} successfully`)
    );
});



// ✅ GET /api/v1/business/:businessId/rating-summary
export const getBusinessRatingSummary = asyncHandler(async (req, res) => {
    const { businessId } = req.params;

    // Check if business exists
    const business = await Business.findById(businessId).select('businessName rating');
    if (!business) {
        throw new ApiError(404, "Business not found");
    }

    // Get rating statistics
    const stats = await BusinessRating.aggregate([
        { $match: { businessId: new mongoose.Types.ObjectId(businessId) } },
        {
            $group: {
                _id: null,
                totalRatings: { $sum: 1 },
                averageRating: { $avg: '$rating' }
            }
        }
    ]);

    if (stats.length === 0) {
        return res.status(200).json(
            new ApiResponse(200, {
                business: {
                    businessName: business.businessName,
                    averageRating: 0,
                    totalRatings: 0
                },
                message: "No ratings yet"
            }, "Business rating summary fetched successfully")
        );
    }

    const stat = stats[0];

    return res.status(200).json(
        new ApiResponse(200, {
            business: {
                businessName: business.businessName,
                averageRating: Math.round(stat.averageRating * 10) / 10,
                totalRatings: stat.totalRatings
            }
        }, "Business rating summary fetched successfully")
    );
});

// ✅ POST /api/v1/business/switch-to-personal
export const switchToPersonalAccount = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    // Check if user is currently a business profile
    if (!user.isBusinessProfile) {
        throw new ApiError(400, "User is already on a personal account");
    }

    // Find the business profile
    const business = await Business.findOne({ userId });
    if (!business) {
        throw new ApiError(404, "Business profile not found");
    }

    // Switch back to personal account
    user.isBusinessProfile = false;
    user.businessProfileId = undefined;
    await user.save();

    // Note: We don't delete the business profile, just disable it
    // This allows users to switch back to business mode later without losing data

    return res.status(200).json(
        new ApiResponse(200, {
            isBusinessProfile: false,
            message: "Successfully switched to personal account"
        }, "Switched to personal account successfully")
    );
});


