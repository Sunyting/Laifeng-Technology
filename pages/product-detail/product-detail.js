const { addCartItem, syncCartBadge } = require('../../utils/cart')
const {
  findSelectedSku,
  getInitialSelection,
  normalizeProduct
} = require('../../utils/product')

Page({
  data: {
    product: null,
    gallery: [],
    selectedValues: {},
    selectedSku: null,
    quantity: 1,
    pageStatus: 'loading',
    pageMessage: '',
    imageFailed: false,
    showSelectorHint: false
  },
  onLoad(options) {
    this.productId = options.id || ''
    this.openForSelection = options.select === '1'
    this.loadProduct()
  },
  onShow() {
    syncCartBadge()
  },
  loadProduct() {
    if (!this.productId) {
      this.setData({ pageStatus: 'error', pageMessage: '商品参数无效' })
      return Promise.resolve()
    }

    this.setData({ pageStatus: 'loading', pageMessage: '' })
    return wx.cloud.database().collection('goods').doc(this.productId).get()
      .then((res) => {
        const product = normalizeProduct(res.data)
        const selectedValues = getInitialSelection(product)
        const selectedSku = findSelectedSku(product, selectedValues)
        const gallery = [product.image, ...(Array.isArray(product.images) ? product.images : [])]
          .filter((image, index, images) => image && images.indexOf(image) === index)
        this.setData({
          product,
          gallery,
          selectedValues,
          selectedSku,
          quantity: 1,
          pageStatus: 'success',
          imageFailed: false,
          showSelectorHint: this.openForSelection
        })
        wx.setNavigationBarTitle({ title: product.name || '商品详情' })
      })
      .catch((err) => {
        console.error('获取商品详情失败:', err)
        this.setData({ pageStatus: 'error', pageMessage: '商品加载失败，请稍后重试' })
      })
  },
  handleImageError() {
    this.setData({ imageFailed: true })
  },
  selectSpec(e) {
    const { levelName, value } = e.detail
    let selectedValues = { ...this.data.selectedValues, [levelName]: value }
    let selectedSku = findSelectedSku(this.data.product, selectedValues)
    if (!selectedSku || Number(selectedSku.stock) <= 0) {
      selectedSku = this.data.product.SKUlist.find((sku) => {
        return sku.specs && sku.specs[levelName] === value && Number(sku.stock) > 0
      }) || null
      if (selectedSku) selectedValues = { ...(selectedSku.specs || {}) }
    }
    this.setData({
      selectedValues,
      selectedSku,
      quantity: selectedSku ? Math.min(this.data.quantity, Math.max(1, Number(selectedSku.stock))) : 1,
      showSelectorHint: false
    })
  },
  decreaseQuantity() {
    if (this.data.quantity > 1) this.setData({ quantity: this.data.quantity - 1 })
  },
  increaseQuantity() {
    const stock = this.data.selectedSku ? Number(this.data.selectedSku.stock) : 0
    if (this.data.quantity >= Math.min(stock, 99)) {
      wx.showToast({ title: stock > 99 ? '单次最多购买99件' : '已达库存上限', icon: 'none' })
      return
    }
    this.setData({ quantity: this.data.quantity + 1 })
  },
  addToCart() {
    const { product, selectedSku, quantity } = this.data
    if (!selectedSku) {
      wx.showToast({ title: '请选择完整规格', icon: 'none' })
      this.setData({ showSelectorHint: true })
      return
    }
    if (Number(selectedSku.stock) <= 0) {
      wx.showToast({ title: '当前规格库存不足', icon: 'none' })
      return
    }
    addCartItem(product, selectedSku, quantity)
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },
  goToCart() {
    wx.switchTab({ url: '/pages/cart/cart' })
  },
  onShareAppMessage() {
    const product = this.data.product
    return {
      title: product ? product.name : '来锋科技商品',
      path: `/pages/product-detail/product-detail?id=${this.productId}`,
      imageUrl: product && product.image ? product.image : undefined
    }
  }
})
