const { callOrderService, formatOrder } = require('../../utils/order')

Page({
  data: {
    orders: [],
    pageStatus: 'loading',
    pageMessage: ''
  },
  onShow() {
    this.loadOrders()
  },
  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh())
  },
  loadOrders() {
    this.setData({ pageStatus: 'loading', pageMessage: '' })
    return callOrderService('listOrders')
      .then((orders) => {
        const formattedOrders = (orders || []).map(formatOrder)
        this.setData({
          orders: formattedOrders,
          pageStatus: formattedOrders.length ? 'success' : 'empty',
          pageMessage: formattedOrders.length ? '' : '还没有订单'
        })
      })
      .catch((err) => {
        console.error('获取订单失败:', err)
        this.setData({ pageStatus: 'error', pageMessage: err.message || '订单加载失败，请稍后重试' })
      })
  },
  openOrder(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` })
  },
  goShopping() {
    wx.switchTab({ url: '/pages/type/type' })
  },
  handleStatusAction() {
    if (this.data.pageStatus === 'empty') {
      this.goShopping()
      return
    }
    this.loadOrders()
  }
})
