const PAYMENT_TTL_MS = 30 * 60 * 1000;

let cloudInstance;
const getCloud = () => {
    if (!cloudInstance) {
        cloudInstance = require('wx-server-sdk');
        cloudInstance.init({ env: cloudInstance.DYNAMIC_CURRENT_ENV });
    }
    return cloudInstance;
};

class PaymentError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = 'PaymentError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

const readDocument = (result) => result && result.data;

const requireDocument = (result, code, message) => {
    const data = readDocument(result);
    if (!data) throw new PaymentError(code, message, 404);
    return data;
};

const normalizeOrderId = (orderId) => {
    if (typeof orderId !== 'string' || !/^LFT[A-Za-z0-9_-]{3,29}$/.test(orderId)) {
        throw new PaymentError('INVALID_ORDER_ID', '订单编号无效');
    }
    return orderId;
};

const requireOpenId = (openid) => {
    if (typeof openid !== 'string' || !openid.trim()) {
        throw new PaymentError('UNAUTHORIZED', '未获取到当前用户身份', 401);
    }
    return openid.trim();
};

const createOutTradeNo = (orderId, now) => {
    const suffix = `P${now.toString(36).toUpperCase()}`;
    return `${orderId}${suffix}`.slice(0, 32);
};

const getPaymentAmount = (order) => {
    const amount = order.onlinePayableAmountCents;
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new PaymentError('INVALID_ORDER_AMOUNT', '订单在线应付金额无效');
    }
    return amount;
};

const assertOrderPayable = (order, openid) => {
    if (order.userId !== openid) {
        throw new PaymentError('ORDER_FORBIDDEN', '无权支付该订单', 403);
    }
    if (order.status === 'cancelled') {
        throw new PaymentError('ORDER_CANCELLED', '订单已取消，无法支付');
    }
    if (order.paymentStatus === 'paid') {
        throw new PaymentError('ORDER_PAID', '订单已支付');
    }
    if (['closed', 'refunding', 'refunded'].includes(order.paymentStatus)) {
        throw new PaymentError('ORDER_NOT_PAYABLE', '当前订单状态无法支付');
    }
};

class OrderService {
    constructor(options = {}) {
        this.db = options.db || getCloud().database();
        this.now = options.now || (() => Date.now());
    }

    async preparePayment(orderIdValue, openidValue) {
        const orderId = normalizeOrderId(orderIdValue);
        const openid = requireOpenId(openidValue);
        const now = this.now();

        return this.db.runTransaction(async (transaction) => {
            const orderRef = transaction.collection('orders').doc(orderId);
            const order = requireDocument(
                await orderRef.get(),
                'ORDER_NOT_FOUND',
                '订单不存在'
            );
            assertOrderPayable(order, openid);
            const amountCents = getPaymentAmount(order);

            if (order.currentPaymentId && order.paymentExpiresAt > now) {
                const existing = readDocument(
                    await transaction.collection('payments').doc(order.currentPaymentId).get()
                );
                if (existing && existing.status === 'pending' && existing.amountCents === amountCents) {
                    return { order, payment: existing };
                }
            }

            const outTradeNo = createOutTradeNo(orderId, now);
            const expiresAt = now + PAYMENT_TTL_MS;
            const payment = {
                _id: outTradeNo,
                orderId,
                userId: openid,
                amountCents,
                status: 'pending',
                paymentParams: null,
                transactionId: '',
                requestId: '',
                expiresAt,
                paidAt: null,
                createdAt: now,
                updatedAt: now
            };

            const { _id, ...paymentData } = payment;
            await transaction.collection('payments').doc(outTradeNo).set({ data: paymentData });
            await orderRef.update({
                data: {
                    currentPaymentId: outTradeNo,
                    paymentStatus: 'paying',
                    paymentExpiresAt: expiresAt,
                    updatedAt: now
                }
            });

            return { order: { ...order, currentPaymentId: outTradeNo }, payment };
        });
    }

    buildUnifiedOrderParams(order, payment) {
        const itemNames = Array.isArray(order.items)
            ? order.items.map((item) => item && item.name).filter(Boolean)
            : [];
        const description = `来锋科技-${itemNames.join('、') || '订单支付'}`.slice(0, 42);

        return {
            out_trade_no: payment._id,
            description,
            time_expire: new Date(payment.expiresAt).toISOString(),
            amount: { total: payment.amountCents, currency: 'CNY' },
            payer: { openid: payment.userId }
        };
    }

    async savePaymentParams(outTradeNo, paymentParams, requestId = '') {
        const now = this.now();
        await this.db.collection('payments').doc(outTradeNo).update({
            data: {
                paymentParams,
                requestId: requestId || '',
                updatedAt: now
            }
        });
    }

    async releaseFailedPayment(outTradeNo) {
        const now = this.now();
        await this.db.runTransaction(async (transaction) => {
            const paymentRef = transaction.collection('payments').doc(outTradeNo);
            const payment = readDocument(await paymentRef.get());
            if (!payment || payment.status !== 'pending') return;

            const orderRef = transaction.collection('orders').doc(payment.orderId);
            const order = readDocument(await orderRef.get());
            await paymentRef.update({ data: { status: 'closed', updatedAt: now } });

            if (order && order.currentPaymentId === outTradeNo && order.paymentStatus !== 'paid') {
                await orderRef.update({
                    data: {
                        currentPaymentId: null,
                        paymentStatus: 'unpaid',
                        paymentExpiresAt: null,
                        updatedAt: now
                    }
                });
            }
        });
    }

