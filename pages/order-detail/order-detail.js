const { callOrderService, formatOrder, MERCHANT_PHONE } = require('../../utils/order')

Page({
  data: {
    order: null,
    merchantPhone: MERCHANT_PHONE,
    pageStatus: 'loading',
    pageMessage: ''
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
  }
})
