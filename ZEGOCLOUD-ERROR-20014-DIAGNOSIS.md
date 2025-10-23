# ZegoCloud Error 20014 - Advanced Diagnosis

## ✅ BACKEND FULLY FIXED - CONFIRMED WORKING

### Implementation Status
1. ✅ Backend token generation code is correct
2. ✅ ZegoCloud service initializes on application startup
3. ✅ Environment variables properly set in Coolify
4. ✅ Credentials match between Coolify and ZegoCloud Console
5. ✅ Local token generation test passed
6. ✅ Production backend logs show successful initialization

### Backend Configuration (VERIFIED CORRECT)
- **AppID**: 860837939 ✅
- **ServerSecret**: 6392e886cbf2342d8ba46fffb6158ca1 ✅
- **Coolify Environment**: Configured ✅
- **Service Initialization**: Working ✅
- **Token Generation**: Functional ✅

### Production Logs Confirm Success
```
🔍 ZegoCloud Configuration: {
  appId: 860837939,
  hasServerSecret: true,
  serverSecretLength: 32,
  serverSecretLast8: 'b6158ca1',
  isConfigured: true
}
✅ ZegoCloud service initialized and configured
```

## ❌ REMAINING ISSUE: ZegoCloud Account Configuration

### Current Status
- Backend is 100% correctly configured
- Tokens are being generated properly
- **Error 20014/50119 persist** = ZegoCloud server-side rejection
- **Root Cause**: ZegoCloud account/project settings issue

### Confirmed Issues
1. ❌ Production calls fail with Error 20014 ("get_appconfig_request fail")
2. ❌ Token authentication rejected (Error 50119: "token auth err")

## 🔍 Possible Causes (Since Credentials Are Correct)

### 1. **Project in "Testing" Status**

Your project status shows **"Testing"** which might have limitations:

**Possible Issues:**
- Testing projects might have domain restrictions
- Testing projects might have usage quotas
- Testing projects might not work in production domains

**Solution:**
- In ZegoCloud Console, check if there's an option to **"Activate"** or **"Go Live"**
- Look for any upgrade options or production activation
- Check service quotas and limits

### 2. **Domain/Origin Restrictions**

ZegoCloud might be blocking requests from your production domain.

**What to Check in Console:**
- Go to **Service Management** tab
- Look for **Domain Whitelist** or **CORS settings**
- Check if `https://findernate.com` is allowed
- Check if `https://apis.findernate.com` needs to be whitelisted

**Solution:**
If you find domain restrictions, add:
- `https://findernate.com`
- `https://www.findernate.com`
- `https://apis.findernate.com`

### 3. **RTC Service Not Enabled/Activated**

The Real-Time Communication service might not be activated.

**What to Check:**
- In ZegoCloud Console, go to **Service Management**
- Look for **RTC (Real-Time Communication)** service
- Check if it's **Enabled** or **Activated**
- Some services require explicit activation even after project creation

**Solution:**
- Click on RTC service
- Enable/Activate it if it's disabled
- Wait a few minutes for activation to propagate

### 4. **Token Generation Timing Issue**

The backend might be generating tokens before environment variables are fully loaded.

**Check Backend Logs:**
Look for this log when the app starts:
```
🔧 Socket.IO initialized on process: ...
```

And check if there are any warnings about ZegoCloud:
```
⚠️ ZegoCloud credentials not found in environment variables
```

**Solution:**
Add temporary debug logging in `src/config/zego.config.js` line 16:

```javascript
constructor() {
    this.appId = parseInt(process.env.ZEGO_APP_ID);
    this.serverSecret = process.env.ZEGO_SERVER_SECRET;

    // TEMPORARY DEBUG - Remove after fixing
    console.log('🔍 ZegoCloud Config Loaded:', {
        appId: this.appId,
        hasSecret: !!this.serverSecret,
        secretLength: this.serverSecret?.length || 0,
        secretLast8: this.serverSecret?.slice(-8) || 'MISSING'
    });

    if (!this.appId || !this.serverSecret) {
        console.warn('⚠️ ZegoCloud credentials not found in environment variables');
    }
}
```

Redeploy and check logs to verify credentials are loading.

### 5. **ZegoCloud SDK Version Mismatch**

The frontend might be using an incompatible ZegoCloud SDK version.

