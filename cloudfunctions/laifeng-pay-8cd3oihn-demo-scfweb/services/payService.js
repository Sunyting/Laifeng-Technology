const { signMode, payConfig } = require('../config/config');
const SdkStrategy = require('./strategies/sdkStrategy');
const OrderService = require('./orderService');

class PayService {
    constructor(options = {}) {
        this.orderService = options.orderService || new OrderService();
        this.strategy = options.strategy || new SdkStrategy(payConfig);
    }

    async createBusinessOrder(orderId, openid) {
        const { order, payment } = await this.orderService.preparePayment(orderId, openid);
        if (payment.paymentParams) {
            return { status: 200, data: payment.paymentParams };
        }

        const params = this.orderService.buildUnifiedOrderParams(order, payment);
        params.appid = payConfig.appId;
        params.mchid = payConfig.mchId;
        params.notify_url = payConfig.jsapiNotifyUrl;

        let result;
        try {
            result = await this.strategy.jsapi(params);
            if (result.status !== 200 || !result.data?.paySign) {
                const message = result.data?.message || result.data?.code || '微信支付下单失败';
                const error = new Error(message);
                error.code = result.data?.code || 'WECHAT_PAY_ERROR';
                throw error;
            }
        } catch (error) {
            // 微信拒绝下单或网络失败时释放临时支付单，允许用户重新支付。
            await this.orderService.releaseFailedPayment(payment._id);
            throw error;
        }

        const requestId = result.headers?.['request-id'] || result.headers?.['Request-ID'] || '';
        await this.orderService.savePaymentParams(payment._id, result.data, requestId);
        return result;
    }

    async queryBusinessOrder(orderId, openid) {
        const { order, payment } = await this.orderService.getPaymentForQuery(orderId, openid);
        if (!payment || payment.status === 'paid' || order.paymentStatus === 'paid') {
            return {
                status: 200,
                data: {
                    paymentStatus: order.paymentStatus || 'unpaid',
                    tradeState: payment?.status === 'paid' ? 'SUCCESS' : 'NOTPAY'
                }
            };
        }

        const result = await this.strategy.query({
            out_trade_no: payment._id,
            mchid: payConfig.mchId
        });
        if (result.status !== 200 || !result.data?.trade_state) {
            const error = new Error(result.data?.message || '微信支付查单失败');
            error.code = result.data?.code || 'WECHAT_QUERY_ERROR';
            throw error;
        }
        if (result.status === 200 && result.data?.trade_state === 'SUCCESS') {
            await this.orderService.confirmPaid(result.data);
        }
        return {
            status: result.status,
            data: {
                paymentStatus: result.data?.trade_state === 'SUCCESS' ? 'paid' : 'paying',
                tradeState: result.data?.trade_state || 'UNKNOWN'
            }
        };
    }

    async handlePayCallback(callbackParams) {
        let payResult;
        if (signMode === 'gateway' && callbackParams.decryptedData) {
            payResult = callbackParams.decryptedData;
        } else {
            const verified = await this.strategy.verifySign(callbackParams);
            if (!verified) return null;
            const resource = callbackParams.body?.resource;
            if (!resource) return null;
            payResult = await this.strategy.decryptResource(
                resource.ciphertext,
                resource.associated_data,
                resource.nonce
            );
        }

        const handled = await this.orderService.confirmPaid(payResult);
        return handled ? payResult : null;
    }

    async handleRefundCallback(callbackParams) {
        let refundResult;
        if (signMode === 'gateway' && callbackParams.decryptedData) {
            refundResult = callbackParams.decryptedData;
        } else {
            const verified = await this.strategy.verifySign(callbackParams);
            if (!verified) return null;
            const resource = callbackParams.body?.resource;
            if (!resource) return null;
            refundResult = await this.strategy.decryptResource(
                resource.ciphertext,
                resource.associated_data,
                resource.nonce
            );
        }

        if (typeof this.orderService.confirmRefund !== 'function') return null;
        const handled = await this.orderService.confirmRefund(refundResult);
        return handled ? refundResult : null;
    }
}

module.exports = PayService;
