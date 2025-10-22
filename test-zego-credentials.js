import dotenv from 'dotenv';

// Load environment variables FIRST before importing zegoService
dotenv.config();

import zegoService from './src/config/zego.config.js';

console.log('🔍 Testing ZegoCloud Credentials and Token Generation\n');
console.log('=' .repeat(60));

// Check configuration
console.log('\n📋 Configuration Check:');
console.log('ZEGO_APP_ID:', process.env.ZEGO_APP_ID);
console.log('ZEGO_SERVER_SECRET:', process.env.ZEGO_SERVER_SECRET ? '***' + process.env.ZEGO_SERVER_SECRET.slice(-8) : 'NOT SET');
console.log('Is Configured:', zegoService.isConfigured());
console.log('App ID from service:', zegoService.getAppId());

if (!zegoService.isConfigured()) {
    console.error('\n❌ ZegoCloud is NOT configured properly!');
    console.error('Please check your environment variables.');
    process.exit(1);
}

console.log('\n✅ ZegoCloud is configured');

// Test token generation
try {
    console.log('\n🔑 Testing Token Generation:');
    console.log('=' .repeat(60));

    const testUserId = 'test-user-123';
    const testRoomId = 'test-room-456';

    console.log(`\nGenerating token for user: ${testUserId}`);
    console.log(`Room ID: ${testRoomId}`);

    const tokenData = zegoService.generateTokenWithPrivileges(testUserId, testRoomId);

    console.log('\n✅ Token generated successfully!\n');
    console.log('Token Data:');
    console.log('  App ID:', tokenData.appId);
    console.log('  User ID:', tokenData.userId);
    console.log('  Room ID:', tokenData.roomId);
    console.log('  Expires At:', tokenData.expiresAt);
    console.log('  Token (first 50 chars):', tokenData.token.substring(0, 50) + '...');
    console.log('  Token Length:', tokenData.token.length);

    // Decode token to verify structure
    console.log('\n🔍 Token Structure Verification:');
    const parts = tokenData.token.split('.');
    console.log('  Token Parts:', parts.length, '(should be 3: header.payload.signature)');

    if (parts.length === 3) {
        try {
            // Decode header
            const headerDecoded = Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
            console.log('  Header:', headerDecoded);

            // Decode payload
            const payloadDecoded = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
            console.log('  Payload:', payloadDecoded);

            const payload = JSON.parse(payloadDecoded);
            console.log('\n✅ Token Payload Verification:');
            console.log('  app_id:', payload.app_id, payload.app_id === tokenData.appId ? '✅' : '❌');
            console.log('  user_id:', payload.user_id, payload.user_id === testUserId ? '✅' : '❌');
            console.log('  room_id:', payload.payload?.room_id, payload.payload?.room_id === testRoomId ? '✅' : '❌');
            console.log('  privileges:', JSON.stringify(payload.payload?.privilege));
            console.log('  ctime:', payload.ctime, '(created timestamp)');
            console.log('  expire:', payload.expire, '(expiry timestamp)');
            console.log('  nonce:', payload.nonce);

        } catch (decodeError) {
            console.error('❌ Error decoding token parts:', decodeError.message);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 All tests passed! Token generation is working correctly.');
    console.log('='.repeat(60));

    console.log('\n📝 Next Steps:');
    console.log('1. Verify that ZEGO_APP_ID matches your ZegoCloud Console');
    console.log('2. Verify that ZEGO_SERVER_SECRET is correct');
    console.log('3. Check ZegoCloud Console for any app restrictions');
    console.log('4. Ensure the ServerSecret in Coolify matches this local .env');
    console.log('\n💡 If calls still fail with error 20014 or 50119:');
    console.log('   - Go to https://console.zegocloud.com');
    console.log('   - Find AppID: 860837939');
    console.log('   - Copy the ServerSecret and update it in Coolify');
    console.log('   - Redeploy the application');

} catch (error) {
    console.error('\n❌ Error generating token:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
}
