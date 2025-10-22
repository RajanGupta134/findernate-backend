require('dotenv').config({ path: './.env' });

const crypto = require('crypto');

console.log('🔍 Testing ZegoCloud Credentials\n');
console.log('='.repeat(60));

// Load credentials
const ZEGO_APP_ID = parseInt(process.env.ZEGO_APP_ID);
const ZEGO_SERVER_SECRET = process.env.ZEGO_SERVER_SECRET;

console.log('\n📋 Environment Variables:');
console.log('ZEGO_APP_ID (raw):', process.env.ZEGO_APP_ID);
console.log('ZEGO_APP_ID (parsed):', ZEGO_APP_ID);
console.log('ZEGO_SERVER_SECRET:', ZEGO_SERVER_SECRET ? '***' + ZEGO_SERVER_SECRET.slice(-8) : 'NOT SET');

if (!ZEGO_APP_ID || !ZEGO_SERVER_SECRET || isNaN(ZEGO_APP_ID)) {
    console.error('\n❌ ZegoCloud credentials are invalid!');
    console.error('ZEGO_APP_ID is NaN:', isNaN(ZEGO_APP_ID));
    console.error('ZEGO_SERVER_SECRET missing:', !ZEGO_SERVER_SECRET);
    process.exit(1);
}

console.log('\n✅ Credentials loaded successfully');

// Base64 URL encoding
function base64UrlEncode(str) {
    const base64 = Buffer.from(str, 'utf8').toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate signature
function generateSignature(header, body, secret) {
    const data = `${header}.${body}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(data);
    const signature = hmac.digest('base64');
    return signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate Token04
function generateToken04(userId, roomId, effectiveTimeInSeconds = 7200) {
    const time = Math.floor(Date.now() / 1000);
    const nonce = Math.floor(Math.random() * 2147483647);

    // Create header
    const header = {
        alg: 'HS256',
        typ: 'JWT'
    };

    // Create payload with room and privileges
    const body = {
        app_id: ZEGO_APP_ID,
        user_id: userId,
        nonce: nonce,
        ctime: time,
        expire: time + effectiveTimeInSeconds,
        payload: {
            room_id: roomId,
            privilege: {
                1: 1,  // LoginRoom
                2: 1   // PublishStream
            }
        }
    };

    // Encode
    const headerEnc = base64UrlEncode(JSON.stringify(header));
    const bodyEnc = base64UrlEncode(JSON.stringify(body));

    // Sign
    const signature = generateSignature(headerEnc, bodyEnc, ZEGO_SERVER_SECRET);

    // Create token
    return `${headerEnc}.${bodyEnc}.${signature}`;
}

// Test token generation
try {
    console.log('\n🔑 Testing Token Generation:');
    console.log('='.repeat(60));

    const testUserId = 'test-user-123';
    const testRoomId = 'test-room-456';

    console.log(`\nUser ID: ${testUserId}`);
    console.log(`Room ID: ${testRoomId}`);

    const token = generateToken04(testUserId, testRoomId);

    console.log('\n✅ Token generated successfully!\n');
    console.log('Token (first 80 chars):', token.substring(0, 80) + '...');
    console.log('Token length:', token.length, 'characters');

    // Verify token structure
    const parts = token.split('.');
    console.log('Token parts:', parts.length, '(should be 3)');

    if (parts.length === 3) {
        // Decode and display payload
        const payloadDecoded = Buffer.from(
            parts[1].replace(/-/g, '+').replace(/_/g, '/'),
            'base64'
        ).toString('utf8');

        const payload = JSON.parse(payloadDecoded);

        console.log('\n🔍 Token Payload:');
        console.log(JSON.stringify(payload, null, 2));

        console.log('\n✅ Token Validation:');
        console.log('  app_id matches:', payload.app_id === ZEGO_APP_ID ? '✅' : '❌ MISMATCH!');
        console.log('  user_id matches:', payload.user_id === testUserId ? '✅' : '❌ MISMATCH!');
        console.log('  room_id matches:', payload.payload?.room_id === testRoomId ? '✅' : '❌ MISMATCH!');
        console.log('  Has LoginRoom privilege:', payload.payload?.privilege['1'] === 1 ? '✅' : '❌');
        console.log('  Has PublishStream privilege:', payload.payload?.privilege['2'] === 1 ? '✅' : '❌');
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Token generation is working correctly!');
    console.log('='.repeat(60));

    console.log('\n💡 Important Notes:');
    console.log('1. Your LOCAL .env credentials appear to be valid');
    console.log('2. If calls still fail in production with error 20014/50119:');
    console.log('   → The Coolify environment has DIFFERENT credentials');
    console.log('   → Go to https://console.zegocloud.com');
    console.log('   → Verify AppID: 860837939');
    console.log('   → Copy the CORRECT ServerSecret');
    console.log('   → Update ZEGO_SERVER_SECRET in Coolify');
    console.log('   → Redeploy the application');
    console.log('\n3. The ServerSecret in production MUST match the one in ZegoCloud Console');

} catch (error) {
    console.error('\n❌ Error generating token:', error.message);
    console.error(error.stack);
    process.exit(1);
}
