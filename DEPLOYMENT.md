# FinderNate Backend - Render Deployment Guide

This guide will help you deploy your FinderNate backend application to Render.

## Prerequisites

1. A [Render](https://render.com) account
2. Your code pushed to a GitHub repository
3. A MongoDB database (MongoDB Atlas recommended)
4. Required third-party service accounts (Cloudinary, email provider, etc.)

## Deployment Steps

### 1. Prepare Your Repository

Ensure your code is pushed to GitHub with all the necessary files:
- `render.yaml` (deployment configuration)
- `package.json` (with proper Node.js version specified)
- All source code in the `src/` directory

### 2. Set Up External Services

#### MongoDB Database
1. Create a MongoDB Atlas cluster (free tier available)
2. Get your connection string (should look like: `mongodb+srv://username:password@cluster.mongodb.net`)
3. Whitelist all IP addresses (0.0.0.0/0) for Render deployment

#### Cloudinary (for file uploads)
1. Create a Cloudinary account
2. Get your Cloud Name, API Key, and API Secret from the dashboard

#### Email Service (for notifications)
1. Set up an email service (Gmail, SendGrid, etc.)
2. Get SMTP credentials

### 3. Deploy to Render

#### Option A: Using render.yaml (Recommended)
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New" → "Blueprint"
3. Connect your GitHub repository
4. Render will automatically detect the `render.yaml` file
5. Review the configuration and click "Apply"

#### Option B: Manual Web Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New" → "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `findernate-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### 4. Configure Environment Variables

In your Render service settings, add these environment variables:

#### Required Variables
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net
NODE_ENV=production
PORT=10000
JWT_SECRET=your-super-secret-jwt-key-here
```

#### Optional Variables (based on your features)
```
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret

EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_EMAIL=your-email@domain.com

FRONTEND_URL=https://your-frontend-domain.com
```

### 5. Update CORS Configuration

Make sure to update your frontend URLs in the CORS configuration (`src/app.js`):

```javascript
app.use(cors({
    origin: [
        "https://your-production-frontend.com",
        "https://your-staging-frontend.com",
        "http://localhost:3000" // for development
    ],
    credentials: true
}));
```

### 6. Deploy and Test

1. Your service will automatically deploy when you push to your main branch
2. Monitor the deployment logs in the Render dashboard
3. Once deployed, test your API endpoints using the provided Render URL
4. Your backend will be available at: `https://your-service-name.onrender.com`

## Important Notes

### Free Tier Limitations
- Services on the free tier will spin down after 15 minutes of inactivity
- First request after spin-down may take 30+ seconds (cold start)
- Consider upgrading to a paid plan for production use

### Database Connection
- Ensure your MongoDB Atlas cluster allows connections from all IPs (0.0.0.0/0)
- Use environment variables for sensitive data like database passwords

### SSL/HTTPS
- Render automatically provides SSL certificates
- All traffic is encrypted by default

### Monitoring
- Monitor your service health in the Render dashboard
- Set up log retention and monitoring as needed

## Troubleshooting

### Common Issues

1. **Build Fails**: Check that all dependencies are in `package.json`
2. **Service Won't Start**: Verify your start command and PORT configuration
3. **Database Connection Issues**: Check MongoDB URI and network access
4. **CORS Errors**: Update allowed origins in your CORS configuration

### Logs and Debugging
- View deployment and runtime logs in the Render dashboard
- Use `console.log` statements for debugging (visible in logs)
- Monitor service metrics and performance

## Next Steps

1. Set up automatic deployments from your main branch
2. Configure custom domain (if needed)
3. Set up monitoring and alerting
4. Consider upgrading to a paid plan for better performance
5. Implement health check endpoints for better monitoring

For more information, visit the [Render Documentation](https://render.com/docs).
