# ZegoCloud Audio/Video Call Integration

This document explains how ZegoCloud has been integrated into the FinderNate backend for audio and video calling.

## Overview

ZegoCloud is a real-time communication (RTC) platform that provides audio/video calling capabilities. This implementation uses ZegoCloud's token-based authentication system to secure calls.

## Prerequisites

1. **ZegoCloud Account**: Sign up at https://console.zegocloud.com
2. **Create a Project**: In the ZegoCloud console, create a new project
3. **Get Credentials**:
   - AppID (numeric)
   - ServerSecret (string)

## Environment Setup

Add the following to your `.env` file:

```env
# ZegoCloud Configuration
ZEGO_APP_ID=your_app_id_here
ZEGO_SERVER_SECRET=your_server_secret_here
```

**Important**:
- `ZEGO_APP_ID` must be a numeric value
- `ZEGO_SERVER_SECRET` is a string used for token generation

## Architecture

### Backend Components

1. **ZegoCloud Service** (`src/config/zego.config.js`)
   - Token generation using JWT-based Token04 algorithm
   - Room-based token generation with privileges
   - No external NPM packages required (uses native crypto)

2. **Call Model** (`src/models/call.models.js`)
   - `zegoRoom` field: Stores room ID, app ID, timestamps
   - `zegoTokens` array: Stores user-specific tokens with expiration

3. **Call Controllers** (`src/controllers/call.controllers.js`)
   - `initiateCall`: Creates ZegoCloud room and generates tokens
   - `acceptCall`: Validates/generates tokens for accepting user
   - `declineCall/endCall`: Marks ZegoCloud room as ended
   - `getZegoToken`: Endpoint to refresh tokens
   - `getZegoRoomDetails`: Get room and token information

4. **Routes** (`src/routes/call.routes.js`)
   - `POST /:callId/zego-token`: Generate/refresh token
   - `GET /:callId/zego-room`: Get room details

## API Endpoints

### 1. Initiate Call
```http
POST /api/v1/calls/initiate
Content-Type: application/json
Authorization: Bearer <token>

{
  "receiverId": "user_id",
  "chatId": "chat_id",
  "callType": "video" // or "voice"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "_id": "call_id",
    "zegoRoom": {
      "roomId": "call_xxx",
      "appId": 123456789
    },
    // ... other call data
  }
}
```

**Socket Event** (to receiver):
```javascript
{
  "event": "incoming_call",
  "data": {
    "callId": "call_id",
    "callType": "video",
    "caller": { /* user info */ },
    "zegoRoom": {
      "roomId": "call_xxx",
      "appId": 123456789,
      "token": "user_token_here"
    }
  }
}
```

### 2. Accept Call
```http
PATCH /api/v1/calls/:callId/accept
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "data": {
    "_id": "call_id",
    "status": "connecting",
    "zegoRoom": {
      "roomId": "call_xxx",
      "appId": 123456789
    },
    "zegoToken": "user_token_here"
  }
}
```

### 3. Get ZegoCloud Token
```http
POST /api/v1/calls/:callId/zego-token
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "data": {
    "token": "jwt_token_here",
    "roomId": "call_xxx",
    "appId": 123456789,
    "userId": "user_id",
    "expiresAt": "2025-10-21T10:00:00.000Z"
  }
}
```

### 4. Get Room Details
```http
GET /api/v1/calls/:callId/zego-room
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "data": {
    "call": {
      "id": "call_id",
      "status": "active",
      "callType": "video"
    },
    "zegoRoom": {
      "roomId": "call_xxx",
      "appId": 123456789,
      "token": "user_token",
      "expiresAt": "2025-10-21T10:00:00.000Z"
    }
  }
}
```

## Frontend Integration

### Installation

```bash
npm install zego-express-engine-webrtc
```

### Basic Usage

```javascript
import { ZegoExpressEngine } from 'zego-express-engine-webrtc';

// 1. Initialize ZegoCloud Engine
const appID = zegoRoom.appId;
const server = 'wss://webliveroom-api.zegocloud.com/ws'; // or your server

const zg = new ZegoExpressEngine(appID, server);

// 2. Login to Room
async function joinCall(roomId, token, userId, userName) {
  try {
    // Login to room
    const result = await zg.loginRoom(
      roomId,
      token,
      { userID: userId, userName: userName },
      { userUpdate: true }
    );

    console.log('Logged in to room:', result);

    // 3. Create and publish local stream
    const localStream = await zg.createStream({
      camera: {
        audio: true,
        video: true,
        videoQuality: 4 // 720p
      }
    });

    // Play local video
    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;

    // Publish stream
    const streamID = 'stream_' + userId;
    zg.startPublishingStream(streamID, localStream);

    // 4. Listen for remote streams
    zg.on('roomStreamUpdate', async (roomID, updateType, streamList) => {
      if (updateType === 'ADD') {
        for (const stream of streamList) {
          const remoteStream = await zg.startPlayingStream(stream.streamID);
          const remoteVideo = document.getElementById('remote-video');
          remoteVideo.srcObject = remoteStream;
        }
      } else if (updateType === 'DELETE') {
        // Handle stream removal
        for (const stream of streamList) {
          zg.stopPlayingStream(stream.streamID);
        }
      }
    });

  } catch (error) {
    console.error('Error joining call:', error);
  }
}

// 5. End Call
async function leaveCall() {
  try {
    zg.stopPublishingStream();
    zg.destroyStream(localStream);
    zg.logoutRoom(roomId);
  } catch (error) {
    console.error('Error leaving call:', error);
  }
}
```

