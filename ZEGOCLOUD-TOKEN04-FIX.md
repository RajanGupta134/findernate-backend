# ZegoCloud Token04 Authentication Fix

## Problem Summary

**Error Codes:**
- Error 20014: `get_appconfig_response` failed
- Error 50119: `token auth err` - Token authentication error
- Error 1102016: `liveroom error` - Final connection failure

**Root Cause:**
The backend was generating **standard JWT tokens** using HMAC-SHA256, but ZegoCloud requires a proprietary **Token04 binary format** with specific encryption and data structure that cannot be replicated with standard JWT libraries.

## Solution

Replaced custom JWT implementation with **official ZegoCloud Token04 generator** from their server assistant library.

### Changes Made

1. **Added Official Token Generator** (`src/config/zegoServerAssistant.js`)
   - Copied from: https://github.com/ZEGOCLOUD/zego_server_assistant
   - Implements proper Token04 binary format
   - Uses AES encryption with specific binary packing
   - Includes: expire time (8 bytes) + IV length (2 bytes) + IV (16 bytes) + encrypted data

2. **Updated ZegoService** (`src/config/zego.config.js`)
   - Now uses `generateToken04()` from official library
   - Removed custom JWT implementation
   - Token format: `'04' + base64(binary_data)` instead of JWT

### Key Differences: JWT vs Token04

| Feature | Old (JWT) | New (Token04) |
|---------|-----------|---------------|
| Format | `header.payload.signature` | `'04' + base64(binary)` |
| Encoding | Base64 URL | Base64 standard |
| Encryption | HMAC-SHA256 | AES-128/192/256-CBC |
| Structure | JSON | Binary (DataView) |
| IV | None | Random 16-char string |

### Token04 Structure

```
+----------+----------+---------+---------------+-------------------+
| Expire   | IV Len   |   IV    | Encrypt Len   | Encrypted Data    |
| (8 bytes)| (2 bytes)|(16 chars)| (2 bytes)     | (variable)        |
+----------+----------+---------+---------------+-------------------+
```

Encrypted Data contains JSON:
```json
{
  "app_id": 860837939,
  "user_id": "user123",
  "nonce": 1234567,
  "ctime": 1761220640,
  "expire": 1761227840,
  "payload": "{\"room_id\":\"room_id\",\"privilege\":{\"1\":1,\"2\":1}}"
}
```

## Verification

✅ ZegoCloud configuration loaded correctly
✅ Server secret is exactly 32 bytes (required)
✅ App ID is valid number: 860837939
✅ Token04 generator properly imported
✅ Backend server restarted successfully

## Testing

1. **Restart Backend**: `npm start` ✅ Done
2. **Test Call**: Try making a voice/video call from frontend
3. **Expected Result**:
   - No error 20014
   - No error 50119
   - Call connects successfully
   - ZegoCloud room joins without authentication errors

## Important Notes

- **Server Secret MUST be exactly 32 bytes** (currently: ✅ 32 bytes)
- Token format starts with `'04'` prefix (version identifier)
- Tokens are Base64-encoded binary data, NOT JWT
- Maximum token validity: 24 days (we use 2 hours)

## Files Changed

1. `src/config/zegoServerAssistant.js` - NEW (official Token04 generator)
2. `src/config/zego.config.js` - UPDATED (uses official generator)

## References

- Official Repo: https://github.com/ZEGOCLOUD/zego_server_assistant
- ZegoCloud Docs: https://docs.zegocloud.com/article/13971
- Token Format: Token04 with AES encryption + binary packing
