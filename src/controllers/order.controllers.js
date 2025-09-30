import Order from "../models/order.models.js";
import { Cart } from "../models/cart.models.js";
import Product from "../models/product.models.js";
import Payment from "../models/payment.models.js";
import { ApiError } from "../utlis/ApiError.js";
import { ApiResponse } from "../utlis/ApiResponse.js";
import { asyncHandler } from "../utlis/asyncHandler.js";
import mongoose from "mongoose";

// Helper function to validate shipping address
const validateShippingAddress = (address) => {
    const required = ['fullName', 'phone', 'street', 'city', 'state', 'postalCode', 'country'];
    for (const field of required) {
        if (!address[field] || address[field].trim() === '') {
            throw new ApiError(400, `${field} is required in shipping address`);
        }
    }
};

// Helper function to calculate order totals
const calculateOrderTotals = (items, shippingCost = 0, taxes = 0, discount = 0) => {
    const subtotal = items.reduce((total, item) => total + item.totalPrice, 0);
    const totalAmount = subtotal + shippingCost + taxes - discount;

    return {
        subtotal,
        totalAmount: Math.max(0, totalAmount), // Ensure total doesn't go negative
        shippingCost,
        taxes,
        discount
    };
};

// Helper function to prepare order items from cart
const prepareOrderItems = async (cartItems) => {
    const orderItems = [];

    for (const cartItem of cartItems) {
        // Fetch fresh product data to get seller info
        const product = await Product.findById(cartItem.productId)
            .populate('sellerId', '_id')
            .select('sellerId');

        if (!product) {
            throw new ApiError(404, `Product ${cartItem.productDetails.name} not found`);
        }

        orderItems.push({
            productId: cartItem.productId,
            variantId: cartItem.variantId,
            quantity: cartItem.quantity,
            price: cartItem.price,
            totalPrice: cartItem.totalPrice,
            productDetails: cartItem.productDetails,
            variantDetails: cartItem.variantDetails,
            sellerId: product.sellerId
        });
    }

    return orderItems;
};

// ✅ POST /api/v1/orders/checkout - Initiate checkout (address + cart + payment)
const initiateCheckout = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const {
        shippingAddress,
        billingAddress,
        paymentMethod = 'cod',
        customerNotes,
        useShippingAsBilling = true
    } = req.body;

    // Validate shipping address
    validateShippingAddress(shippingAddress);

    // Get user's cart
    const cart = await Cart.findOne({ userId }).populate({
        path: 'items.productId',
        select: 'name price currency images sku status isActive stock variants sellerId',
        match: { status: 'active', isActive: true }
    });

    if (!cart || cart.items.length === 0) {
        throw new ApiError(400, "Cart is empty");
    }

    // Validate cart items and stock
    for (const item of cart.items) {
        if (!item.productId) {
            throw new ApiError(400, "Some products in cart are no longer available");
        }

        // Check stock for each item
        let availableStock = item.productId.stock;
        if (item.variantId) {
            const variant = item.productId.variants.id(item.variantId);
            if (!variant || !variant.isActive) {
                throw new ApiError(400, `Variant for ${item.productDetails.name} is no longer available`);
            }
            availableStock = variant.stock;
        }

        if (item.quantity > availableStock) {
            throw new ApiError(400, `Only ${availableStock} items available for ${item.productDetails.name}`);
        }
    }

    // Set billing address
    const finalBillingAddress = useShippingAsBilling ? shippingAddress : billingAddress;
    if (!useShippingAsBilling) {
        validateShippingAddress(finalBillingAddress);
    }

    // Prepare order items
    const orderItems = await prepareOrderItems(cart.items);

    // Calculate totals (you can add shipping and tax calculation logic here)
    const shippingCost = 50; // Fixed shipping cost for demo
    const taxes = 0; // Calculate based on your tax logic
    const discount = 0; // Apply coupon discounts if any

    const totals = calculateOrderTotals(orderItems, shippingCost, taxes, discount);

    // Create order
    const order = new Order({
        buyerId: userId,
        items: orderItems,
        ...totals,
        currency: cart.summary.currency,
        paymentMethod,
        shippingAddress,
        billingAddress: finalBillingAddress,
        notes: {
            customerNotes: customerNotes || ''
        }
    });

    await order.save();

    // Clear user's cart
    cart.items = [];
    await cart.save();

    return res.status(201).json(
        new ApiResponse(201, {
            order: {
                orderId: order.orderId,
                _id: order._id,
                totalAmount: order.totalAmount,
                paymentMethod: order.paymentMethod,
                orderStatus: order.orderStatus,
                paymentStatus: order.paymentStatus
            }
        }, "Checkout initiated successfully")
    );
});

