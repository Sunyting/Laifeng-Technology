const {
  getCartItems,
  saveCartItems,
  syncCartBadge
} = require('../../utils/cart')
const { toFiniteNumber } = require('../../utils/product')

const enrichItem = (item) => ({
  ...item,
  selected: item.selected !== false,
  displaySku: {
    id: item.skuId,
    prices: item.prices,
    priceType: item.priceType,
    unit: item.unit,
    priceRemark: item.priceRemark
  }
})

const stripDisplayFields = (item) => {
  const { displaySku, ...storageItem } = item
  return storageItem
}

Page({
  data: {
    items: [],
    allSelected: false,
    selectedCount: 0,
    totalPrice: '0.00'
  },
  onShow() {
    this.refreshCart(getCartItems().map(enrichItem), false)
  },
  refreshCart(items, persist = true) {
    const selectedItems = items.filter((item) => item.selected)
    const selectedCount = selectedItems.reduce((sum, item) => sum + toFiniteNumber(item.quantity), 0)
    const totalPrice = selectedItems
      .reduce((sum, item) => sum + toFiniteNumber(item.prices) * toFiniteNumber(item.quantity), 0)
      .toFixed(2)

    this.setData({
      items,
      allSelected: items.length > 0 && selectedItems.length === items.length,
      selectedCount,
      totalPrice
    })

    const storageItems = items.map(stripDisplayFields)
    if (persist) saveCartItems(storageItems)
    syncCartBadge(storageItems)
  },
  toggleItem(e) {
    const key = e.currentTarget.dataset.key
    const items = this.data.items.map((item) => item.key === key
      ? { ...item, selected: !item.selected }
      : item)
    this.refreshCart(items)
  },
  toggleAll() {
    const selected = !this.data.allSelected
    this.refreshCart(this.data.items.map((item) => ({ ...item, selected })))
  },
  decreaseQuantity(e) {
    this.updateQuantity(e.currentTarget.dataset.key, -1)
  },
  increaseQuantity(e) {
    this.updateQuantity(e.currentTarget.dataset.key, 1)
  },
  updateQuantity(key, change) {
    let reachedLimit = false
    const items = this.data.items.map((item) => {
      if (item.key !== key) return item
      const maxQuantity = Math.min(Math.max(1, toFiniteNumber(item.stock)), 99)
      const nextQuantity = Math.max(1, Math.min(item.quantity + change, maxQuantity))
      reachedLimit = change > 0 && nextQuantity === item.quantity
      return { ...item, quantity: nextQuantity }
    })
    if (reachedLimit) wx.showToast({ title: '已达可购买数量上限', icon: 'none' })
    this.refreshCart(items)
  },
  removeItem(e) {
    const key = e.currentTarget.dataset.key
    const item = this.data.items.find((cartItem) => cartItem.key === key)
    if (!item) return
    wx.showModal({
      title: '移除商品',
      content: `确定移除“${item.name}”吗？`,
      confirmColor: '#e53e3e',
      success: (res) => {
        if (res.confirm) this.refreshCart(this.data.items.filter((cartItem) => cartItem.key !== key))
      }
    })
  },
  openProduct(e) {
    const productId = e.currentTarget.dataset.id
    if (productId) wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${productId}` })
  },
  goShopping() {
    wx.switchTab({ url: '/pages/type/type' })
  },
  checkout() {
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请先选择商品', icon: 'none' })
      return
    }
    wx.showModal({
      title: '订单功能待接入',
      content: `已选择 ${this.data.selectedCount} 件商品，合计 ¥${this.data.totalPrice}。当前暂未接入订单提交，请联系门店完成购买。`,
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
