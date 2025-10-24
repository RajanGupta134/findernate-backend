# Stream.io Integration Setup Guide

This guide will help you set up Stream.io for video/audio calling in your FinderNate application.

## 🎯 Overview

Stream.io provides a robust video and audio calling solution with features like:
- High-quality video/audio calls
- Screen sharing
- Recording capabilities
- Advanced permissions and controls
- Built-in UI components
- Cross-platform support

## 📋 Prerequisites

1. Node.js backend with Express.js
2. Stream.io account (sign up at https://getstream.io/)
3. Frontend with Stream.io Video SDK installed

---

## 🚀 Backend Setup (Already Complete!)

### 1. Dependencies Installed

The following package has been installed:
```bash
npm install @stream-io/node-sdk
```

### 2. Files Created

The following files have been created for you:

#### Configuration File
- **File**: `src/config/stream.config.js`
- **Purpose**: Initializes Stream.io service and provides token generation methods

#### Controller File
- **File**: `src/controllers/stream.controllers.js`
- **Purpose**: Handles API endpoints for token generation and call management

#### Routes File
- **File**: `src/routes/stream.routes.js`
- **Purpose**: Defines API routes for Stream.io operations

---

## 🔑 Getting Your Stream.io Credentials

### Step 1: Sign Up for Stream.io

1. Go to https://getstream.io/
2. Click "Start Free Trial" or "Sign Up"
3. Create your account (you can use your GitHub account for quick signup)

### Step 2: Get Your API Credentials

1. After signing up, you'll be redirected to the Dashboard
2. Go to **Video & Audio** section
3. Click on your app or create a new one
4. Navigate to **API Keys** section
5. Copy your:
   - **API Key** (looks like: `abcd1234efgh5678`)
   - **API Secret** (looks like: `xyz789abc...`)

### Step 3: Add Credentials to .env

Open your `.env` file and update the Stream.io section:

```env
# Stream.io Configuration (for video/audio calls)
# Get your API key and secret from https://getstream.io/
STREAM_API_KEY=your-actual-api-key-here
STREAM_API_SECRET=your-actual-api-secret-here
```

⚠️ **IMPORTANT**:
- Never commit your `.env` file to Git
- Keep your API Secret secure
- Use different credentials for development and production

---

## 📡 API Endpoints

Your backend now provides the following endpoints:

### 1. Generate User Token
**Endpoint**: `POST /api/v1/stream/token`

**Headers**:
```
Authorization: Bearer <your-jwt-token>
```

**Body** (optional):
```json
{
  "expirationSeconds": 86400
}
```

**Response**:
```json
{
  "statusCode": 200,
  "data": {
    "token": "eyJhbGc...",
    "userId": "user123",
    "apiKey": "abcd1234",
    "expiresAt": "2025-01-25T10:00:00.000Z"
  },
  "message": "Stream.io token generated successfully",
  "success": true
}
```

### 2. Generate Call Token
**Endpoint**: `POST /api/v1/stream/call-token`

**Headers**:
```
Authorization: Bearer <your-jwt-token>
```

**Body**:
```json
{
  "callId": "call_123456",
  "permissions": ["create-call", "join-call"],
  "expirationSeconds": 86400
}
```

**Response**:
```json
{
  "statusCode": 200,
  "data": {
    "token": "eyJhbGc...",
    "userId": "user123",
    "callId": "call_123456",
    "apiKey": "abcd1234",
    "expiresAt": "2025-01-25T10:00:00.000Z"
  },
  "message": "Stream.io call token generated successfully",
  "success": true
}
```

### 3. Create Call
**Endpoint**: `POST /api/v1/stream/create-call`

**Headers**:
```
Authorization: Bearer <your-jwt-token>
```

**Body**:
```json
{
  "callId": "call_123456",
  "callType": "default",
  "members": ["user456", "user789"]
}
```

**Response**:
```json
{
  "statusCode": 201,
  "data": {
    "call": { /* call details */ },
    "members": [ /* member details */ ],
    "callId": "call_123456",
    "callType": "default"
  },
  "message": "Stream.io call created successfully",
  "success": true
}
```

### 4. End Call
**Endpoint**: `POST /api/v1/stream/end-call`

**Headers**:
```
Authorization: Bearer <your-jwt-token>
```

**Body**:
```json
{
  "callId": "call_123456",
  "callType": "default"
}
```

### 5. Get Configuration
**Endpoint**: `GET /api/v1/stream/config`

**Headers**:
```
Authorization: Bearer <your-jwt-token>
```

**Response**:
```json
{
  "statusCode": 200,
  "data": {
    "apiKey": "abcd1234",
    "configured": true
  },
  "message": "Stream.io configuration fetched successfully",
  "success": true
}
```

---

## 💻 Frontend Integration

### Step 1: Install Stream.io Video SDK

In your frontend project:

```bash
npm install @stream-io/video-react-sdk
# or
yarn add @stream-io/video-react-sdk
```

### Step 2: Update Your Frontend Code

Replace the hardcoded token generation with API calls:

#### Before (Demo Token):
```typescript
// ❌ Don't use this in production
const token = client.generateUserToken({ user_id: userId });
```

#### After (Production-Ready):
```typescript
// ✅ Use this in production
const fetchStreamToken = async () => {
  try {
    const response = await fetch('https://your-backend.com/api/v1/stream/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userJwtToken}`
      }
    });

    const data = await response.json();
    return data.data.token;
  } catch (error) {
    console.error('Failed to fetch Stream.io token:', error);
    throw error;
  }
};