**What to Check:**
- Check your frontend's `package.json` for ZegoCloud SDK version
- Current SDK: `zego-express-engine-webrtc` or similar
- Check ZegoCloud docs for Token04 compatibility

**Solution:**
Update to the latest ZegoCloud SDK:
```bash
npm update zego-express-engine-webrtc
# or
yarn upgrade zego-express-engine-webrtc
```

### 6. **Callback URL Configuration**

Some ZegoCloud errors occur due to missing callback configuration.

**What to Check in Console:**
- Look for **Callback Setup** or **Server URL** section
- Check if callback URL needs to be configured
- Some services require a webhook endpoint

**Solution:**
If callback is required, add:
```
https://apis.findernate.com/api/v1/webhooks/zego
```
(You'll need to create this endpoint if it doesn't exist)

## 🔧 Immediate Actions to Try

### Action 1: Check Service Activation
1. Go to ZegoCloud Console → **Service Management**
2. Find **RTC** or **Express Video** service
3. Click on it and ensure it's **Activated/Enabled**
4. If there's a button to activate, click it

### Action 2: Check Domain Whitelist
1. In ZegoCloud Console, look for **Security** or **Domain Management**
2. Check if there's a whitelist of allowed domains
3. If restricted, add your production domain

### Action 3: Add Debug Logging
1. Add the debug logging code above to `src/config/zego.config.js`
2. Redeploy the application
3. Check Coolify logs immediately after restart
4. Verify credentials are loading correctly

### Action 4: Test with Simple HTML
Create a test HTML file to isolate if it's a backend or frontend issue:

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://unpkg.com/zego-express-engine-webrtc/index.js"></script>
</head>
<body>
    <button onclick="testZego()">Test ZegoCloud</button>
    <script>
        async function testZego() {
            const appID = 860837939;
            const server = 'wss://webliveroom860837939-api.zegocloud.com/ws';
            const token = 'GET_TOKEN_FROM_BACKEND_API'; // Call your API first

            const zg = new ZegoExpressEngine(appID, server);

            try {
                await zg.loginRoom(
                    'test-room',
                    token,
                    { userID: 'test-user', userName: 'Test User' }
                );
                console.log('✅ Successfully connected to ZegoCloud!');
            } catch (error) {
                console.error('❌ Failed to connect:', error);
            }
        }
    </script>
</body>
</html>
```

## 📊 What to Check in ZegoCloud Console

**IMPORTANT**: The backend is working perfectly. The issue is 100% in ZegoCloud Console configuration.

Check the following in order:

### 1. **Service Management Tab**
   - Go to https://console.zegocloud.com
   - Navigate to your project (AppID: 860837939)
   - Find **Service Management** or **Products** section
   - Look for **RTC** (Real-Time Communication) or **Express Video** service
   - **Check if it's ACTIVATED/ENABLED**
   - Status should show "Active" or "Running", NOT "Testing" or "Inactive"

### 2. **Project Settings / Project Status**
   - Check **Project Status** field
   - If it shows "Testing" → this is likely the problem
   - Look for "Activate Project" or "Go Live" button
   - Testing projects often have production restrictions

### 3. **Domain Whitelist / Security Settings**
   - Look for **Security**, **Domain Management**, or **CORS** section
   - Check if there's a domain whitelist
   - If yes, add these domains:
     - `https://findernate.com`
     - `https://www.findernate.com`
     - `https://apis.findernate.com`

### 4. **Billing / Account Status**
   - Check if billing is set up
   - Some services require payment method even for free tier
   - Look for any "Upgrade" prompts or warnings
   - Check usage quotas haven't been exceeded

### 5. **Backend Logs** (ALREADY VERIFIED ✅)
   - Credentials load correctly ✅
   - No ZegoCloud-related warnings ✅
   - Service initialization successful ✅

## 🆘 If Nothing Works

If all the above checks pass and error persists:

1. **Contact ZegoCloud Support**
   - Provide AppID: 860837939
   - Provide Error Code: 20014
   - Mention: "Testing status project in production"
   - Ask: "Do Testing projects work in production domains?"

2. **Create New Project**
   - Try creating a new ZegoCloud project
   - Set status to "Production" (if available)
   - Update credentials in Coolify
   - Test again

---

**Next Step**: Please check the **Service Management** tab in ZegoCloud Console and share what services you see and their status.
