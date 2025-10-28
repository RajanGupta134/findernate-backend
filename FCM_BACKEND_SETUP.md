# FCM Backend Setup - Complete Implementation Guide

## Overview

The backend has been successfully updated to support Firebase Cloud Messaging (FCM) for instant call notifications. This guide will help you complete the Firebase configuration.

---

## What Was Implemented

### 1. Firebase Admin SDK Integration
- **Package**: `firebase-admin` installed
- **Configuration**: `src/config/firebase-admin.config.js` created
- **Functions**:
  - `sendNotification()` - Send FCM to single device
  - `sendMulticastNotification()` - Send FCM to multiple devices

### 2. User Model Updates
- **File**: `src/models/user.models.js`
- **New Fields**:
  - `fcmToken` (String) - Stores the device's FCM token
  - `fcmTokenUpdatedAt` (Date) - Timestamp of last token update

### 3. FCM Token Registration Endpoint
- **Route**: `POST /api/v1/users/fcm-token`
- **Controller**: `saveFCMToken` in `src/controllers/user.controllers.js`
- **Function**: Saves FCM token from frontend to user's database record
- **Authentication**: Requires JWT token

### 4. Call Initiation with FCM
- **File**: `src/controllers/call.controllers.js`
- **Changes**:
  - Sends FCM notification to receiver with call details
  - Falls back to Socket.IO if FCM fails
  - Automatically removes invalid FCM tokens
  - Includes caller info, call type, and call UUID in notification

### 5. Stream.io Video Control
- **Files**:
  - `src/config/stream.config.js`
  - `src/controllers/stream.controllers.js`
- **Changes**:
  - Added `videoEnabled` parameter (default: `false`)
  - Video starts disabled when call begins
  - Users can manually enable video later

---

## Firebase Setup Instructions

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"** or select existing project
3. Follow the setup wizard

### Step 2: Get Service Account Key

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Navigate to **"Service accounts"** tab
3. Click **"Generate new private key"**
4. Save the JSON file

### Step 3: Configure Environment Variables

You have **two options** for configuration:

#### Option A: Using Service Account Key File (Development)

1. Save the downloaded JSON file as `serviceAccountKey.json`
2. Place it in the `src/config/` folder
3. Make sure `.gitignore` includes `serviceAccountKey.json`

#### Option B: Using Environment Variables (Production - Recommended)

Add these to your `.env` file:

```bash
# Firebase Admin SDK Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"
```

**Important**:
- The private key must include `\n` for line breaks
- Keep the quotes around the private key
- Never commit these values to Git

**To extract from JSON file**:

```bash
# In your terminal (Linux/Mac):
cat serviceAccountKey.json | jq -r '.project_id'
cat serviceAccountKey.json | jq -r '.client_email'
cat serviceAccountKey.json | jq -r '.private_key'

# Then copy each value to .env
```

---

## Testing the Implementation

### 1. Start Your Backend Server

```bash
npm start
# or
npm run dev
```

**Expected Console Output**:
```
✅ Firebase Admin initialized with environment variables
✅ Stream.io service initialized successfully
```

If you see warnings, check your Firebase credentials.

### 2. Test FCM Token Registration

```bash
# From frontend, the token should auto-register on login
# Check backend logs for:
✅ FCM token saved successfully
```

**Manual Test with cURL**:

```bash
curl -X POST https://thedashman.org/api/v1/users/fcm-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "fcmToken": "test-token-from-firebase"
  }'
```

### 3. Test Call Initiation with FCM

```bash
curl -X POST https://thedashman.org/api/v1/calls/initiate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "receiverId": "receiver-user-id",
    "chatId": "existing-chat-id",
    "callType": "video"
  }'
```

**Expected Backend Logs**:

```
🔔 Attempting to send FCM notification...
📤 Sending FCM to token: eJhbGciOiJSUzI1NiIs...
✅ FCM notification sent successfully: projects/your-project/messages/1234567890
📡 Emitting socket events...
✅ incoming_call event emitted successfully
```

### 4. Test Video Disabled by Default

```bash
curl -X POST https://thedashman.org/api/v1/stream/call/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "callId": "call-mongodb-id",
    "callType": "video",
    "members": ["user-id-1", "user-id-2"],
    "videoEnabled": false
  }'
```

**Expected Backend Logs**:

```
📹 Setting video_enabled to: false for call: call-mongodb-id
📞 Stream.io call created: default:call-mongodb-id (video: false)
```

---

## Call Flow Architecture

