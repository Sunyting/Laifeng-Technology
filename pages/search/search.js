const { normalizeProduct } = require('../../utils/product')

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PAGE_SIZE = 20

Page({
  data: {
    keyword: '',
    products: [],
    searchStatus: 'idle',
    searchMessage: '输入商品名称开始搜索'
  },
  onLoad(options) {
    const keyword = options.keyword ? decodeURIComponent(options.keyword).trim() : ''
    if (keyword) {
      this.setData({ keyword })
      this.searchProducts()
    }
  },
  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchRequestId = (this.searchRequestId || 0) + 1
  },
  handleInput(e) {
    const keyword = e.detail.value
    this.searchRequestId = (this.searchRequestId || 0) + 1
    this.setData({ keyword })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    if (!keyword.trim()) {
      this.setData({
        products: [],
        searchStatus: 'idle',
        searchMessage: '输入商品名称开始搜索'
      })
      return
    }
    this.searchTimer = setTimeout(() => this.searchProducts(), 350)
  },
  handleConfirm() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchProducts()
  },
  clearSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchRequestId = (this.searchRequestId || 0) + 1
    this.setData({
      keyword: '',
      products: [],
      searchStatus: 'idle',
      searchMessage: '输入商品名称开始搜索'
    })
  },
  searchProducts() {
    const keyword = this.data.keyword.trim()
    if (!keyword) return

    const requestId = (this.searchRequestId || 0) + 1
    this.searchRequestId = requestId
    this.setData({ searchStatus: 'loading', searchMessage: '' })

    const db = wx.cloud.database()
    const condition = {
      name: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' }),
      status: '1'
    }
    const fetchPage = (skip = 0, products = []) => db.collection('goods')
      .where(condition)
      .orderBy('sort', 'asc')
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
      .then((res) => {
        const pageProducts = res.data || []
        const nextProducts = products.concat(pageProducts)
        return pageProducts.length === PAGE_SIZE
          ? fetchPage(skip + PAGE_SIZE, nextProducts)
          : nextProducts
      })

    return fetchPage()
      .then((res) => {
        if (requestId !== this.searchRequestId) return
        const products = res.map(normalizeProduct)
        this.setData({
          products,
          searchStatus: products.length ? 'success' : 'empty',
          searchMessage: products.length ? '' : `没有找到“${keyword}”相关商品`
        })
      })
      .catch((err) => {
        if (requestId !== this.searchRequestId) return
        console.error('搜索商品失败:', err)
        this.setData({
          products: [],
          searchStatus: 'error',
          searchMessage: '搜索失败，请稍后重试'
        })
      })
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
