# Postman Testing Guide for 100ms Call Integration

## 🚀 Prerequisites

1. **Start your server**: Make sure your FinderNate backend is running
2. **Get JWT Token**: You'll need a valid JWT token for authentication
3. **Create Test Users**: Have at least 2 users in your database
4. **Create Chat**: Have a chat between the test users
5. **Setup 100ms**: Ensure your 100ms credentials are configured

## 🔧 Postman Collection Setup

### Base URL
```
http://localhost:8000/api/v1/calls
```

### Headers for All Requests
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

## 📋 Test Scenarios

### 1. Test Call Initiation (With 100ms Integration)

**Endpoint**: `POST /api/v1/calls/initiate`

**Headers**:
```json
{
  "Authorization": "Bearer YOUR_JWT_TOKEN",
  "Content-Type": "application/json"
}
```

**Request Body**:
```json
{
  "receiverId": "USER_ID_OF_RECEIVER",
  "chatId": "CHAT_ID_BETWEEN_USERS", 
  "callType": "video"
}
```

**Expected Response**:
```json
{
  "statusCode": 201,
  "data": {
    "_id": "call_id_here",
    "participants": [
      {
        "_id": "initiator_user_id",
        "username": "initiator_username",
        "fullName": "Initiator Name",
        "profileImageUrl": "image_url"
      },
      {
        "_id": "receiver_user_id", 
        "username": "receiver_username",
        "fullName": "Receiver Name",
        "profileImageUrl": "image_url"
      }
    ],
    "initiator": {
      "_id": "initiator_user_id",
      "username": "initiator_username"
    },
    "chatId": "chat_id",
    "callType": "video",
    "status": "initiated",
    "hmsRoom": {
      "roomId": "63f1234567890abcdef123456",
      "roomCode": "abc-def-ghi",
      "enabled": true,
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    "hmsTokens": [
      {
        "userId": "initiator_user_id",
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "role": "host",
        "generatedAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "userId": "receiver_user_id",
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "role": "guest", 
        "generatedAt": "2024-01-15T10:30:00.000Z"
      }
    ]
  },
  "message": "Call initiated successfully",
  "success": true
}
```

### 2. Test HMS Auth Token Generation

**Endpoint**: `POST /api/v1/calls/:callId/hms-token`

**Headers**:
```json
{
  "Authorization": "Bearer YOUR_JWT_TOKEN",
  "Content-Type": "application/json"
}
```

**Request Body**:
```json
{
  "role": "guest"
}
```

**Expected Response**:
```json
{
  "statusCode": 200,
  "data": {
    "authToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "roomId": "63f1234567890abcdef123456",
    "roomCode": "abc-def-ghi",
    "role": "guest"
  },
  "message": "HMS auth token generated successfully",
  "success": true
}
```

### 3. Test HMS Room Details

**Endpoint**: `GET /api/v1/calls/:callId/hms-room`

**Headers**:
```json
{
  "Authorization": "Bearer YOUR_JWT_TOKEN"
}
```

**Expected Response**:
```json
{
  "statusCode": 200,
  "data": {
    "call": {
      "id": "call_id_here",
      "status": "initiated",
      "callType": "video",
      "participants": [...]
    },
    "hmsRoom": {
      "id": "63f1234567890abcdef123456",
      "name": "Call-call_id_here",
      "enabled": true,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "templateId": "video_template_id",
      "activeSessions": 0,
      "authToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "userRole": "guest"
    }
  },
  "message": "HMS room details fetched successfully",
  "success": true
}
```

### 4. Test Call Acceptance

**Endpoint**: `PATCH /api/v1/calls/:callId/accept`

**Headers**:
```json
{
  "Authorization": "Bearer RECEIVER_JWT_TOKEN"
}
```

**Expected Response**:
```json
{
  "statusCode": 200,
  "data": {
    "_id": "call_id_here",
    "status": "connecting",
    "startedAt": "2024-01-15T10:31:00.000Z"
  },
  "message": "Call accepted successfully",
  "success": true
}
```

### 5. Test Call End

**Endpoint**: `PATCH /api/v1/calls/:callId/end`

**Headers**:
```json
{
  "Authorization": "Bearer YOUR_JWT_TOKEN"
}
```

**Request Body**:
```json
{
  "endReason": "normal"
}
```

**Expected Response**:
```json
{
  "statusCode": 200,
  "data": {
    "_id": "call_id_here",
    "status": "ended",
    "endedAt": "2024-01-15T10:35:00.000Z",
    "endReason": "normal",
    "hmsRoom": {
      "roomId": "63f1234567890abcdef123456",
      "enabled": false,
      "endedAt": "2024-01-15T10:35:00.000Z"
    }
  },
  "message": "Call ended successfully", 
  "success": true
}
```

### 6. Test Active Call Retrieval

**Endpoint**: `GET /api/v1/calls/active`

