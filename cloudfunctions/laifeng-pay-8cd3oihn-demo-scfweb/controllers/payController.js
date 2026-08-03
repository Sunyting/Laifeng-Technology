const PayService = require('../services/payService');
const payService = new PayService();

const success = (res, data) => res.status(200).json({ code: 0, msg: 'success', data });

const fail = (res, error, fallbackMessage) => {
    const statusCode = error.statusCode || 400;
    // callHTTPFunction 将非 2xx 响应转成无业务详情的 system error；业务失败统一
    // 用 200 返回业务码，客户端才能展示微信侧的具体错误并决定是否重试。
    res.status(statusCode === 401 || statusCode === 403 ? statusCode : 200).json({
        code: error.code || 'PAYMENT_ERROR',
        msg: error.message || fallbackMessage,
        data: null
    });
};

const getTrustedOpenId = (req) => {
    const openid = req.headers['x-wx-openid'];
    return typeof openid === 'string' ? openid.trim() : '';
};

exports.payMiddleware = (req, res, next) => {
    if (!getTrustedOpenId(req)) {
        return res.status(401).json({ code: 'UNAUTHORIZED', msg: '未授权访问', data: null });
    }
    next();
};

exports.businessOrder = async (req, res) => {
    try {
        const result = await payService.createBusinessOrder(req.body?.orderId, getTrustedOpenId(req));
        success(res, result);
    } catch (error) {
        console.error('[Controller] businessOrder error:', error.code || error.message);
        fail(res, error, '支付下单失败');
    }
};

exports.businessQuery = async (req, res) => {
    try {
        const result = await payService.queryBusinessOrder(req.body?.orderId, getTrustedOpenId(req));
        success(res, result);
    } catch (error) {
        console.error('[Controller] businessQuery error:', error.code || error.message);
        fail(res, error, '支付结果查询失败');
    }
};

async function handleCallback(req, res, handler, name) {
    try {
        const headers = req.headers;
        const callbackParams = {
            body: req.body,
            rawBody: req.rawBody,
            decryptedData: req.body?.ParsedContent || null,
            signature: headers['wechatpay-signature'],
            serial: headers['wechatpay-serial'],
            nonce: headers['wechatpay-nonce'],
            timestamp: headers['wechatpay-timestamp']
        };
        const result = await handler.call(payService, callbackParams);
        if (!result) {
            return res.status(400).json({ code: 'FAIL', message: '回调校验失败' });
        }
        res.status(200).json({ code: 'SUCCESS', message: '成功' });
    } catch (error) {
        console.error(`[Controller] ${name} error:`, error.code || error.message);
        res.status(500).json({ code: 'FAIL', message: '处理失败' });
    }
}

exports.unifiedOrderTrigger = (req, res) => handleCallback(
    req,
    res,
    payService.handlePayCallback,
    'unifiedOrderTrigger'
);

exports.refundTrigger = (req, res) => handleCallback(
    req,
    res,
    payService.handleRefundCallback,
    'refundTrigger'
);

exports._private = { getTrustedOpenId };
