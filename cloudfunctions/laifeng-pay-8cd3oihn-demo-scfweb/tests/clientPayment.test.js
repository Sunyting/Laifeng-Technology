const test = require('node:test');
const assert = require('node:assert/strict');

const paymentParams = {
    timeStamp: '1785470400',
    nonceStr: 'nonce',
    package: 'prepay_id=test',
    signType: 'RSA',
    paySign: 'signature'
};

test('小程序支付调用只上传订单号并正确解包支付参数', async () => {
    let functionOptions;
    let requestOptions;
    global.getApp = () => ({
        globalData: {
            payment: {
                envId: 'test-env',
                functionName: 'test-pay-function',
                createPath: '/wx-pay/order',
                queryPath: '/wx-pay/query'
            }
        }
    });
    global.wx = {
        cloud: {
            callHTTPFunction(options) {
                functionOptions = options;
                return Promise.resolve({
                    statusCode: 200,
                    data: { code: 0, data: { status: 200, data: paymentParams } }
                });
            }
        },
        requestPayment(options) {
            requestOptions = options;
            return Promise.resolve();
        }
    };

    const { requestOrderPayment } = require('../../../utils/payment');
    await requestOrderPayment('LFT202607311200001234');

    assert.equal(functionOptions.method, 'POST');
    assert.deepEqual(functionOptions.config, { env: 'test-env' });
    assert.deepEqual(functionOptions.data, { orderId: 'LFT202607311200001234' });
    assert.deepEqual(requestOptions, paymentParams);
});
