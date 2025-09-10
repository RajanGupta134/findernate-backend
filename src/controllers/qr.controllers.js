import { asyncHandler } from "../utlis/asyncHandler.js";
import { ApiError } from "../utlis/ApiError.js";
import { User } from "../models/user.models.js";
import dynamicQR from "../utlis/dynamicQR.js";
const { generateStyledQR, isValidUsername } = dynamicQR;


const getStyledQRCode = asyncHandler(async (req, res) => {
    const { username } = req.params;
    
    if (!isValidUsername(username)) {
        throw new ApiError(400, "Invalid username format");
    }
    
    // Verify user exists
    const userExists = await User.findOne({ username }).select('_id');
    if (!userExists) {
        throw new ApiError(404, "User not found");
    }
    
    // Fixed constants for consistent premium QR codes
    const styling = {
        size: 256,                    // Fixed size
        frameStyle: 'instagram',      // Fixed Instagram gold yellow style
        primaryColor: '#FFD700',      // Fixed gold color
        backgroundColor: '#FFFEF7',   // Fixed cream background
        logoSize: 0.15               // Fixed logo size (15%)
    };
    
    const styledQRBuffer = await generateStyledQR(username, styling);
    
    res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=1800', // Cache for 30 minutes
        'Content-Disposition': `inline; filename="qr-styled-${username}.png"`,
        'X-Style': 'instagram',
        'X-Generated-At': new Date().toISOString()
    });
    
    res.send(styledQRBuffer);
});

// Get authenticated user's own QR code with embedded profile image
const getMyQRCode = asyncHandler(async (req, res) => {
    const { username } = req.user; // From JWT token
    
    // Fixed constants for consistent premium QR codes
    const styling = {
        size: 256,                    // Fixed size
        frameStyle: 'instagram',      // Fixed Instagram gold yellow style
        primaryColor: '#FFD700',      // Fixed gold color
        backgroundColor: '#FFFEF7',   // Fixed cream background
        logoSize: 0.15               // Fixed logo size (15%)
    };
    
    const styledQRBuffer = await generateStyledQR(username, styling);
    
    res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=1800', 
        'Content-Disposition': `inline; filename="my-qr-${username}.png"`,
        'X-Style': 'instagram',
        'X-Generated-At': new Date().toISOString()
    });
    
    res.send(styledQRBuffer);
});

export {
    getStyledQRCode,
    getMyQRCode
};