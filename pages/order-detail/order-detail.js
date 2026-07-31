const { callOrderService, formatOrder, MERCHANT_PHONE } = require('../../utils/order')
const { queryOrderPayment, requestOrderPayment } = require('../../utils/payment')

Page({
  data: {
    order: null,
    merchantPhone: MERCHANT_PHONE,
    pageStatus: 'loading',
    pageMessage: '',
    paying: false
  },
  onLoad(options) {
    this.orderId = options.id || ''
    this.loadOrder()
  },
  loadOrder() {
    if (!this.orderId) {
      this.setData({ pageStatus: 'error', pageMessage: '订单参数无效' })
      return Promise.resolve()
    }
    this.setData({ pageStatus: 'loading', pageMessage: '' })
    return callOrderService('getOrder', { orderId: this.orderId })
      .then((order) => this.setData({ order: formatOrder(order), pageStatus: 'success' }))
      .catch((err) => {
        console.error('获取订单详情失败:', err)
        this.setData({ pageStatus: 'error', pageMessage: err.message || '订单加载失败，请稍后重试' })
      })
  },
  goToOrders() {
    wx.redirectTo({ url: '/pages/orders/orders' })
  },
  callMerchant() {
    wx.makePhoneCall({ phoneNumber: MERCHANT_PHONE })
  },
  payOrder() {
    const order = this.data.order
    if (!order || !order.canPay || this.data.paying) return
    this.setData({ paying: true })
    requestOrderPayment(order._id)
      .then(() => queryOrderPayment(order._id))
      .then(() => this.loadOrder())
      .catch((err) => {
        if ((err.errMsg || '').includes('cancel')) return
        console.error('订单支付失败:', err)
        wx.showModal({
          title: err.code === 'PAYMENT_NOT_CONFIGURED' ? '支付暂不可用' : '支付未完成',
          content: err.message || '请稍后重试',
          showCancel: false
        })
      })
      .finally(() => this.setData({ paying: false }))
  }
})
