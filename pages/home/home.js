Page({
  openOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' })
  },
  openCart() {
    wx.switchTab({ url: '/pages/cart/cart' })
  }
})
