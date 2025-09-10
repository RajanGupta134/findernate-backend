# QR Code API Documentation

Dynamic QR code generation for FINDERNATE user profiles - **No Database Storage Required**

## 🎯 Features

- **Dynamic Generation**: QR codes generated on-the-fly, no database storage
- **Instagram-like Styling**: Custom colors, logos, and frames
- **Deep Linking**: Mobile app integration support
- **Multiple Formats**: Basic, styled, batch generation
- **High Performance**: HTTP caching enabled

## 📱 Endpoints

### Public Endpoints (No Authentication)

#### 1. Basic QR Code
```
GET /api/v1/qr/{username}
```
**Parameters:**
- `size` (optional): QR code size in pixels (default: 512)
- `color` (optional): Foreground color hex (default: #000000)
- `bg` (optional): Background color hex (default: #FFFFFF)
- `margin` (optional): Margin size (default: 2)

**Example:**
```
GET /api/v1/qr/johndoe?size=256&color=%23FF0000&bg=%23F0F0F0
```

**Response:** PNG image

---

#### 2. Styled QR Code with Logo
```
GET /api/v1/qr/{username}/styled
```
**Parameters:**
- `size` (optional): QR code size (default: 512)
- `style` (optional): Frame style - `none|instagram|findernate` (default: none)
- `color` (optional): Foreground color hex
- `bg` (optional): Background color hex
- `logoSize` (optional): Logo size ratio 0-1 (default: 0.15)

**Examples:**
```
GET /api/v1/qr/johndoe/styled?style=instagram&size=512
GET /api/v1/qr/johndoe/styled?style=findernate&color=%236C5CE7
```

**Response:** Styled PNG image with logo

---

#### 3. Mobile Deep Link QR
```
GET /api/v1/qr/{username}/mobile
```
**Parameters:**
- `platform` (optional): Target platform - `ios|android|universal` (default: universal)
- `size` (optional): QR code size (default: 512)
- `color` (optional): Foreground color hex
- `bg` (optional): Background color hex

**Example:**
```
GET /api/v1/qr/johndoe/mobile?platform=ios&size=400
```

**Response:** PNG image with deep link URL

---

#### 4. QR Code Information
```
GET /api/v1/qr/{username}/info
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "user": {
      "username": "johndoe",
      "fullName": "John Doe",
      "profileImageUrl": "https://...",
      "isBusinessProfile": false,
      "privacy": "public"
    },
    "qrInfo": {
      "username": "johndoe",
      "profileUrl": "https://findernate.com/profile/johndoe",
      "qrUrl": "https://findernate.com/api/v1/qr/johndoe",
      "generatedAt": "2024-01-15T10:30:00.000Z"
    },
    "availableFormats": {
      "basic": "https://findernate.com/api/v1/qr/johndoe?size=512",
      "styled": "https://findernate.com/api/v1/qr/johndoe/styled?style=findernate",
      "instagram": "https://findernate.com/api/v1/qr/johndoe/styled?style=instagram",
      "mobile": "https://findernate.com/api/v1/qr/johndoe/mobile"
    }
  }
}
```

---

#### 5. Batch QR Generation
```
GET /api/v1/qr/{username}/batch
```
**Parameters:**
- `formats` (required): Comma-separated formats - `basic,styled,instagram,mobile`

**Example:**
```
GET /api/v1/qr/johndoe/batch?formats=basic,styled,mobile
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "username": "johndoe",
    "qrCodes": {
      "basic": "data:image/png;base64,iVBORw0KGgoAAAANS...",
      "styled": "data:image/png;base64,iVBORw0KGgoAAAANS...",
      "mobile": "data:image/png;base64,iVBORw0KGgoAAAANS..."
    },
    "generatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

#### 6. Validate QR Target
```
GET /api/v1/qr/{username}/validate
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "valid": true,
    "username": "johndoe",
    "fullName": "John Doe",
    "profileImageUrl": "https://...",
    "isPublic": true,
    "profileUrl": "https://findernate.com/profile/johndoe"
  }
}
```

---

### Authenticated Endpoints

#### 7. My QR Code
```
GET /api/v1/qr/my-qr
```
**Headers:**
```
Authorization: Bearer {accessToken}
```

**Parameters:**
- `style` (optional): Style type - `basic|styled|instagram|findernate`
- `size` (optional): QR code size (default: 512)
- `format` (optional): Response format - `image|json` (default: image)

**Examples:**
```
GET /api/v1/qr/my-qr?style=instagram&size=512
GET /api/v1/qr/my-qr?format=json&size=256
```

**Response (format=image):** PNG image
**Response (format=json):**
```json
{
  "statusCode": 200,
  "data": {
    "qrCodeDataURL": "data:image/png;base64,iVBORw0KGgo...",
    "metadata": {
      "username": "johndoe",
      "profileUrl": "https://findernate.com/profile/johndoe",
      "generatedAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

---

## 🎨 Styling Options

### Frame Styles
- **`none`**: Clean QR code without frame
- **`instagram`**: Instagram-style gradient border
- **`findernate`**: FINDERNATE brand color frame

### Color Customization
- Use hex colors with URL encoding: `%23FF0000` for `#FF0000`
- Supports any valid hex color codes
- High contrast recommended for better scanning

### Logo Integration
- Automatic "FN" logo placement in center
- Configurable logo size (15% of QR size recommended)
- White circular background for better readability

---

## 📱 Deep Linking Setup

### Frontend URL Structure
- **Profile URL**: `https://findernate.com/profile/{username}`
- **Deep Link**: `https://findernate.com/u/{username}`
- **Mobile**: `https://findernate.com/u/{username}?platform=ios`

### Mobile App Integration
```javascript
// iOS Universal Links (Info.plist)
<key>com.apple.developer.associated-domains</key>
<array>
    <string>applinks:findernate.com</string>
</array>

// Android App Links (AndroidManifest.xml)
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="findernate.com" />
</intent-filter>
```

---

## ⚡ Performance & Caching

### HTTP Caching
- **Public QR codes**: 1 hour cache
- **Styled QR codes**: 30 minutes cache
- **Private QR codes**: No public cache

### Response Headers
```
Content-Type: image/png
Cache-Control: public, max-age=3600
Content-Disposition: inline; filename="qr-username.png"
X-Generated-At: 2024-01-15T10:30:00.000Z
```

### Best Practices
1. **Size optimization**: Use appropriate sizes (256px for thumbnails, 512px for full display)
2. **Color contrast**: Ensure sufficient contrast for reliable scanning
3. **Error correction**: High error correction used for styled QR codes with logos
4. **Caching**: Leverage HTTP caching to reduce server load

---

## 🔧 Installation Requirements

```bash
npm install qrcode canvas
```

### Environment Variables
```bash
FRONTEND_URL=https://findernate.com
```

---

## 📊 Usage Examples

### React Component
```jsx
const QRDisplay = ({ username, style = 'basic' }) => {
  const qrUrl = `https://api.findernate.com/api/v1/qr/${username}/styled?style=${style}&size=512`;
  
  return (
    <div>
      <img src={qrUrl} alt={`QR Code for ${username}`} />
      <p>Scan to view profile</p>
    </div>
  );
};
```

### Share Functionality
```javascript
const shareQR = async (username) => {
  const qrUrl = `https://api.findernate.com/api/v1/qr/${username}/styled?style=instagram`;
  
  if (navigator.share) {
    await navigator.share({
      title: `${username}'s Profile`,
      text: 'Check out this profile!',
      files: [await fetch(qrUrl).then(r => r.blob())]
    });
  }
};
```

### QR Scanner Integration
```javascript
// When QR is scanned, extract username and redirect
const handleQRScan = (scannedUrl) => {
  const match = scannedUrl.match(/findernate\.com\/(?:profile\/|u\/)([^?]+)/);
  if (match) {
    const username = match[1];
    // Redirect to profile or open in app
    window.location.href = `/profile/${username}`;
  }
};
```

---

## ❌ Error Responses

### User Not Found
```json
{
  "statusCode": 404,
  "message": "User not found",
  "success": false
}
```

### Invalid Username
```json
{
  "statusCode": 400,
  "message": "Invalid username format",
  "success": false
}
```

### Server Error
```json
{
  "statusCode": 500,
  "message": "Failed to generate QR code: [error details]",
  "success": false
}
```

---

This QR code system provides Instagram-level functionality with dynamic generation, custom styling, and mobile app integration - all without database storage overhead!