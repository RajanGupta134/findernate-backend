# Postman Tests for QR Code API

## Setup Instructions

1. **Environment Variables:**
   - Create environment: "FINDERNATE QR Tests"
   - Set variables:
     - `baseUrl`: `http://localhost:8000` (or your server URL)
     - `testUsername`: A valid username from your database

2. **Prerequisites:**
   - Server running with QR routes enabled
   - At least one user in database for testing

---

## Test Cases

### 1. Gold Yellow QR Code (Fixed Style)
**Generate QR code with premium Instagram gold yellow styling**

```
Method: GET
URL: {{baseUrl}}/api/v1/qr/{{testUsername}}
Headers: None required
```

**Fixed Parameters:**
- Size: `512px` (premium quality)
- Style: Instagram gold yellow (`#FFD700`)
- Background: Cream (`#FFFEF7`)
- No query parameters needed

**Expected Response:**
- Status: 200
- Content-Type: image/png
- Response: Premium gold yellow QR code PNG
- X-Style header: "instagram"

**Test URL:**
```
# Premium gold yellow QR code
http://localhost:8000/api/v1/qr/johndoe
```

---

## Error Test Cases

### 2. Invalid Username
**Test with invalid username format**

```
Method: GET
URL: {{baseUrl}}/api/v1/qr/invalid@username
```

**Expected Response:**
```json
{
  "statusCode": 400,
  "message": "Invalid username format",
  "success": false
}
```

---

### 3. Non-existent User
**Test with username that doesn't exist**

```
Method: GET
URL: {{baseUrl}}/api/v1/qr/nonexistentuser123
```

**Expected Response:**
```json
{
  "statusCode": 404,
  "message": "User not found",
  "success": false
}
```

---

## Quick Testing Checklist

✅ **Basic Functionality:**
- [ ] Styled QR generation works with Instagram gold yellow
- [ ] FINDERNATE purple style works
- [ ] Custom colors override styles

✅ **Error Handling:**
- [ ] Invalid username returns 400
- [ ] Non-existent user returns 404

✅ **Performance:**
- [ ] Images load quickly
- [ ] Different sizes work

**Single Test URL:**
```
http://localhost:8000/api/v1/qr/johndoe?style=instagram&size=512
```