// ✅ POST /api/v1/orders/:orderId/place - Place order and generate order ID
const placeOrder = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { orderId } = req.params;
    const { paymentId } = req.body;

    const order = await Order.findOne({
        $or: [{ _id: orderId }, { orderId: orderId }],
        buyerId: userId
    });

    if (!order) {
        throw new ApiError(404, "Order not found");
    }

    if (order.orderStatus !== 'placed') {
        throw new ApiError(400, "Order has already been processed");
    }

    // Update order status and payment info
    order.orderStatus = 'confirmed';
    order.confirmedAt = new Date();

    if (paymentId) {
        order.paymentId = paymentId;
        order.paymentStatus = 'paid';
    }

    await order.save();

    // Update product stock
    for (const item of order.items) {
        const product = await Product.findById(item.productId);
        if (product) {
            if (item.variantId) {
                const variant = product.variants.id(item.variantId);
                if (variant) {
                    variant.stock = Math.max(0, variant.stock - item.quantity);
                }
            } else {
                product.stock = Math.max(0, product.stock - item.quantity);
            }
            await product.save();
        }
    }

    return res.status(200).json(
        new ApiResponse(200, {
            orderId: order.orderId,
            orderStatus: order.orderStatus,
            paymentStatus: order.paymentStatus,
            confirmedAt: order.confirmedAt
        }, "Order placed successfully")
    );
});

// ✅ GET /api/v1/orders/:orderId - Fetch single order details
const getOrderDetails = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { orderId } = req.params;

    const order = await Order.findOne({
        $or: [{ _id: orderId }, { orderId: orderId }],
        buyerId: userId
    }).populate({
        path: 'items.productId',
        select: 'name price currency images sku'
    }).populate({
        path: 'items.sellerId',
        select: 'fullName businessProfile'
    });

    if (!order) {
        throw new ApiError(404, "Order not found");
    }

    return res.status(200).json(
        new ApiResponse(200, order, "Order details retrieved successfully")
    );
});

