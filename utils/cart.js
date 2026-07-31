const { formatSpecText, toFiniteNumber } = require('./product')

const CART_STORAGE_KEY = 'laifeng_cart_items'

const getCartItems = () => {
  const items = wx.getStorageSync(CART_STORAGE_KEY)
  return Array.isArray(items) ? items : []
}

const saveCartItems = (items) => {
  wx.setStorageSync(CART_STORAGE_KEY, items)
  return items
}

const removeCartItems = (keys = []) => {
  const keySet = new Set(keys)
  const items = getCartItems().filter((item) => !keySet.has(item.key))
  saveCartItems(items)
  syncCartBadge(items)
  return items
}

const syncCartBadge = (items = getCartItems()) => {
  const count = items.reduce((sum, item) => sum + toFiniteNumber(item.quantity), 0)
  if (count > 0) {
    wx.setTabBarBadge({ index: 2, text: count > 99 ? '99+' : String(count) })
  } else {
    wx.removeTabBarBadge({ index: 2, fail: () => {} })
  }
}

const addCartItem = (product, sku, quantity = 1) => {
  if (!product || !sku) return getCartItems()

  const items = getCartItems()
  const key = `${product._id}::${sku.id}`
  const existingIndex = items.findIndex((item) => item.key === key)
  const stock = Math.max(0, toFiniteNumber(sku.stock))
  const safeQuantity = Math.max(1, Math.min(toFiniteNumber(quantity, 1), stock || 1, 99))

  if (existingIndex >= 0) {
    const existing = items[existingIndex]
    items[existingIndex] = {
      ...existing,
      quantity: Math.min(existing.quantity + safeQuantity, stock || 1, 99),
      stock
    }
  } else {
    items.push({
      key,
      productId: product._id,
      skuId: sku.id,
      name: product.name,
      image: sku.image || product.image || '',
      specs: sku.specs || {},
      specText: formatSpecText(sku.specs),
      prices: toFiniteNumber(sku.prices),
      priceType: sku.priceType || 'fixed',
      unit: sku.unit || '',
      priceRemark: sku.priceRemark || '',
      stock,
      quantity: safeQuantity,
      selected: true
    })
  }

  saveCartItems(items)
  syncCartBadge(items)
  return items
}

module.exports = {
  CART_STORAGE_KEY,
  addCartItem,
  getCartItems,
  removeCartItems,
  saveCartItems,
  syncCartBadge
}
