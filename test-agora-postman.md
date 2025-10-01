# Agora Endpoints Testing Guide - Postman

## Prerequisites
- Server running on `http://localhost:3000`
- Valid JWT access token
- An active call ID

---

## Step 1: Login to Get Access Token

**Method:** `POST`
**URL:** `http://localhost:3000/api/v1/users/login`
**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "identifier": "your_username_or_email",
  "password": "your_password"
}
```

**Expected Response:**
```json
{
  "statusCode": 200,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "_id": "USER_ID",
      "username": "username"
    }
  }
}
```

**Action:** Copy the `accessToken` value

---

## Step 2: Initiate a Call

**Method:** `POST`
**URL:** `http://localhost:3000/api/v1/calls/initiate`
**Headers:**
```
Content-Type: application/json
Authorization: Bearer YOUR_ACCESS_TOKEN
```

**Body (JSON):**
```json
{
  "receiverId": "RECEIVER_USER_ID",
  "chatId": "CHAT_ID",
  "callType": "video"
}
```

**Expected Response:**
```json
{
  "statusCode": 201,
  "data": {
    "_id": "CALL_ID",
    "participants": [...],
    "initiator": "USER_ID",
    "chatId": "CHAT_ID",
    "callType": "video",
    "status": "initiated",
    "agoraChannel": {
      "channelName": "call_CALL_ID",
      "appId": "00d6b576e9e140ada2a66237a65b3ea6",
      "createdAt": "2025-10-01T08:30:00.000Z"
    }
  },
  "message": "Call initiated successfully"
}
```

**Action:** Copy the `_id` (CALL_ID)

---

## Step 3: Test GET Agora Token

**Method:** `POST`
**URL:** `http://localhost:3000/api/v1/calls/CALL_ID/agora-token`
**Headers:**
```
Content-Type: application/json
Authorization: Bearer YOUR_ACCESS_TOKEN
```

**Body (JSON):**
```json
{
  "role": "publisher"
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "rtcToken": "006d6b576e9e140ada2a66237a65b3ea6IAC...",
    "rtmToken": "006d6b576e9e140ada2a66237a65b3ea6IAD...",
    "channelName": "call_CALL_ID",
    "appId": "00d6b576e9e140ada2a66237a65b3ea6",
    "uid": 0,
    "userId": "USER_ID"
  }
}
```

---

## Step 4: Test GET Agora Channel Details

**Method:** `GET`
**URL:** `http://localhost:3000/api/v1/calls/CALL_ID/agora-channel`
**Headers:**
```
Authorization: Bearer YOUR_ACCESS_TOKEN
```

**Expected Response:**
```json
{
  "statusCode": 200,
  "data": {
    "call": {
      "id": "CALL_ID",
      "status": "initiated",
      "callType": "video",
      "participants": [...]
    },
    "agoraChannel": {
      "channelName": "call_CALL_ID",
      "appId": "00d6b576e9e140ada2a66237a65b3ea6",
      "rtcToken": "006d6b576e9e140ada2a66237a65b3ea6IAC...",
      "rtmToken": "006d6b576e9e140ada2a66237a65b3ea6IAD...",
      "uid": 0,
      "userRole": "publisher"
    }
  },
  "message": "Agora channel details fetched successfully"
}
```

---

## Quick Test Using cURL

### Test Agora Token Generation:
```bash
curl -X POST http://localhost:3000/api/v1/calls/CALL_ID/agora-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"role":"publisher"}'
```

### Test Agora Channel Details:
```bash
curl -X GET http://localhost:3000/api/v1/calls/CALL_ID/agora-channel \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Common Errors

### 401 Unauthorized
- Your access token is missing or expired
- Solution: Login again to get a new token

### 404 Call not found
- The call ID doesn't exist
- Solution: Create a new call using `/api/v1/calls/initiate`

### 403 You are not a participant in this call
- You're trying to access a call you're not part of
- Solution: Use a call ID where you're a participant

### 400 Call is not active
- The call has already ended
- Solution: Create a new call

### 500 Failed to generate Agora auth tokens
- Agora configuration is missing or invalid
- Check AGORA_APP_ID and AGORA_APP_CERTIFICATE in .env

---

## Environment Variables Check

Make sure these are set in your `.env`:
```
AGORA_APP_ID=00d6b576e9e140ada2a66237a65b3ea6
AGORA_APP_CERTIFICATE=267135e3700a4ec3a76bae061f3684a1
```

---

## Postman Collection (Import This)

```json
{
  "info": {
    "name": "Agora Calling API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "1. Login",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"identifier\": \"your_username\",\n  \"password\": \"your_password\"\n}"
        },
        "url": {
          "raw": "http://localhost:3000/api/v1/users/login",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["api", "v1", "users", "login"]
        }
      }
    },
    {
      "name": "2. Initiate Call",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "Authorization",
            "value": "Bearer {{accessToken}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"receiverId\": \"RECEIVER_USER_ID\",\n  \"chatId\": \"CHAT_ID\",\n  \"callType\": \"video\"\n}"
        },
        "url": {
          "raw": "http://localhost:3000/api/v1/calls/initiate",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["api", "v1", "calls", "initiate"]
        }
      }
    },
    {
      "name": "3. Get Agora Token",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "Authorization",
            "value": "Bearer {{accessToken}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"role\": \"publisher\"\n}"
        },
        "url": {
          "raw": "http://localhost:3000/api/v1/calls/{{callId}}/agora-token",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["api", "v1", "calls", "{{callId}}", "agora-token"]
        }
      }
    },
    {
      "name": "4. Get Agora Channel Details",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{accessToken}}"
          }
        ],
        "url": {
          "raw": "http://localhost:3000/api/v1/calls/{{callId}}/agora-channel",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["api", "v1", "calls", "{{callId}}", "agora-channel"]
        }
      }
    }
  ]
}
```
