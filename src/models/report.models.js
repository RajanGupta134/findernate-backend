import mongoose from 'mongoose';

const ReportSchema = new mongoose.Schema({
    reporterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reportedUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    reportedPostId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        default: null
    },
    reportedCommentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment',
        default: null
    },
    reportedStoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story',
        default: null
    },
    reason: {
        type: String,
        required: true,
        enum: ['spam', 'harassment', 'nudity', 'violence', 'hateSpeech', 'scam', 'other']
    },
    description: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
        default: 'pending'
    }
}, { timestamps: true });

// Prevent duplicate reports from same user for the same target.
// Use partialFilterExpression so the unique constraint only applies when the target field exists and is not null.
ReportSchema.index(
    { reporterId: 1, reportedPostId: 1 },
    { unique: true, partialFilterExpression: { reportedPostId: { $exists: true, $ne: null } } }
);
ReportSchema.index(
    { reporterId: 1, reportedUserId: 1 },
    { unique: true, partialFilterExpression: { reportedUserId: { $exists: true, $ne: null } } }
);
ReportSchema.index(
    { reporterId: 1, reportedCommentId: 1 },
    { unique: true, partialFilterExpression: { reportedCommentId: { $exists: true, $ne: null } } }
);
ReportSchema.index(
    { reporterId: 1, reportedStoryId: 1 },
    { unique: true, partialFilterExpression: { reportedStoryId: { $exists: true, $ne: null } } }
);

export default mongoose.model('Report', ReportSchema);
