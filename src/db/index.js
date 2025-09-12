import mongoose from "mongoose";

const connectDB = async () => {
    try {
        console.log('🔄 Attempting to connect to MongoDB...');
        
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI environment variable is not defined');
        }

        const connectionInstance = await mongoose.connect(process.env.MONGODB_URI, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        console.log(`✅ MongoDB connected successfully! Host: ${connectionInstance.connection.host}`);
        return connectionInstance;
    }
    catch (error) {
        console.error("❌ MongoDB connection FAILED:", error.message);
        console.error("🔍 MongoDB URI (masked):", process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/:[^:@]*@/, ':***@') : 'undefined');
        throw error; // Let the calling code handle the exit
    }
}
export default connectDB;