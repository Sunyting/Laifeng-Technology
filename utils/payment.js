const getPaymentConfig = () => {
  const app = getApp()
  return (app.globalData && app.globalData.payment) || {}
}

const createPaymentError = (code, message) => {
  const error = new Error(message)
  error.code = code
  return error
}

const callPaymentFunction = (path, orderId) => {
  const config = getPaymentConfig()
  if (!config.functionName) {
    return Promise.reject(createPaymentError(
      'PAYMENT_NOT_CONFIGURED',
      '微信支付尚未完成商户配置，请稍后再试或联系商家'
    ))
  }
  return wx.cloud.callHTTPFunction({
    name: config.functionName,
    config: { env: config.envId },
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    path,
    data: { orderId }
  }).then((result) => {
    const response = result.data || {}
    if (result.statusCode < 200 || result.statusCode >= 300 || response.code !== 0) {
      throw createPaymentError(
        response.code || 'PAYMENT_SERVICE_ERROR',
        response.msg || response.message || '支付服务暂不可用'
      )
    }
    return (response.data && response.data.data) || response.data || {}
  })
}

const requestOrderPayment = (orderId) => {
  const config = getPaymentConfig()
  return callPaymentFunction(config.createPath, orderId)
    .then((paymentParams) => {
      const requiredFields = ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign']
      if (requiredFields.some((field) => !paymentParams[field])) {
        throw createPaymentError('INVALID_PAYMENT_PARAMS', '支付参数无效，请稍后重试')
      }
      return wx.requestPayment(paymentParams)
    })
}

const queryOrderPayment = (orderId) => {
  const config = getPaymentConfig()
  return callPaymentFunction(config.queryPath, orderId)
}

module.exports = {
  queryOrderPayment,
  requestOrderPayment
}
