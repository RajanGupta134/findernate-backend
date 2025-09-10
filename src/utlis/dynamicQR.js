import QRCode from 'qrcode';
import { ApiError } from './ApiError.js';

/**
 * Dynamic QR Code Generator - No Database Storage
 * Generates QR codes on-the-fly with Instagram-like features
 */

/**
 * Generate basic dynamic QR code
 * @param {string} username - Username to generate QR for
 * @param {Object} options - Generation options
 * @returns {Buffer} QR code image buffer
 */
export const generateDynamicQR = async (username, options = {}) => {
    try {
        const {
            size = 512,
            primaryColor = '#000000',
            backgroundColor = '#FFFFFF',
            errorCorrection = 'M',
            margin = 2,
            baseUrl = process.env.FRONTEND_URL || 'https://findernate.com'
        } = options;

        // Create profile URL for QR code
        const profileUrl = `${baseUrl}/profile/${username}?utm_source=qr_code`;
        
        // Generate QR code options
        const qrOptions = {
            width: size,
            margin: margin,
            color: {
                dark: primaryColor,
                light: backgroundColor
            },
            errorCorrectionLevel: errorCorrection,
            type: 'png'
        };

        // Generate QR code as buffer
        const qrBuffer = await QRCode.toBuffer(profileUrl, qrOptions);
        return qrBuffer;

    } catch (error) {
        console.error('Dynamic QR generation error:', error);
        throw new ApiError(500, `Failed to generate QR code: ${error.message}`);
    }
};

/**
 * Generate styled QR code with Instagram gold yellow colors
 * Note: Profile image embedding requires canvas which has Windows build issues
 * This version provides beautiful gold yellow QR codes without profile images
 * @param {string} username - Username to generate QR for
 * @param {Object} styling - Styling options
 * @returns {Buffer} Styled QR code image buffer
 */
export const generateStyledQR = async (username, styling = {}) => {
    try {
        const {
            size = 512,
            primaryColor = '#000000',
            backgroundColor = '#FFFFFF',
            frameStyle = 'none',
            profileImageUrl = null,
            baseUrl = process.env.FRONTEND_URL || 'https://findernate.com'
        } = styling;

        const profileUrl = `${baseUrl}/profile/${username}?utm_source=qr_styled`;
        
        // Apply different styling based on frameStyle
        let qrColor = primaryColor;
        let qrBackground = backgroundColor;
        let margin = 4;
        
        if (frameStyle === 'instagram') {
            // Instagram gold yellow - premium look
            qrColor = '#FFD700';
            qrBackground = '#FFFEF7';
            margin = 6;
        } else if (frameStyle === 'findernate') {
            // FINDERNATE brand colors
            qrColor = '#6C5CE7';
            qrBackground = '#F8F9FA';
            margin = 5;
        }
        
        // Generate premium styled QR code with enhanced error correction
        const qrBuffer = await QRCode.toBuffer(profileUrl, {
            width: size,
            margin: margin,
            color: {
                dark: qrColor,
                light: qrBackground
            },
            errorCorrectionLevel: 'H', // High error correction for premium quality
            type: 'png'
        });
        
        return qrBuffer;

    } catch (error) {
        console.error('Styled QR generation error:', error);
        throw new ApiError(500, `Failed to generate styled QR code: ${error.message}`);
    }
};

/**
 * Generate QR code with deep linking for mobile apps
 * @param {string} username - Username to generate QR for
 * @param {string} platform - Platform type (ios, android, universal)
 * @param {Object} options - Additional options
 * @returns {Buffer} Deep link QR code buffer
 */
export const generateDeepLinkQR = async (username, platform = 'universal', options = {}) => {
    try {
        const {
            size = 512,
            primaryColor = '#000000',
            backgroundColor = '#FFFFFF',
            baseUrl = process.env.FRONTEND_URL || 'https://findernate.com'
        } = options;

        let deepLinkUrl;
        
        switch (platform.toLowerCase()) {
            case 'ios':
                // iOS Universal Links - will open app if installed, web if not
                deepLinkUrl = `${baseUrl}/u/${username}?platform=ios&utm_source=qr_deeplink`;
                break;
            case 'android':
                // Android App Links - will open app if installed, web if not
                deepLinkUrl = `${baseUrl}/u/${username}?platform=android&utm_source=qr_deeplink`;
                break;
            case 'universal':
            default:
                // Universal deep link that works for both platforms
                deepLinkUrl = `${baseUrl}/u/${username}?utm_source=qr_deeplink`;
                break;
        }
        
        const qrBuffer = await QRCode.toBuffer(deepLinkUrl, {
            width: size,
            margin: 2,
            color: {
                dark: primaryColor,
                light: backgroundColor
            },
            errorCorrectionLevel: 'M'
        });
        
        return qrBuffer;

    } catch (error) {
        console.error('Deep link QR generation error:', error);
        throw new ApiError(500, `Failed to generate deep link QR code: ${error.message}`);
    }
};

/**
 * Generate QR code data URL (base64) for JSON responses
 * @param {string} username - Username
 * @param {Object} options - Options
 * @returns {string} Base64 data URL
 */
export const generateQRDataURL = async (username, options = {}) => {
    try {
        const {
            size = 256,
            primaryColor = '#000000',
            backgroundColor = '#FFFFFF',
            baseUrl = process.env.FRONTEND_URL || 'https://findernate.com'
        } = options;

        const profileUrl = `${baseUrl}/profile/${username}?utm_source=qr_dataurl`;
        
        const dataURL = await QRCode.toDataURL(profileUrl, {
            width: size,
            margin: 2,
            color: {
                dark: primaryColor,
                light: backgroundColor
            },
            errorCorrectionLevel: 'M'
        });
        
        return dataURL;

    } catch (error) {
        console.error('QR data URL generation error:', error);
        throw new ApiError(500, `Failed to generate QR data URL: ${error.message}`);
    }
};

/**
 * Get QR code analytics/metadata without storing in DB
 * @param {string} username - Username
 * @returns {Object} QR code metadata
 */
export const getQRMetadata = (username) => {
    const baseUrl = process.env.FRONTEND_URL || 'https://findernate.com';
    const profileUrl = `${baseUrl}/profile/${username}`;
    
    return {
        username,
        profileUrl,
        qrUrl: `${baseUrl}/api/v1/qr/${username}`,
        styledQrUrl: `${baseUrl}/api/v1/qr/${username}/styled`,
        deepLinkUrl: `${baseUrl}/api/v1/qr/${username}/mobile`,
        generatedAt: new Date().toISOString(),
        validationUrl: `${baseUrl}/api/v1/users/profile/${username}` // For QR scanners to validate
    };
};

/**
 * Validate username for QR generation
 * @param {string} username - Username to validate
 * @returns {boolean} Is valid
 */
export const isValidUsername = (username) => {
    if (!username || typeof username !== 'string') return false;
    if (username.length < 3 || username.length > 30) return false;
    
    // Check for valid characters (alphanumeric, underscore, dot)
    const validPattern = /^[a-zA-Z0-9_.]+$/;
    return validPattern.test(username);
};

export default {
    generateDynamicQR,
    generateStyledQR,
    generateDeepLinkQR,
    generateQRDataURL,
    getQRMetadata,
    isValidUsername
};