const { formatSpecText, toFiniteNumber } = require('./product')

const { getUserSession } = require('./auth')

const CART_STORAGE_KEY_PREFIX = 'laifeng_cart_items'

const getCartStorageKey = () => {
  const { userId, loggedIn } = getUserSession()
  return loggedIn && userId ? `${CART_STORAGE_KEY_PREFIX}:${userId}` : ''
}

const getCartItems = () => {
  const storageKey = getCartStorageKey()
  if (!storageKey) return []
  const items = wx.getStorageSync(storageKey)
  return Array.isArray(items) ? items : []
}

const saveCartItems = (items) => {
  const storageKey = getCartStorageKey()
  if (!storageKey) return []
  wx.setStorageSync(storageKey, items)
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
      itemType: product.itemType || '',
      image: sku.image || product.image || '',
      specs: sku.specs || {},
      specText: formatSpecText(sku.specs),
      prices: toFiniteNumber(sku.prices),
      priceType: sku.priceType || 'fixed',
      paymentMode: sku.paymentMode || '',
      inspectionFeeCents: toFiniteNumber(sku.inspectionFeeCents),
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
  CART_STORAGE_KEY_PREFIX,
  addCartItem,
  getCartItems,
  removeCartItems,
  saveCartItems,
  syncCartBadge
}