// Use the token
const token = await fetchStreamToken();
const client = new StreamVideoClient({
  apiKey: data.data.apiKey,
  user: { id: userId },
  token: token
});
```

### Step 3: Update useVideoCall Hook

Update your `useVideoCall.ts` (lines 67 and 121):

```typescript
// Replace hardcoded token with API call
const token = await fetchStreamToken();
```

---

## 🧪 Testing Your Setup

### 1. Test Token Generation

Use this curl command or Postman:

```bash
curl -X POST https://your-backend.com/api/v1/stream/token \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

### 2. Verify Configuration

```bash
curl -X GET https://your-backend.com/api/v1/stream/config \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Check Logs

Start your backend and look for:
```
✅ Stream.io service initialized successfully
📡 Stream.io API Key: abcd1234...
```

If you see:
```
⚠️  Stream.io credentials not configured
```
Then check your `.env` file.

---

## 🔒 Security Best Practices

1. **Never Expose API Secret to Frontend**
   - API Secret should ONLY be on your backend
   - Frontend only receives tokens from backend

2. **Use Short-Lived Tokens**
   - Default expiration is 24 hours (86400 seconds)
   - Refresh tokens before they expire

3. **Validate User Permissions**
   - The backend enforces that users can only generate tokens for themselves
   - Add additional authorization checks as needed

4. **Use HTTPS in Production**
   - All token exchanges should happen over HTTPS
   - Never send tokens over HTTP

5. **Environment Variables**
   - Use different credentials for development and production
   - Never commit `.env` file to version control

---

## 🐛 Troubleshooting

### Issue: "Stream.io service not configured"

**Solution**:
1. Check if `STREAM_API_KEY` and `STREAM_API_SECRET` are set in `.env`
2. Restart your backend server after updating `.env`
3. Verify credentials are correct (no extra spaces)

### Issue: "Failed to generate token"

**Solution**:
1. Verify your Stream.io credentials are valid
2. Check if your Stream.io account is active
3. Look at backend logs for detailed error messages

### Issue: Token expired

**Solution**:
1. Generate a new token by calling `/api/v1/stream/token` again
2. Implement automatic token refresh in your frontend
3. Set a longer `expirationSeconds` if needed (max: 365 days)

---

## 📚 Additional Resources

- **Stream.io Documentation**: https://getstream.io/video/docs/
- **Stream.io Dashboard**: https://dashboard.getstream.io/
- **React SDK Guide**: https://getstream.io/video/docs/react/
- **API Reference**: https://getstream.io/video/docs/api/

---

## 🎉 Next Steps

1. ✅ Get your Stream.io credentials
2. ✅ Update your `.env` file
3. ✅ Restart your backend server
4. ✅ Update your frontend to use the token endpoint
5. ✅ Test a video call
6. 🚀 Deploy to production!

---

## 💡 Tips

- **Free Tier**: Stream.io offers a generous free tier for development
- **Scalability**: Stream.io handles scaling automatically
- **Features**: Explore advanced features like recording, transcription, and analytics
- **UI Components**: Use Stream.io's pre-built UI components to save development time

---

## 📞 Support

If you encounter any issues:
- Check Stream.io documentation: https://getstream.io/video/docs/
- Contact Stream.io support: https://getstream.io/support/
- Review backend logs for detailed error messages

Good luck with your video calling feature! 🎥✨
