const test = require('node:test');
const assert = require('node:assert/strict');
const PayService = require('../services/payService');

test('支付参数保存失败时释放临时支付单', async () => {
    const releasedPaymentIds = [];
    const payment = {
        _id: 'LFT202608030224272484PTEST',
        amountCents: 3000,
        paymentParams: {}
    };
    const orderService = {
        preparePayment: async () => ({ order: { _id: 'LFT202608030224272484' }, payment }),
        buildUnifiedOrderParams: () => ({}),
        savePaymentParams: async () => {
            throw new Error('database update failed');
        },
        releaseFailedPayment: async (paymentId) => {
            releasedPaymentIds.push(paymentId);
        }
    };
    const strategy = {
        jsapi: async () => ({
            status: 200,
            data: { paySign: 'signature' },
            headers: { 'request-id': 'request-id' }
        })
    };
    const payService = new PayService({ orderService, strategy });

    await assert.rejects(
        payService.createBusinessOrder('LFT202608030224272484', 'openid-owner'),
        /database update failed/
    );
    assert.deepEqual(releasedPaymentIds, [payment._id]);
});
