const { normalizeProduct } = require('../../utils/product')

Page({
  data: {
    firstTypes: [],
    products: [],
    currentFirstType: '',
    categoriesStatus: 'loading',
    productsStatus: 'loading',
    productsMessage: ''
  },
  onLoad() {
    this.productRequestId = 0
    this.getFirstTypes()
  },
  getFirstTypes() {
    this.setData({ categoriesStatus: 'loading' })
    const db = wx.cloud.database()
    return db.collection('shop_firstType').get()
      .then((res) => {
        const firstTypes = res.data || []
        this.setData({
          firstTypes,
          categoriesStatus: firstTypes.length > 0 ? 'success' : 'empty'
        })
        if (firstTypes.length > 0) {
          this.setData({ currentFirstType: firstTypes[0]._id })
          return this.getProducts(firstTypes[0]._id)
        }
      })
      .catch((err) => {
        console.error('获取一级分类失败:', err)
        this.setData({
          firstTypes: [],
          products: [],
          categoriesStatus: 'error',
          productsStatus: 'empty'
        })
      })
  },
  retryCategories() {
    this.getFirstTypes()
  },
  getProducts(categoryId) {
    const requestId = ++this.productRequestId
    this.setData({ productsStatus: 'loading', productsMessage: '' })
    const db = wx.cloud.database()
    return db.collection('goods')
      .where({ categoryId })
      .orderBy('sort', 'asc')
      .get()
      .then((res) => {
        if (requestId !== this.productRequestId) return
        const products = (res.data || []).map(normalizeProduct)
        this.setData({
          products,
          productsStatus: products.length > 0 ? 'success' : 'empty'
        })
      })
      .catch((err) => {
        if (requestId !== this.productRequestId) return
        console.error('获取商品列表失败:', err)
        this.setData({
          products: [],
          productsStatus: 'error',
          productsMessage: '商品加载失败，请稍后重试'
        })
      })
  },
  switchFirstType(e) {
    const firstTypeId = e.currentTarget.dataset.id
    if (!firstTypeId || firstTypeId === this.data.currentFirstType) return
    this.setData({ currentFirstType: firstTypeId })
    this.getProducts(firstTypeId)
  },
  retryProducts() {
    if (this.data.currentFirstType) this.getProducts(this.data.currentFirstType)
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
