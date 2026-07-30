const { normalizeProduct } = require('../../utils/product')
const { syncCartBadge } = require('../../utils/cart')

Page({
  data: {
    banners: [],
    recommendedProducts: [],
    productsStatus: 'loading',
    productsMessage: ''
  },
  onLoad() {
    this.loadPage()
  },
  onShow() {
    syncCartBadge()
  },
  onPullDownRefresh() {
    this.loadPage().finally(() => wx.stopPullDownRefresh())
  },
  loadPage() {
    this.setData({ productsStatus: 'loading', productsMessage: '' })
    return Promise.all([
      this.getBanners(),
      this.getRecommendedProducts()
    ])
  },
  getBanners() {
    const db = wx.cloud.database()
    return db.collection('top-banner').get()
      .then((res) => {
        this.setData({ banners: res.data || [] })
      })
      .catch((err) => {
        console.error('获取轮播图失败:', err)
        this.setData({ banners: [] })
      })
  },
  getRecommendedProducts() {
    const db = wx.cloud.database()
    return db.collection('goods')
      .where({ isrecommend: true })
      .orderBy('sort', 'asc')
      .get()
      .then((res) => {
        const products = (res.data || []).map(normalizeProduct)
        this.setData({
          recommendedProducts: products,
          productsStatus: products.length > 0 ? 'success' : 'empty'
        })
      })
      .catch((err) => {
        console.error('获取推荐商品失败:', err)
        this.setData({
          recommendedProducts: [],
          productsStatus: 'error',
          productsMessage: '推荐商品加载失败，请稍后重试'
        })
      })
  },
  openSearch() {
    wx.navigateTo({ url: '/pages/search/search' })
  },
  openProduct(e) {
    const product = e.detail.product
    wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${product._id}` })
  },
  chooseProduct(e) {
    const product = e.detail.product
    wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${product._id}&select=1` })
  }
})