// ✅ GET /api/v1/orders - Get user's order history
const getOrderHistory = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const {
        page = 1,
        limit = 10,
        status,
        sortBy = 'placedAt',
        sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    const filter = { buyerId: userId };
    if (status) {
        filter.orderStatus = status;
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const [orders, totalOrders] = await Promise.all([
        Order.find(filter)
            .populate({
                path: 'items.productId',
                select: 'name images'
            })
            .select('orderId totalAmount orderStatus paymentStatus placedAt items')
            .sort(sort)
            .skip(skip)
            .limit(limitNum),
        Order.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalOrders / limitNum);

    return res.status(200).json(
        new ApiResponse(200, {
            orders,
            pagination: {
                currentPage: pageNum,
                totalPages,
                totalOrders,
                hasNext: pageNum < totalPages,
                hasPrev: pageNum > 1
            }
        }, "Order history retrieved successfully")
    );
});

// ✅ PUT /api/v1/orders/:orderId/status - Update order status
const updateOrderStatus = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { status, trackingNumber, courier, estimatedDelivery, adminNotes } = req.body;

    const validStatuses = ['placed', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
    if (!validStatuses.includes(status)) {
        throw new ApiError(400, "Invalid order status");
    }

    const order = await Order.findOne({
        $or: [{ _id: orderId }, { orderId: orderId }]
    });

    if (!order) {
        throw new ApiError(404, "Order not found");
    }

    // Update status and timestamps
    const previousStatus = order.orderStatus;
    order.orderStatus = status;

    switch (status) {
        case 'confirmed':
            if (!order.confirmedAt) order.confirmedAt = new Date();
            break;
        case 'shipped':
            if (!order.shippedAt) order.shippedAt = new Date();
            if (trackingNumber) {
                order.trackingInfo = {
                    trackingNumber,
                    courier: courier || '',
                    estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null
                };
            }
            break;
        case 'delivered':
            if (!order.deliveredAt) order.deliveredAt = new Date();
            break;
        case 'cancelled':
            if (!order.cancelledAt) order.cancelledAt = new Date();
            // Restore product stock if order was confirmed
            if (['confirmed', 'processing'].includes(previousStatus)) {
                for (const item of order.items) {
                    const product = await Product.findById(item.productId);
                    if (product) {
                        if (item.variantId) {
                            const variant = product.variants.id(item.variantId);
                            if (variant) {
                                variant.stock += item.quantity;
                            }
                        } else {
                            product.stock += item.quantity;
                        }
                        await product.save();
                    }
                }
            }
            break;
    }

    if (adminNotes) {
        order.notes.adminNotes = adminNotes;
    }

    await order.save();

    return res.status(200).json(
        new ApiResponse(200, {
            orderId: order.orderId,
            previousStatus,
            currentStatus: status,
            updatedAt: order.updatedAt,
            trackingInfo: order.trackingInfo
        }, "Order status updated successfully")
    );
});

// ✅ GET /api/v1/orders/seller/:sellerId - Get orders for a specific seller
const getSellerOrders = asyncHandler(async (req, res) => {
    const { sellerId } = req.params;
    const {
        page = 1,
        limit = 10,
        status,
        sortBy = 'placedAt',
        sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter for orders containing items from this seller
    const filter = { 'items.sellerId': sellerId };
    if (status) {
        filter.orderStatus = status;
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const [orders, totalOrders] = await Promise.all([
        Order.find(filter)
            .populate({
                path: 'buyerId',
                select: 'fullName avatar'
            })
            .populate({
                path: 'items.productId',
                select: 'name images'
            })
            .sort(sort)
            .skip(skip)
            .limit(limitNum),
        Order.countDocuments(filter)
    ]);

    // Filter order items to only show items from this seller
    const filteredOrders = orders.map(order => {
        const orderObj = order.toObject();
        orderObj.items = orderObj.items.filter(item =>
            item.sellerId.toString() === sellerId
        );
        return orderObj;
    });

    const totalPages = Math.ceil(totalOrders / limitNum);

    return res.status(200).json(
        new ApiResponse(200, {
            orders: filteredOrders,
            pagination: {
                currentPage: pageNum,
                totalPages,
                totalOrders,
                hasNext: pageNum < totalPages,
                hasPrev: pageNum > 1
            }
        }, "Seller orders retrieved successfully")
    );
});

// ✅ POST /api/v1/orders/:orderId/return - Request order return
const requestReturn = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { orderId } = req.params;
    const { reason, itemIds, customerNotes } = req.body;

    if (!reason || reason.trim() === '') {
        throw new ApiError(400, "Return reason is required");
    }

    const order = await Order.findOne({
        $or: [{ _id: orderId }, { orderId: orderId }],
        buyerId: userId
    });

    if (!order) {
        throw new ApiError(404, "Order not found");
    }

    if (order.orderStatus !== 'delivered') {
        throw new ApiError(400, "Only delivered orders can be returned");
    }

    // Check if return window is still valid (e.g., 7 days)
    const returnWindow = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const returnDeadline = new Date(order.deliveredAt.getTime() + returnWindow);

    if (new Date() > returnDeadline) {
        throw new ApiError(400, "Return window has expired");
    }

    // If specific items are specified, validate them
    if (itemIds && itemIds.length > 0) {
        const validItemIds = order.items.map(item => item._id.toString());
        const invalidItems = itemIds.filter(id => !validItemIds.includes(id));

        if (invalidItems.length > 0) {
            throw new ApiError(400, "Invalid item IDs in return request");
        }
    }

    // Update order status and add return information
    order.orderStatus = 'returned';
    order.notes.customerNotes = `${order.notes.customerNotes || ''}\n\nReturn Request:\nReason: ${reason}\nCustomer Notes: ${customerNotes || 'None'}`.trim();

    if (itemIds && itemIds.length > 0) {
        order.notes.adminNotes = `${order.notes.adminNotes || ''}\n\nPartial return requested for items: ${itemIds.join(', ')}`.trim();
    }

    await order.save();

    // Create payment record for refund processing
    const refundAmount = itemIds && itemIds.length > 0
        ? order.items
            .filter(item => itemIds.includes(item._id.toString()))
            .reduce((total, item) => total + item.totalPrice, 0)
        : order.totalAmount;

    const refundPayment = new Payment({
        userId: order.buyerId,
        amount: refundAmount,
        currency: order.currency,
        status: 'pending',
        method: order.paymentMethod,
        purpose: 'refund',
        metadata: {
            orderId: order.orderId,
            originalPaymentId: order.paymentId,
            returnReason: reason,
            isPartialReturn: !!(itemIds && itemIds.length > 0),
            returnedItems: itemIds
        }
    });

    await refundPayment.save();

    return res.status(200).json(
        new ApiResponse(200, {
            orderId: order.orderId,
            returnStatus: 'requested',
            refundAmount,
            refundId: refundPayment._id,
            estimatedRefundTime: '3-5 business days'
        }, "Return request submitted successfully")
    );
});

