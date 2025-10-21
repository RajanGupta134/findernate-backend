import mongoose from 'mongoose';

const CallSchema = new mongoose.Schema({
    // 📞 Call participants
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }],

    // 👤 Who initiated the call
    initiator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // 💬 Associated chat for the call
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chat',
        required: true,
        index: true
    },

    // 🎯 Call type
    callType: {
        type: String,
        enum: ['voice', 'video'],
        required: true
    },

    // 📊 Call status
    status: {
        type: String,
        enum: ['initiated', 'ringing', 'connecting', 'active', 'ended', 'declined', 'missed', 'failed'],
        default: 'initiated',
        index: true
    },

    // 🕒 Call timing
    initiatedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    startedAt: {
        type: Date,
        index: true
    },
    endedAt: {
        type: Date,
        index: true
    },

    // ⏱️ Call duration in seconds
    duration: {
        type: Number,
        default: 0
    },

    // 🔌 End reason
    endReason: {
        type: String,
        enum: ['normal', 'declined', 'missed', 'failed', 'network_error', 'cancelled', 'timeout'],
        default: 'normal'
    },

    // 👤 Who ended the call
    endedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // 📱 Device/quality information
    metadata: {
        initiatorDevice: String,
        receiverDevice: String,
        quality: {
            type: String,
            enum: ['excellent', 'good', 'poor', 'failed'],
            default: 'good'
        },
        connectionType: {
            type: String,
            enum: ['wifi', 'cellular', 'unknown'],
            default: 'unknown'
        }
    },

    // 📡 ZegoCloud Room Information
    zegoRoom: {
        roomId: {
            type: String,
            index: true
        },
        appId: Number,
        createdAt: Date,
        endedAt: Date
    },

    // 🔑 ZegoCloud Auth Tokens (for participants)
    zegoTokens: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        token: String,
        generatedAt: {
            type: Date,
            default: Date.now
        },
        expiresAt: Date
    }]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better performance
CallSchema.index({ initiator: 1, initiatedAt: -1 });
CallSchema.index({ participants: 1, initiatedAt: -1 });
CallSchema.index({ chatId: 1, initiatedAt: -1 });
CallSchema.index({ status: 1, initiatedAt: -1 });

// Virtual for call duration in readable format
CallSchema.virtual('formattedDuration').get(function () {
    if (!this.duration) return '0:00';

    const minutes = Math.floor(this.duration / 60);
    const seconds = this.duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

// Virtual to check if call was answered
CallSchema.virtual('wasAnswered').get(function () {
    return this.status === 'active' || this.status === 'ended';
});

// Virtual to check if call is ongoing
CallSchema.virtual('isOngoing').get(function () {
    return ['initiated', 'ringing', 'connecting', 'active'].includes(this.status);
});

// Pre-save middleware to calculate duration
CallSchema.pre('save', function (next) {
    if (this.startedAt && this.endedAt) {
        this.duration = Math.floor((this.endedAt - this.startedAt) / 1000);
    }
    next();
});

// Static methods
CallSchema.statics.getCallHistory = function (userId, limit = 20, page = 1) {
    const skip = (page - 1) * limit;

    return this.find({
        participants: userId,
        status: { $in: ['ended', 'declined', 'missed'] }
    })
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl')
        .sort({ initiatedAt: -1 })
        .skip(skip)
        .limit(limit);
};

CallSchema.statics.getActiveCall = function (userId) {
    return this.findOne({
        participants: userId,
        status: { $in: ['initiated', 'ringing', 'connecting', 'active'] }
    })
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');
};

CallSchema.statics.getCallStats = function (userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.aggregate([
        {
            $match: {
                participants: new mongoose.Types.ObjectId(userId),
                initiatedAt: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: null,
                totalCalls: { $sum: 1 },
                answeredCalls: {
                    $sum: { $cond: [{ $in: ['$status', ['active', 'ended']] }, 1, 0] }
                },
                totalDuration: { $sum: '$duration' },
                videoCalls: {
                    $sum: { $cond: [{ $eq: ['$callType', 'video'] }, 1, 0] }
                },
                voiceCalls: {
                    $sum: { $cond: [{ $eq: ['$callType', 'voice'] }, 1, 0] }
                }
            }
        }
    ]);
};

// Get call by ZegoCloud room ID
CallSchema.statics.getCallByRoomId = function (roomId) {
    return this.findOne({ 'zegoRoom.roomId': roomId })
        .populate('participants', 'username fullName profileImageUrl')
        .populate('initiator', 'username fullName profileImageUrl');
};

// Get ZegoCloud token for user in a call
CallSchema.methods.getZegoTokenForUser = function (userId) {
    return this.zegoTokens.find(token =>
        token.userId.toString() === userId.toString()
    );
};

// Add ZegoCloud token for user
CallSchema.methods.addZegoToken = function (userId, token, expiresAt) {
    // Remove existing token for user
    this.zegoTokens = this.zegoTokens.filter(t =>
        t.userId.toString() !== userId.toString()
    );

    // Add new token
    this.zegoTokens.push({
        userId,
        token,
        generatedAt: new Date(),
        expiresAt
    });

    return this.save();
};

export default mongoose.model('Call', CallSchema);