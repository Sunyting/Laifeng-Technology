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
    this.paymentId = options.paymentId || ''
    this.loadOrder()
  },
  onShow() {
    this.startCountdown()
  },
  onHide() {
    this.stopCountdown()
  },
  onUnload() {
    this.stopCountdown()
  },
  loadOrder() {
    if (!this.orderId && !this.paymentId) {
      this.setData({ pageStatus: 'error', pageMessage: '订单参数无效' })
      return Promise.resolve()
    }
    this.setData({ pageStatus: 'loading', pageMessage: '' })
    const params = this.orderId
      ? { orderId: this.orderId }
      : { paymentId: this.paymentId }
    return callOrderService('getOrder', params)
      .then((order) => {
        this.orderId = order._id
        this.setData({ order: formatOrder(order), pageStatus: 'success' })
      })
      .catch((err) => {
        console.error('获取订单详情失败:', err)
        this.setData({ pageStatus: 'error', pageMessage: err.message || '订单加载失败，请稍后重试' })
      })
  },
  startCountdown() {
    this.stopCountdown()
    this.countdownTimer = setInterval(() => {
      const order = this.data.order
      if (!order) return
      const formatted = formatOrder(order, Date.now())
      if (!formatted.paymentCountdownText && order.paymentCountdownText && !this.expiryRefreshPending) {
        this.expiryRefreshPending = true
        this.loadOrder().finally(() => { this.expiryRefreshPending = false })
        return
      }
      this.setData({ order: formatted })
    }, 1000)
  },
  stopCountdown() {
    if (!this.countdownTimer) return
    clearInterval(this.countdownTimer)
    this.countdownTimer = null
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
  },
  cancelOrder() {
    const order = this.data.order
    if (!order || !order.canCancel) return
    wx.showModal({
      title: '取消订单',
      content: '取消后订单将关闭，已占用的商品库存会恢复。是否继续？',
      confirmText: '确认取消',
      confirmColor: '#c53030',
      success: (result) => {
        if (!result.confirm) return
        wx.showLoading({ title: '取消中', mask: true })
        callOrderService('cancelOrder', { orderId: order._id })
          .then(() => this.loadOrder())
          .then(() => wx.showToast({ title: '订单已取消', icon: 'success' }))
          .catch((err) => wx.showModal({ title: '取消失败', content: err.message || '请稍后重试', showCancel: false }))
          .finally(() => wx.hideLoading())
      }
    })
  },
  requestRefund() {
    const order = this.data.order
    if (!order || !order.canRefund) return
    wx.showModal({
      title: '申请退款',
      content: '提交后商家会审核退款申请，确认要申请退款吗？',
      confirmText: '提交申请',
      confirmColor: '#c53030',
      success: (result) => {
        if (!result.confirm) return
        wx.showLoading({ title: '提交中', mask: true })
        callOrderService('requestRefund', { orderId: order._id })
          .then(() => this.loadOrder())
          .then(() => wx.showToast({ title: '退款申请已提交', icon: 'success' }))
          .catch((err) => wx.showModal({ title: '申请失败', content: err.message || '请稍后重试', showCancel: false }))
          .finally(() => wx.hideLoading())
      }
    })
  },
  deleteOrder() {
    const order = this.data.order
    if (!order || !order.canDelete) return
    wx.showModal({
      title: '删除订单',
      content: '删除后将不再显示此订单，是否继续？',
      confirmText: '删除',
      confirmColor: '#c53030',
      success: (result) => {
        if (!result.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        callOrderService('deleteOrder', { orderId: order._id })
          .then(() => wx.redirectTo({ url: '/pages/orders/orders' }))
          .catch((err) => wx.showModal({ title: '删除失败', content: err.message || '请稍后重试', showCancel: false }))
          .finally(() => wx.hideLoading())
      }
    })
  }
})
