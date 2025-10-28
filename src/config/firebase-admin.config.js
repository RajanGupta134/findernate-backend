import admin from "firebase-admin";

let firebaseApp = null;

/**
 * Initialize Firebase Admin SDK
 *
 * Instructions:
 * 1. Go to Firebase Console: https://console.firebase.google.com/
 * 2. Select your project
 * 3. Go to Project Settings > Service Accounts
 * 4. Click "Generate new private key"
 * 5. Save the JSON file as "serviceAccountKey.json" in the src/config folder
 *
 * OR use environment variables:
 * FIREBASE_PROJECT_ID=your-project-id
 * FIREBASE_PRIVATE_KEY=your-private-key (with \n for line breaks)
 * FIREBASE_CLIENT_EMAIL=your-client-email
 */
const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Method 1: Using environment variables (recommended for production)
    if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL
    ) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
      console.log("✅ Firebase Admin initialized with environment variables");
    }
    // Method 2: Using service account key file (for development)
    else {
      console.warn(
        "⚠️ Firebase Admin SDK not initialized - Missing environment variables"
      );
      console.warn(
        "Please add Firebase credentials to .env file:\n" +
        "FIREBASE_PROJECT_ID=your-project-id\n" +
        "FIREBASE_CLIENT_EMAIL=your-client-email\n" +
        "FIREBASE_PRIVATE_KEY=your-private-key"
      );
      return null;
    }

    return firebaseApp;
  } catch (error) {
    console.error("❌ Failed to initialize Firebase Admin:", error.message);
    return null;
  }
};

// Initialize Firebase on module load
const app = initializeFirebase();

/**
 * Get Firebase Admin Messaging instance
 */
const getMessaging = () => {
  if (!app) {
    throw new Error(
      "Firebase Admin SDK not initialized. Please configure Firebase credentials."
    );
  }
  return admin.messaging();
};

/**
 * Send FCM notification to a single device
 */
const sendNotification = async (fcmToken, notification, data = {}) => {
  try {
    const messaging = getMessaging();

    const message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        // Ensure all data values are strings
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {}),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "calls",
          priority: "high",
          defaultVibrateTimings: true,
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            contentAvailable: true,
          },
        },
      },
    };

    const response = await messaging.send(message);
    console.log("✅ FCM notification sent successfully:", response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error("❌ FCM notification failed:", error.message);

    // Handle invalid tokens
    if (
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      return { success: false, invalidToken: true, error: error.message };
    }

    return { success: false, error: error.message };
  }
};

/**
 * Send FCM notification to multiple devices
 */
const sendMulticastNotification = async (
  fcmTokens,
  notification,
  data = {}
) => {
  try {
    const messaging = getMessaging();

    const message = {
      tokens: fcmTokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {}),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "calls",
          priority: "high",
          defaultVibrateTimings: true,
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            contentAvailable: true,
          },
        },
      },
    };

    const response = await messaging.sendEachForMulticast(message);
    console.log(
      `✅ FCM multicast sent: ${response.successCount}/${fcmTokens.length} delivered`
    );

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses,
    };
  } catch (error) {
    console.error("❌ FCM multicast failed:", error.message);
    return { success: false, error: error.message };
  }
};

export default admin;
export { getMessaging, sendNotification, sendMulticastNotification };
