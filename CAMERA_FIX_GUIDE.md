# Fix Front Camera Default for Stream.io Video Calls

## Problem
When calling from mobile, Stream.io shows back camera as default instead of front-facing camera.

## Solution by Platform

### 1. React Web App (Mobile Browser)

**File: Your video call component (e.g., `VideoCall.jsx` or `VideoCallScreen.jsx`)**

```jsx
import { StreamCall, useCall, useCallStateHooks } from '@stream-io/video-react-sdk';
import { useEffect } from 'react';

function VideoCallComponent({ callId }) {
  const call = useCall();
  const { useLocalParticipant } = useCallStateHooks();

  useEffect(() => {
    const setupFrontCamera = async () => {
      if (!call) return;

      try {
        // IMPORTANT: Must disable camera first if already enabled
        await call.camera.disable();

        // Enable with front camera constraints
        await call.camera.enable({
          facingMode: 'user', // 'user' = front camera
        });

        console.log('✅ Front camera enabled');
      } catch (error) {
        console.error('❌ Camera setup error:', error);
      }
    };

    // Run after joining call
    if (call?.state?.callingState === 'joined') {
      setupFrontCamera();
    }
  }, [call, call?.state?.callingState]);

  return (
    <StreamCall call={call}>
      {/* Your video UI components */}
    </StreamCall>
  );
}
```

### 2. Before Joining the Call (Better Approach)

**Modify your call initialization:**

```jsx
import { useStreamVideoClient } from '@stream-io/video-react-sdk';

function useVideoCall(callId) {
  const client = useStreamVideoClient();
  const [call, setCall] = useState(null);

  const startCall = async () => {
    const newCall = client.call('default', callId);

    // Join the call first
    await newCall.join({ create: true });

    // IMMEDIATELY set front camera after joining
    await newCall.camera.disable(); // Disable default camera
    await newCall.camera.enable({
      facingMode: { ideal: 'user' }, // Front camera
      width: { ideal: 1280 },
      height: { ideal: 720 }
    });

    setCall(newCall);
  };

  return { call, startCall };
}
```

### 3. React Native App

**File: Your video call screen**

```jsx
import { RTCView, mediaDevices } from 'react-native-webrtc';
import { StreamCall } from '@stream-io/video-react-native-sdk';

function VideoScreen({ callId }) {
  const call = useCall();

  useEffect(() => {
    const setupCamera = async () => {
      if (!call) return;

      // Get available devices
      const devices = await mediaDevices.enumerateDevices();
      const frontCamera = devices.find(
        device => device.kind === 'videoinput' && device.facing === 'front'
      );

      if (frontCamera) {
        await call.camera.enable({
          deviceId: frontCamera.deviceId,
          facingMode: 'user'
        });
      }
    };

    setupCamera();
  }, [call]);

  return <StreamCall call={call}>{/* UI */}</StreamCall>;
}
```

### 4. Using Stream.io Call Settings (Backend Approach)

**Modify your backend `stream.config.js` at line 183-211:**

```javascript
// In createCall function, add camera defaults
if (videoEnabled) {
    callData.settings_override = {
        audio: {
            mic_default_on: true,
            speaker_default_on: true,
            default_device: 'speaker'
        },
        video: {
            camera_default_on: true,
            enabled: true,
            camera_facing: 'front', // ADD THIS LINE
            target_resolution: {
                width: 1280,
                height: 720,
                bitrate: 1500000
            }
        },
        ring: {
            auto_cancel_timeout_ms: 30000,
            incoming_call_timeout_ms: 30000
        },
        screensharing: {
            enabled: true,
            access_request_enabled: false
        },
        broadcasting: {
            enabled: false
        }
    };
}
```

## Debugging Steps

### Step 1: Check Current Camera

```javascript
// Add this to your component to see which camera is being used
useEffect(() => {
  if (call?.camera) {
    console.log('Camera state:', call.camera.state);
    console.log('Current device:', call.camera.state.currentDeviceId);
    console.log('Facing mode:', call.camera.state.facingMode);
  }
}, [call?.camera.state]);
```

### Step 2: List Available Cameras

