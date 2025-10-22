# ZegoCloud Call Error Troubleshooting Guide

## 🔍 Problem Summary

Your application is experiencing ZegoCloud authentication failures with error codes:
- **Error 20014**: AppConfig authentication failure
- **Error 50119**: Token authentication error during room login

## ✅ What We've Verified

### 1. Token Generation Code ✅
The backend token generation code in `src/config/zego.config.js` is **correct** and follows ZegoCloud's Token04 specification properly.

### 2. Local Environment Variables ✅
Your local `.env` file contains valid credentials:
```
ZEGO_APP_ID=860837939
ZEGO_SERVER_SECRET=6392e886cbf2342d8ba46fffb6158ca1
```

Token generation test **passed successfully** with these credentials.

### 3. Token Structure ✅
Generated tokens include all required fields:
- ✅ `app_id`: 860837939
- ✅ `user_id`: Correctly passed
- ✅ `room_id`: Correctly set in payload
- ✅ Privileges: LoginRoom (1) and PublishStream (2) both enabled
- ✅ Timestamps: `ctime` and `expire` properly set
- ✅ Signature: HMAC-SHA256 with ServerSecret

## ❌ Root Cause

The errors indicate that **ZegoCloud servers are rejecting the token**, which means:

### The ServerSecret in your Coolify production environment is INCORRECT

The authentication errors (20014 and 50119) occur when:
1. The `ZEGO_SERVER_SECRET` doesn't match what's registered in ZegoCloud Console
2. The AppID or ServerSecret pair is invalid or has been regenerated

## 🔧 Solution

### Step 1: Get the Correct ServerSecret from ZegoCloud Console

1. Go to **https://console.zegocloud.com**
2. Login to your account
3. Navigate to **Project Management**
4. Find your project with **AppID: 860837939**
5. Click on **Project Information** or **Basic Information**
6. Copy the **ServerSecret** value

⚠️ **IMPORTANT**: The ServerSecret shown in the console is the ONLY correct value. Do NOT use any other value.

### Step 2: Update Coolify Environment Variables

1. Login to your Coolify dashboard
2. Find your FinderNate backend application
3. Go to **Environment Variables** section
4. Find `ZEGO_SERVER_SECRET`
5. Replace it with the ServerSecret from ZegoCloud Console
6. Save the changes

### Step 3: Redeploy the Application

After updating the environment variable:
1. Click **Redeploy** or **Restart** in Coolify
2. Wait for the deployment to complete
3. Check the application logs to ensure it started successfully

### Step 4: Test the Call Functionality

1. Open your frontend application
2. Try initiating a call
3. Monitor the browser console for errors
4. The call should now connect successfully

## 📊 How to Verify the Fix

### Backend Logs Should Show:
```
🔑 Generated ZegoCloud token for user: <userId> in room: <roomId>
```

### Frontend Should NOT Show:
```
❌ Error 20014 - AppConfig failure
❌ Error 50119 - Token auth error
```

### Call Flow Should Be:
1. **HTTP POST** `/api/v1/calls/initiate` → ✅ 201 Created
2. **Socket Event** `incoming_call` → ✅ Received by other user
3. **ZegoCloud SDK** connects to room → ✅ No authentication errors
4. **Audio/Video** streaming starts → ✅ Call established

## 🔍 Additional Debugging

If the issue persists after updating the ServerSecret:

### 1. Verify Environment Variable is Loaded
Add this temporary log in `src/config/zego.config.js` line 16:
```javascript
console.log('🔍 ZegoCloud Config:', {
    appId: this.appId,
    serverSecretLength: this.serverSecret?.length || 0,
    serverSecretLast4: this.serverSecret?.slice(-4) || 'MISSING'
});
```

### 2. Check ZegoCloud Console Settings
- Verify the AppID is **active** (not suspended or expired)
- Check if there are any **IP restrictions** or **domain restrictions**
- Ensure **RTC service** is enabled for the AppID

### 3. Verify Token is Reaching Frontend
Check the HTTP response from `/api/v1/calls/initiate`:
```json
{
  "zegoRoom": {
    "roomId": "call_xxxxx",
    "appId": 860837939,
    "token": "eyJhbGci..."
  }
}
```

If `token` is null or missing, there's an issue with token generation.

### 4. Check for Token Expiry
Tokens are valid for 2 hours (7200 seconds). If calls fail after 2 hours, it's normal - generate a new token.

## 📝 Prevention

To avoid this issue in the future:

1. **Never commit** `.env` files to version control
2. **Document** where credentials are stored (e.g., password manager)
3. **Use the same ServerSecret** across all environments (dev, staging, prod)
4. **Test immediately** after updating credentials
5. **Keep credentials in sync** between local .env and Coolify

## 🆘 Still Having Issues?

If the problem persists after following all steps above:

1. Double-check you copied the **entire** ServerSecret (no extra spaces)
2. Verify the AppID in Coolify matches: `860837939`
3. Check if ZegoCloud account has any payment or service issues
4. Contact ZegoCloud support with:
   - AppID: 860837939
   - Error codes: 20014 and 50119
   - Timestamp of failed call attempt

## 📚 References

- [ZegoCloud Token Authentication](https://www.zegocloud.com/docs/video-call/advanced-features/authentication-and-encryption)
- [ZegoCloud Console](https://console.zegocloud.com)
- [Token04 Implementation](https://github.com/zegocloud/zego_server_assistant)

---

**Test Script**: Run `node test-zego-simple.cjs` to verify local token generation is working.