**Headers**:
```json
{
  "Authorization": "Bearer YOUR_JWT_TOKEN"
}
```

**Expected Response**:
```json
{
  "statusCode": 200,
  "data": {
    "_id": "call_id_here",
    "participants": [...],
    "status": "active",
    "callType": "video",
    "hmsRoom": {
      "roomId": "63f1234567890abcdef123456",
      "enabled": true
    }
  },
  "message": "Active call fetched successfully",
  "success": true
}
```

## 🧪 Testing Scenarios

### Scenario 1: Complete Call Flow
1. **Initiate Call** → Should create HMS room and tokens
2. **Get HMS Token** → Should return valid token for room
3. **Accept Call** → Should update status to connecting
4. **Get Room Details** → Should show room info and active sessions
5. **End Call** → Should disable HMS room and update status

### Scenario 2: Error Handling
1. **Invalid User ID** → Should return 404
2. **Invalid Chat ID** → Should return 404  
3. **User Already in Call** → Should return 409
4. **Invalid Call ID** → Should return 404
5. **Unauthorized Access** → Should return 403

### Scenario 3: HMS Integration Testing
1. **HMS Room Creation** → Check if room exists in 100ms dashboard
2. **Token Generation** → Verify tokens work with 100ms frontend SDK
3. **Room Cleanup** → Confirm rooms are disabled after call ends

## 🔧 Environment Variables for Testing

Create a `.env.test` file:
```bash
# Test Environment
NODE_ENV=test
MONGODB_URI=your_test_mongodb_uri
JWT_SECRET=your_test_jwt_secret

# 100ms Test Configuration  
HMS_ACCESS_KEY=your_100ms_access_key
HMS_SECRET=your_100ms_secret_key
HMS_VOICE_TEMPLATE_ID=your_voice_template_id
HMS_VIDEO_TEMPLATE_ID=your_video_template_id
```

## 📊 Postman Collection JSON

Create a new collection in Postman and import this JSON:

```json
{
  "info": {
    "name": "FinderNate 100ms Calls API",
    "description": "Testing 100ms video calling integration"
  },
  "variable": [
    {
      "key": "baseUrl",
      "value": "http://localhost:8000/api/v1/calls"
    },
    {
      "key": "authToken",
      "value": "YOUR_JWT_TOKEN_HERE"
    },
    {
      "key": "callId",
      "value": ""
    }
  ],
  "item": [
    {
      "name": "Initiate Call",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{authToken}}"
          },
          {
            "key": "Content-Type", 
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"receiverId\": \"USER_ID_HERE\",\n  \"chatId\": \"CHAT_ID_HERE\",\n  \"callType\": \"video\"\n}"
        },
        "url": {
          "raw": "{{baseUrl}}/initiate",
          "host": ["{{baseUrl}}"],
          "path": ["initiate"]
        }
      }
    },
    {
      "name": "Get HMS Token",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{authToken}}"
          },
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"role\": \"guest\"\n}"
        },
        "url": {
          "raw": "{{baseUrl}}/{{callId}}/hms-token",
          "host": ["{{baseUrl}}"],
          "path": ["{{callId}}", "hms-token"]
        }
      }
    },
    {
      "name": "Get HMS Room Details",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{authToken}}"
          }
        ],
        "url": {
          "raw": "{{baseUrl}}/{{callId}}/hms-room",
          "host": ["{{baseUrl}}"],
          "path": ["{{callId}}", "hms-room"]
        }
      }
    },
    {
      "name": "Accept Call",
      "request": {
        "method": "PATCH",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{authToken}}"
          }
        ],
        "url": {
          "raw": "{{baseUrl}}/{{callId}}/accept",
          "host": ["{{baseUrl}}"],
          "path": ["{{callId}}", "accept"]
        }
      }
    },
    {
      "name": "End Call",
      "request": {
        "method": "PATCH",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{authToken}}"
          },
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"endReason\": \"normal\"\n}"
        },
        "url": {
          "raw": "{{baseUrl}}/{{callId}}/end",
          "host": ["{{baseUrl}}"],
          "path": ["{{callId}}", "end"]
        }
      }
    }
  ]
}
```

## 🐛 Common Issues & Solutions

### Issue 1: "HMS not configured"
**Solution**: Check your environment variables are loaded correctly

### Issue 2: "Failed to create HMS room"  
**Solution**: Verify your 100ms credentials and template IDs

### Issue 3: "Invalid template ID"
**Solution**: Ensure you've created templates in 100ms dashboard

### Issue 4: "Token generation failed"
**Solution**: Check template permissions and user data format

## ✅ Success Indicators

- ✅ Call creation returns HMS room data
- ✅ Auth tokens are generated for participants  
- ✅ Room appears in 100ms dashboard
- ✅ Tokens work with frontend HMS SDK
- ✅ Room is disabled when call ends
- ✅ Webhooks are received (if configured)

Start with the "Initiate Call" endpoint to test the complete 100ms integration!