    async getPaymentForQuery(orderIdValue, openidValue) {
        const orderId = normalizeOrderId(orderIdValue);
        const openid = requireOpenId(openidValue);
        const order = requireDocument(
            await this.db.collection('orders').doc(orderId).get(),
            'ORDER_NOT_FOUND',
            '订单不存在'
        );
        if (order.userId !== openid) {
            throw new PaymentError('ORDER_FORBIDDEN', '无权查询该订单', 403);
        }
        if (!order.currentPaymentId) {
            return { order, payment: null };
        }
        const payment = readDocument(
            await this.db.collection('payments').doc(order.currentPaymentId).get()
        );
        return { order, payment: payment || null };
    }

    async confirmPaid(params) {
        if (!params || params.trade_state !== 'SUCCESS') return false;
        const outTradeNo = params.out_trade_no;
        if (typeof outTradeNo !== 'string' || !outTradeNo) return false;
        const now = this.now();

        return this.db.runTransaction(async (transaction) => {
            const paymentRef = transaction.collection('payments').doc(outTradeNo);
            const payment = requireDocument(
                await paymentRef.get(),
                'PAYMENT_NOT_FOUND',
                '支付单不存在'
            );
            const orderRef = transaction.collection('orders').doc(payment.orderId);
            const order = requireDocument(
                await orderRef.get(),
                'ORDER_NOT_FOUND',
                '订单不存在'
            );

            if (params.amount?.total !== payment.amountCents || params.amount?.currency !== 'CNY') {
                throw new PaymentError('PAYMENT_AMOUNT_MISMATCH', '支付金额或币种不一致');
            }
            if (params.payer?.openid !== payment.userId || order.userId !== payment.userId) {
                throw new PaymentError('PAYMENT_USER_MISMATCH', '支付用户与订单用户不一致');
            }
            if (order.onlinePayableAmountCents !== payment.amountCents) {
                throw new PaymentError('ORDER_AMOUNT_CHANGED', '订单金额已发生变化');
            }

            if (payment.status === 'paid') return true;
            if (payment.status !== 'pending' || order.currentPaymentId !== outTradeNo) {
                throw new PaymentError('PAYMENT_NOT_ACTIVE', '支付单已失效');
            }

            await paymentRef.update({
                data: {
                    status: 'paid',
                    transactionId: params.transaction_id || '',
                    paidAt: now,
                    updatedAt: now
                }
            });
            await orderRef.update({
                data: {
                    paymentStatus: 'paid',
                    paidAmountCents: payment.amountCents,
                    paidAt: now,
                    updatedAt: now
                }
            });
            return true;
        });
    }

    async confirmRefund(params) {
        const outTradeNo = params && params.out_trade_no;
        if (typeof outTradeNo !== 'string' || !outTradeNo) return false;
        const refundStatus = params.refund_status;
        if (!['SUCCESS', 'CHANGE', 'REFUNDCLOSE', 'ABNORMAL', 'CLOSED'].includes(refundStatus)) {
            return false;
        }
        const now = this.now();

        return this.db.runTransaction(async (transaction) => {
            const paymentRef = transaction.collection('payments').doc(outTradeNo);
            const payment = requireDocument(
                await paymentRef.get(),
                'PAYMENT_NOT_FOUND',
                '支付单不存在'
            );
            const orderRef = transaction.collection('orders').doc(payment.orderId);
            const order = requireDocument(
                await orderRef.get(),
                'ORDER_NOT_FOUND',
                '订单不存在'
            );
            const amount = params.amount || {};
            if (
                amount.total !== payment.amountCents ||
                amount.refund !== payment.amountCents ||
                amount.currency !== 'CNY'
            ) {
                throw new PaymentError('REFUND_AMOUNT_MISMATCH', '退款金额或币种不一致');
            }
            if (order.userId !== payment.userId) {
                throw new PaymentError('PAYMENT_USER_MISMATCH', '支付用户与订单用户不一致');
            }
            if (refundStatus === 'SUCCESS' && payment.status === 'refunded') return true;

            const paymentStatus = refundStatus === 'SUCCESS'
                ? 'refunded'
                : ['REFUNDCLOSE', 'CLOSED'].includes(refundStatus) ? 'paid' : 'refunding';
            await paymentRef.update({
                data: {
                    status: paymentStatus,
                    refundId: params.refund_id || '',
                    refundedAt: refundStatus === 'SUCCESS' ? now : null,
                    updatedAt: now
                }
            });
            await orderRef.update({
                data: {
                    paymentStatus,
                    updatedAt: now
                }
            });
            return true;
        });
    }
}

module.exports = OrderService;
module.exports.PaymentError = PaymentError;
module.exports._private = {
    assertOrderPayable,
    createOutTradeNo,
    getPaymentAmount,
    normalizeOrderId,
    requireOpenId
};
