/**
 * Official ZegoCloud Token04 Generator
 * Source: https://github.com/ZEGOCLOUD/zego_server_assistant
 * This is the official implementation for generating Token04 tokens for ZegoCloud
 */

import crypto from 'crypto';

const ErrorCode = {
    success: 0,
    appIDInvalid: 1,
    userIDInvalid: 3,
    secretInvalid: 5,
    effectiveTimeInSecondsInvalid: 6
};

// Function to return random number within given range
function RndNum(a, b) {
    return Math.ceil((a + (b - a)) * Math.random());
}

// Function to generate random 16 character string for IV
function makeRandomIv() {
    const str = '0123456789abcdefghijklmnopqrstuvwxyz';
    const result = [];
    for (let i = 0; i < 16; i++) {
        const r = Math.floor(Math.random() * str.length);
        result.push(str.charAt(r));
    }
    return result.join('');
}

// Function to determine AES algorithm based on key length
function getAlgorithm(keyBase64) {
    const key = Buffer.from(keyBase64);
    switch (key.length) {
        case 16:
            return 'aes-128-cbc';
        case 24:
            return 'aes-192-cbc';
        case 32:
            return 'aes-256-cbc';
    }
    throw new Error('Invalid key length: ' + key.length);
}

// AES encryption function using CBC mode with PKCS5Padding
function aesEncrypt(plainText, key, iv) {
    const cipher = crypto.createCipheriv(getAlgorithm(key), key, iv);
    cipher.setAutoPadding(true);
    const encrypted = cipher.update(plainText);
    const final = cipher.final();
    const out = Buffer.concat([encrypted, final]);
    return Uint8Array.from(out).buffer;
}

/**
 * Generate ZegoCloud Token04
 * This is the official Token04 generation algorithm from ZegoCloud
 *
 * @param {number} appId - Your ZegoCloud App ID
 * @param {string} userId - User ID (must be a string)
 * @param {string} secret - Your ZegoCloud Server Secret (must be exactly 32 bytes)
 * @param {number} effectiveTimeInSeconds - Token validity duration in seconds
 * @param {string} payload - Optional payload as JSON string (e.g., room_id and privileges)
 * @returns {string} Generated Token04 string
 */
export function generateToken04(appId, userId, secret, effectiveTimeInSeconds, payload) {
    // Validate appId
    if (!appId || typeof appId !== 'number') {
        throw {
            errorCode: ErrorCode.appIDInvalid,
            errorMessage: 'appID invalid'
        };
    }

    // Validate userId
    if (!userId || typeof userId !== 'string') {
        throw {
            errorCode: ErrorCode.userIDInvalid,
            errorMessage: 'userId invalid'
        };
    }

    // Validate secret (must be exactly 32 bytes)
    if (!secret || typeof secret !== 'string' || secret.length !== 32) {
        throw {
            errorCode: ErrorCode.secretInvalid,
            errorMessage: 'secret must be a 32 byte string'
        };
    }

    // Validate effectiveTimeInSeconds
    if (!effectiveTimeInSeconds || typeof effectiveTimeInSeconds !== 'number') {
        throw {
            errorCode: ErrorCode.effectiveTimeInSecondsInvalid,
            errorMessage: 'effectiveTimeInSeconds invalid'
        };
    }

    // Get current time in seconds
    const createTime = Math.floor(new Date().getTime() / 1000);

    // Create token info object
    const tokenInfo = {
        app_id: appId,
        user_id: userId,
        nonce: RndNum(-2147483648, 2147483647),
        ctime: createTime,
        expire: createTime + effectiveTimeInSeconds,
        payload: payload || ''
    };

    // Convert to JSON string
    const plaintText = JSON.stringify(tokenInfo);
    console.log('🔐 Token04 plaintext:', plaintText);

    // Generate random IV (16 characters)
    const iv = makeRandomIv();
    console.log('🔐 Token04 IV:', iv);

    // Encrypt the plaintext
    const encryptBuf = aesEncrypt(plaintText, secret, iv);

    // Prepare binary data for Token04 format
    const b1 = new Uint8Array(8);  // 8 bytes for expire time
    const b2 = new Uint8Array(2);  // 2 bytes for IV length
    const b3 = new Uint8Array(2);  // 2 bytes for encrypted data length

    // Set expire time (64-bit big-endian)
    new DataView(b1.buffer).setBigInt64(0, BigInt(tokenInfo.expire), false);

    // Set IV length (16-bit big-endian)
    new DataView(b2.buffer).setUint16(0, iv.length, false);

    // Set encrypted data length (16-bit big-endian)
    new DataView(b3.buffer).setUint16(0, encryptBuf.byteLength, false);

    // Concatenate all parts: expire(8) + ivLen(2) + iv(16) + encryptLen(2) + encrypted(variable)
    const buf = Buffer.concat([
        Buffer.from(b1),
        Buffer.from(b2),
        Buffer.from(iv),
        Buffer.from(b3),
        Buffer.from(encryptBuf),
    ]);

    // Create DataView from buffer
    const dv = new DataView(Uint8Array.from(buf).buffer);

    // Return Token04: version prefix "04" + base64 encoded binary data
    const token = '04' + Buffer.from(dv.buffer).toString('base64');
    console.log('✅ Token04 generated successfully');

    return token;
}

export default { generateToken04 };