### Complete Call Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. CALLER INITIATES CALL                                        │
├─────────────────────────────────────────────────────────────────┤
│ Frontend → POST /api/v1/calls/initiate                          │
│   Body: { receiverId, chatId, callType: "video" }              │
│                                                                  │
│ Backend:                                                         │
│  ✓ Creates Call record in MongoDB (status: "initiated")        │
│  ✓ Generates unique callId (MongoDB ObjectId)                  │
│  ✓ Fetches receiver's FCM token from User model                │
│  ✓ Sends FCM push notification to receiver:                    │
│    {                                                             │
│      title: "Incoming video call",                             │
│      body: "John Doe is calling you...",                       │
│      data: {                                                    │
│        type: "incoming_call",                                  │
│        callId: "507f1f77bcf86cd799439011",                    │
│        callerId: "...",                                        │
│        callerName: "John Doe",                                 │
│        callType: "video"                                       │
│      }                                                          │
│    }                                                            │
│  ✓ Falls back to Socket.IO if FCM fails                       │
│  ✓ Returns callId to caller                                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 2. RECEIVER GETS NOTIFICATION (< 1 SECOND)                      │
├─────────────────────────────────────────────────────────────────┤
│ FCM Push arrives on receiver's device                           │
│ Notification shows with "Accept" and "Decline" buttons          │
│                                                                  │
│ User taps "Accept" →                                            │
│   Frontend → PATCH /api/v1/calls/{callId}/accept               │
│   Backend → Updates call status to "connecting"                 │
│   Backend → Emits Socket event "call_accepted" to caller       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 3. BOTH USERS CONNECT TO STREAM.IO                              │
├─────────────────────────────────────────────────────────────────┤
│ CALLER (on receiving "call_accepted"):                          │
│   Frontend → POST /api/v1/stream/token                         │
│   Frontend → POST /api/v1/stream/call/create                   │
│     Body: {                                                     │
│       callId: "507f1f77bcf86cd799439011",                      │
│       callType: "video",                                       │
│       videoEnabled: false  ← VIDEO DISABLED                    │
│     }                                                           │
│   Frontend → Joins Stream.io room                              │
│                                                                  │
│ RECEIVER (on accepting call):                                   │
│   Frontend → POST /api/v1/stream/token                         │
│   Frontend → Joins same Stream.io room with callId             │
│                                                                  │
│ Stream.io SDK:                                                  │
│  ✓ Establishes WebRTC peer-to-peer connection                  │
│  ✓ Audio enabled automatically                                 │
│  ✓ Video DISABLED by default (videoEnabled: false)             │
│  ✓ Users can manually enable video using UI controls           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 4. CALL ENDS                                                     │
├─────────────────────────────────────────────────────────────────┤
│ Either user → PATCH /api/v1/calls/{callId}/end                 │
│ Backend → Updates call status to "ended"                        │
│ Backend → Records duration                                      │
│ Backend → Emits Socket "call_ended" to both users              │
│ Frontend → Leaves Stream.io room                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints Reference

### 1. Save FCM Token
```
POST /api/v1/users/fcm-token
Headers: Authorization: Bearer <JWT>
Body: { "fcmToken": "string" }
Response: { success: true, data: { fcmToken, updatedAt } }
```

### 2. Initiate Call (with FCM)
```
POST /api/v1/calls/initiate
Headers: Authorization: Bearer <JWT>
Body: {
  "receiverId": "string",
  "chatId": "string",
  "callType": "video" | "voice"
}
Response: { success: true, data: <Call object> }
```

### 3. Create Stream.io Call (with videoEnabled)
```
POST /api/v1/stream/call/create
Headers: Authorization: Bearer <JWT>
Body: {
  "callId": "string",
  "callType": "video" | "voice",
  "members": ["userId1", "userId2"],
  "videoEnabled": false  // NEW: defaults to false
}
Response: {
  success: true,
  data: {
    streamCallType: "default" | "audio_room",
    callId: "string",
    videoEnabled: boolean,
    call: <Stream.io call object>
  }
}
```

---

## Troubleshooting

### FCM Notifications Not Sending

**Check 1: Firebase Credentials**
```bash
# Look for this in server logs:
✅ Firebase Admin initialized with environment variables
# or
⚠️ Firebase Admin SDK not initialized
```

**Solution**: Verify `.env` has correct Firebase credentials

**Check 2: Invalid FCM Token**
```bash
# Backend logs:
❌ FCM notification failed: messaging/invalid-registration-token
```

**Solution**: Frontend needs to re-register FCM token

**Check 3: User Has No FCM Token**
```bash
# Backend logs:
⚠️ No FCM token found for receiver, will use socket fallback
```

**Solution**: Ensure frontend sends FCM token after login

### Video Still Enabled by Default

**Check**: Stream.io call creation logs should show:
```bash
📹 Setting video_enabled to: false for call: <callId>
📞 Stream.io call created: default:<callId> (video: false)
```

**Solution**: Frontend must pass `videoEnabled: false` when creating Stream.io call

### Socket.IO Working But FCM Not

This is **normal** - Socket.IO is the fallback. FCM provides:
- Faster delivery (< 1 second vs 2-5 seconds)
- Works when app is in background
- Better battery life

Both systems work together for reliability.

---

## Environment Variables Summary

Add these to your `.env` file:

```bash
# Existing Stream.io variables
STREAM_API_KEY=your-stream-api-key
STREAM_API_SECRET=your-stream-api-secret

# NEW: Firebase Admin SDK
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# JWT tokens
ACCESS_TOKEN_SECRET=your-jwt-secret
REFRESH_TOKEN_SECRET=your-refresh-secret
```

---

## Files Modified

### Backend Files:
1. ✅ `package.json` - Added `firebase-admin`
2. ✅ `src/config/firebase-admin.config.js` - NEW: Firebase Admin SDK
3. ✅ `src/models/user.models.js` - Added `fcmToken`, `fcmTokenUpdatedAt`
4. ✅ `src/controllers/user.controllers.js` - Added `saveFCMToken`
5. ✅ `src/routes/user.routes.js` - Added `POST /fcm-token`
6. ✅ `src/controllers/call.controllers.js` - Added FCM notification sending
7. ✅ `src/config/stream.config.js` - Added `videoEnabled` parameter
8. ✅ `src/controllers/stream.controllers.js` - Added `videoEnabled` support

---

## Next Steps

1. **Configure Firebase** using the steps above
2. **Update `.env`** with Firebase credentials
3. **Restart backend server**
4. **Test FCM token registration** from frontend
5. **Test call initiation** and verify FCM notification
6. **Verify video is disabled** by default in calls

---

## Support

If you encounter issues:

1. Check backend logs for FCM-related errors
2. Verify Firebase credentials are correct
3. Ensure frontend is sending FCM token after login
4. Test with Socket.IO fallback to isolate FCM issues

The implementation is production-ready with automatic fallbacks and error handling!