### Complete Call Flow (Frontend)

```javascript
// 1. Caller initiates call
async function initiateCall(receiverId, chatId, callType) {
  const response = await fetch('/api/v1/calls/initiate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ receiverId, chatId, callType })
  });

  const { data } = await response.json();

  // Join ZegoCloud room
  await joinCall(
    data.zegoRoom.roomId,
    data.zegoToken, // Get from response
    currentUserId,
    currentUserName
  );
}

// 2. Receiver gets incoming call via socket
socket.on('incoming_call', async (data) => {
  const { callId, zegoRoom } = data;

  // Show incoming call UI
  showIncomingCallUI(data);

  // When user accepts
  const acceptResponse = await fetch(`/api/v1/calls/${callId}/accept`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const { data: callData } = await acceptResponse.json();

  // Join ZegoCloud room
  await joinCall(
    callData.zegoRoom.roomId,
    callData.zegoToken,
    currentUserId,
    currentUserName
  );
});

// 3. End call
async function endCall(callId) {
  // Leave ZegoCloud room first
  await leaveCall();

  // Update backend
  await fetch(`/api/v1/calls/${callId}/end`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ endReason: 'normal' })
  });
}
```

## Token Security

### Token Structure

ZegoCloud uses JWT-based Token04 with the following structure:

```
header.payload.signature
```

**Header**:
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload**:
```json
{
  "app_id": 123456789,
  "user_id": "user_id_string",
  "nonce": 1234567890,
  "ctime": 1729497600,
  "expire": 1729504800,
  "payload": {
    "room_id": "call_xxx",
    "privilege": {
      "1": 1,  // LoginRoom: 1 = allow
      "2": 1   // PublishStream: 1 = allow
    }
  }
}
```

### Token Expiration

- Default: 7200 seconds (2 hours)
- Tokens are stored in the database with expiration time
- Frontend should refresh tokens if they expire during long calls
- Use `POST /api/v1/calls/:callId/zego-token` to refresh

## Features

### Audio Calls
- High-quality voice communication
- Automatic echo cancellation
- Noise suppression

### Video Calls
- Multiple resolution support (360p, 540p, 720p, 1080p)
- Automatic bandwidth adaptation
- Screen sharing support (if enabled)

### Call Management
- Multiple call states: initiated, ringing, connecting, active, ended
- Call history tracking
- Call duration recording
- Participant management

## Troubleshooting

### Token Generation Errors

**Error**: "ZegoCloud is not properly configured"
- **Solution**: Check that `ZEGO_APP_ID` and `ZEGO_SERVER_SECRET` are set in `.env`

### Connection Issues

**Error**: "Failed to login room"
- **Solution**: Verify token is valid and not expired
- **Solution**: Check that appID matches the one in your ZegoCloud console
- **Solution**: Ensure proper network connectivity

### Stream Issues

**Error**: "Cannot create stream"
- **Solution**: Check browser permissions for camera/microphone
- **Solution**: Verify HTTPS is being used (required for WebRTC)

## Best Practices

1. **Token Refresh**: Implement automatic token refresh 5 minutes before expiration
2. **Error Handling**: Always handle network errors and show user-friendly messages
3. **Cleanup**: Always call `logoutRoom()` and `destroyStream()` when ending calls
4. **Bandwidth**: Use appropriate video quality based on network conditions
5. **Privacy**: Always request user permission before accessing camera/microphone

## Resources

- [ZegoCloud Documentation](https://docs.zegocloud.com)
- [ZegoCloud Console](https://console.zegocloud.com)
- [Web SDK Reference](https://docs.zegocloud.com/article/api?doc=Express_Video_SDK_API~javascript_web~class~ZegoExpressEngine)

## Support

For issues related to:
- **Backend Integration**: Check server logs and database
- **ZegoCloud Service**: Contact ZegoCloud support
- **Frontend Issues**: Check browser console and network tab