```javascript
const listCameras = async () => {
  if (!call) return;

  const devices = await call.camera.listDevices();
  console.log('Available cameras:', devices);

  // Find front camera
  const frontCamera = devices.find(device =>
    device.label.toLowerCase().includes('front') ||
    device.label.toLowerCase().includes('user') ||
    device.label.toLowerCase().includes('face')
  );

  if (frontCamera) {
    console.log('Front camera found:', frontCamera);
    await call.camera.select(frontCamera.deviceId);
  }
};
```

### Step 3: Manual Camera Selection

```javascript
// Add a button to manually select front camera
const selectFrontCamera = async () => {
  if (!call) return;

  try {
    // Method 1: Using flip
    await call.camera.flip();

    // Method 2: Using select with device ID
    const devices = await call.camera.listDevices();
    const frontCamera = devices.find(d => d.label.includes('front'));
    if (frontCamera) {
      await call.camera.select(frontCamera.deviceId);
    }

    // Method 3: Disable and re-enable with constraints
    await call.camera.disable();
    await call.camera.enable({ facingMode: 'user' });

  } catch (error) {
    console.error('Failed to select front camera:', error);
  }
};
```

## Common Issues & Fixes

### Issue 1: Camera Changes Back to Rear After Join
**Fix:** Apply camera settings AFTER the call is joined:

```javascript
await call.join({ create: true });
// Wait a bit for devices to initialize
await new Promise(resolve => setTimeout(resolve, 500));
await call.camera.disable();
await call.camera.enable({ facingMode: 'user' });
```

### Issue 2: Browser Doesn't Support facingMode
**Fix:** Use device selection instead:

```javascript
const selectFrontCamera = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(d => d.kind === 'videoinput');

  // Usually front camera is first in the list on mobile
  const frontCamera = videoDevices[0];

  await call.camera.select(frontCamera.deviceId);
};
```

### Issue 3: Mobile Browser Permissions
Make sure you have:
1. HTTPS (camera requires secure context)
2. Proper permissions in manifest/meta tags
3. User gesture (button click) to trigger camera access

```html
<!-- Add to your HTML head for mobile -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

## Testing Checklist

- [ ] HTTPS is enabled (camera won't work on HTTP)
- [ ] Camera permissions granted
- [ ] Console shows "Front camera enabled" log
- [ ] Tested on actual mobile device (not just browser DevTools)
- [ ] Camera is enabled AFTER call.join() completes
- [ ] Backend call settings include camera_facing: 'front'

## Full Example Implementation

```jsx
import { StreamVideo, StreamCall, useCall } from '@stream-io/video-react-sdk';
import { useEffect, useState } from 'react';

function VideoCallScreen({ callId, userId, token, apiKey }) {
  const [client, setClient] = useState(null);
  const [call, setCall] = useState(null);

  useEffect(() => {
    const initCall = async () => {
      // 1. Initialize client
      const videoClient = new StreamVideo({
        apiKey,
        user: { id: userId },
        token
      });
      setClient(videoClient);

      // 2. Create call
      const newCall = videoClient.call('default', callId);

      // 3. Join call
      await newCall.join({ create: true });

      // 4. WAIT for devices to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 5. Set front camera
      try {
        await newCall.camera.disable();
        await newCall.camera.enable({
          facingMode: { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        });
        console.log('✅ Front camera set as default');
      } catch (error) {
        console.error('❌ Failed to set front camera:', error);
        // Fallback: try to flip camera
        try {
          await newCall.camera.flip();
        } catch (flipError) {
          console.error('Flip also failed:', flipError);
        }
      }

      setCall(newCall);
    };

    initCall();

    return () => {
      call?.leave();
      client?.disconnectUser();
    };
  }, [callId, userId, token, apiKey]);

  if (!call || !client) {
    return <div>Loading...</div>;
  }

  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        {/* Your video UI */}
        <VideoUI call={call} />
      </StreamCall>
    </StreamVideo>
  );
}

function VideoUI({ call }) {
  // Add flip camera button as fallback
  const flipCamera = () => {
    call.camera.flip();
  };

  return (
    <div>
      {/* Video elements */}
      <button onClick={flipCamera}>Flip Camera</button>
    </div>
  );
}
```

## Next Steps

1. **Share your frontend code location** so I can provide specific fixes
2. **Tell me what platform** you're using (React web, React Native, etc.)
3. **Check browser console** for any camera-related errors
4. **Test on actual mobile device** (not emulator)

---

**Need more help?** Share your frontend video call implementation file and I'll provide exact code changes.
