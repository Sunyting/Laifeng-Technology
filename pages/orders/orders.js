const { callOrderService, formatOrder } = require('../../utils/order')
const { loadUserSession, openLogin } = require('../../utils/auth')

Page({
  data: {
    allOrders: [],
    orders: [],
    selectedFilter: 'all',
    filters: [
      { value: 'all', label: '全部' },
      { value: 'unpaid', label: '待付款' },
      { value: 'paid', label: '已付款' },
      { value: 'pending_confirmation', label: '待确认' }
    ],
    pageStatus: 'loading',
    pageMessage: ''
  },
  onLoad(options) {
    const allowedFilters = ['all', 'unpaid', 'paid', 'pending_confirmation']
    const selectedFilter = allowedFilters.includes(options.filter) ? options.filter : 'all'
    this.setData({ selectedFilter })
  },
  onShow() {
    this.pageVisible = true
    this.loadOrders().then(() => this.startCountdown()).catch(() => {})
  },
  onHide() {
    this.pageVisible = false
    this.stopCountdown()
  },
  onUnload() {
    this.pageVisible = false
    this.stopCountdown()
  },
  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh())
  },
  loadOrders() {
    this.setData({ pageStatus: 'loading', pageMessage: '' })
    return loadUserSession(true)
      .then((session) => {
        if (!session.loggedIn) {
          this.setData({
            allOrders: [],
            orders: [],
            pageStatus: 'loginRequired',
            pageMessage: '登录后才能查看订单'
          })
          return null
        }
        return callOrderService('listOrders')
      })
      .then((orders) => {
        if (orders === null) return
        const formattedOrders = (orders || []).map(formatOrder)
        this.setData({ allOrders: formattedOrders })
        this.applyFilter()
      })
      .catch((err) => {
        console.error('获取订单失败:', err)
        this.setData({ pageStatus: 'error', pageMessage: err.message || '订单加载失败，请稍后重试' })
      })
  },
  startCountdown() {
    this.stopCountdown()
    if (!this.pageVisible) return
    this.countdownTimer = setInterval(() => {
      const now = Date.now()
      const shouldRefresh = this.data.allOrders.some((order) => {
        return order.status === 'pending_payment' && ['unpaid', 'paying'].includes(order.paymentStatus) &&
          Number(order.paymentDeadlineAt) > 0 && Number(order.paymentDeadlineAt) <= now
      })
      if (shouldRefresh && !this.expiryRefreshPending) {
        this.expiryRefreshPending = true
        this.loadOrders().finally(() => { this.expiryRefreshPending = false })
        return
      }
      this.setData({ allOrders: this.data.allOrders.map((order) => formatOrder(order, now)) })
      this.applyFilter()
    }, 1000)
  },
  stopCountdown() {
    if (!this.countdownTimer) return
    clearInterval(this.countdownTimer)
    this.countdownTimer = null
  },
  applyFilter() {
    const { allOrders, selectedFilter } = this.data
    const orders = selectedFilter === 'all'
      ? allOrders
      : allOrders.filter((order) => {
        if (selectedFilter === 'pending_confirmation') return order.status === selectedFilter
        if (selectedFilter === 'unpaid') {
          return ['unpaid', 'paying'].includes(order.paymentStatus)
        }
        return order.paymentStatus === selectedFilter
      })
    this.setData({
      orders,
      pageStatus: orders.length ? 'success' : 'empty',
      pageMessage: orders.length ? '' : (allOrders.length ? '该分类下还没有订单' : '还没有订单')
    })
  },
  selectFilter(e) {
    const selectedFilter = e.currentTarget.dataset.value
    if (!selectedFilter || selectedFilter === this.data.selectedFilter) return
    this.setData({ selectedFilter })
    this.applyFilter()
  },
  openOrder(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` })
  },
  deleteOrder(e) {
    const orderId = e.currentTarget.dataset.id
    const order = this.data.allOrders.find((item) => item._id === orderId)
    if (!order || !order.canDelete) return
    wx.showModal({
      title: '删除订单',
      content: '删除后将不再显示此订单，是否继续？',
      confirmText: '删除',
      confirmColor: '#c53030',
      success: (result) => {
        if (!result.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        callOrderService('deleteOrder', { orderId })
          .then(() => {
            wx.showToast({ title: '订单已删除', icon: 'success' })
            return this.loadOrders()
          })
          .catch((err) => {
            wx.showModal({ title: '删除失败', content: err.message || '请稍后重试', showCancel: false })
          })
          .finally(() => wx.hideLoading())
      }
    })
  },
  cancelOrder(e) {
    const orderId = e.currentTarget.dataset.id
    const order = this.data.allOrders.find((item) => item._id === orderId)
    if (!order || !order.canCancel) return
    wx.showModal({
      title: '取消订单',
      content: '取消后订单将关闭，已占用的商品库存会恢复。是否继续？',
      confirmText: '确认取消',
      confirmColor: '#c53030',
      success: (result) => {
        if (!result.confirm) return
        wx.showLoading({ title: '取消中', mask: true })
        callOrderService('cancelOrder', { orderId })
          .then(() => { wx.showToast({ title: '订单已取消', icon: 'success' }); return this.loadOrders() })
          .catch((err) => wx.showModal({ title: '取消失败', content: err.message || '请稍后重试', showCancel: false }))
          .finally(() => wx.hideLoading())
      }
    })
  },
  requestRefund(e) {
    const orderId = e.currentTarget.dataset.id
    const order = this.data.allOrders.find((item) => item._id === orderId)
    if (!order || !order.canRefund) return
    wx.showModal({
      title: '申请退款',
      content: '提交后商家会审核退款申请，确认要申请退款吗？',
      confirmText: '提交申请',
      confirmColor: '#c53030',
      success: (result) => {
        if (!result.confirm) return
        wx.showLoading({ title: '提交中', mask: true })
        callOrderService('requestRefund', { orderId })
          .then(() => { wx.showToast({ title: '退款申请已提交', icon: 'success' }); return this.loadOrders() })
          .catch((err) => wx.showModal({ title: '申请失败', content: err.message || '请稍后重试', showCancel: false }))
          .finally(() => wx.hideLoading())
      }
    })
  },
  goShopping() {
    wx.switchTab({ url: '/pages/type/type' })
  },
  handleStatusAction() {
    if (this.data.pageStatus === 'loginRequired') {
      openLogin()
      return
    }
    if (this.data.pageStatus === 'empty') {
      if (this.data.allOrders.length) {
        this.setData({ selectedFilter: 'all' })
        this.applyFilter()
        return
      }
      this.goShopping()
      return
    }
    this.loadOrders()
  }
})