// ✅ PUT /api/v1/orders/:orderId/refund - Process refund (admin only)
const processRefund = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { refundAmount, refundReason, adminNotes } = req.body;

    const order = await Order.findOne({
        $or: [{ _id: orderId }, { orderId: orderId }]
    });

    if (!order) {
        throw new ApiError(404, "Order not found");
    }

    if (!['returned', 'delivered'].includes(order.orderStatus)) {
        throw new ApiError(400, "Order is not eligible for refund");
    }

    // Find existing payment record
    const refundPayment = await Payment.findOne({
        'metadata.orderId': order.orderId,
        purpose: 'refund',
        status: 'pending'
    });

    if (refundPayment) {
        // Update existing refund request
        refundPayment.status = 'completed';
        refundPayment.paidAt = new Date();
        if (refundAmount) {
            refundPayment.amount = refundAmount;
        }
        await refundPayment.save();
    } else {
        // Create new refund payment record
        const newRefundPayment = new Payment({
            userId: order.buyerId,
            amount: refundAmount || order.totalAmount,
            currency: order.currency,
            status: 'completed',
            method: order.paymentMethod,
            purpose: 'refund',
            paidAt: new Date(),
            metadata: {
                orderId: order.orderId,
                originalPaymentId: order.paymentId,
                refundReason: refundReason || 'Admin processed refund'
            }
        });
        await newRefundPayment.save();
    }

    // Update order payment status
    order.paymentStatus = refundAmount >= order.totalAmount ? 'refunded' : 'partially_refunded';

    if (adminNotes) {
        order.notes.adminNotes = `${order.notes.adminNotes || ''}\n\nRefund Processed:\n${adminNotes}`.trim();
    }

    await order.save();

    return res.status(200).json(
        new ApiResponse(200, {
            orderId: order.orderId,
            refundAmount: refundAmount || order.totalAmount,
            paymentStatus: order.paymentStatus,
            processedAt: new Date()
        }, "Refund processed successfully")
    );
});

export {
    initiateCheckout,
    placeOrder,
    getOrderDetails,
    getOrderHistory,
    updateOrderStatus,
    getSellerOrders,
    requestReturn,
    processRefund
};