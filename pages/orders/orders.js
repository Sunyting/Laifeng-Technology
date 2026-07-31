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
    this.loadOrders()
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
  applyFilter() {
    const { allOrders, selectedFilter } = this.data
    const orders = selectedFilter === 'all'
      ? allOrders
      : allOrders.filter((order) => {
        if (selectedFilter === 'pending_confirmation') return order.status === selectedFilter
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
