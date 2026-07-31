const { getCartItems, removeCartItems } = require('../../utils/cart')
const { callOrderService, formatMoney, formatOrderItem } = require('../../utils/order')
const { formatSpecText, toFiniteNumber } = require('../../utils/product')

const PHONE_PATTERN = /^1\d{10}$/

const toCheckoutItem = (item) => formatOrderItem({
  key: item.key,
  productId: item.productId,
  skuId: item.skuId,
  name: item.name,
  image: item.image,
  specs: item.specs || {},
  specText: item.specText || formatSpecText(item.specs),
  unitPrice: toFiniteNumber(item.prices),
  subtotal: toFiniteNumber(item.prices) * toFiniteNumber(item.quantity),
  quantity: toFiniteNumber(item.quantity, 1),
  priceType: item.priceType,
  priceRemark: item.priceRemark
})

Page({
  data: {
    items: [],
    selectedKeys: [],
    totalAmountText: '0.00',
    amountLabel: '合计',
    standardItems: [],
    onsiteItems: [],
    hasStandardItems: false,
    hasOnsiteItems: false,
    onsiteFulfillmentType: 'store',
    orderCount: 1,
    contact: {
      name: '',
      phone: '',
      address: ''
    },
    note: '',
    pageStatus: 'loading',
    pageMessage: '',
    submitting: false
  },
  onLoad() {
    const selectedItems = getCartItems().filter((item) => item.selected !== false)
    if (!selectedItems.length) {
      this.setData({ pageStatus: 'empty', pageMessage: '没有可结算的商品' })
      return
    }

    const items = selectedItems.map(toCheckoutItem)
    const hasEstimatedPrice = items.some((item) => item.priceType === 'starting' || item.priceRemark)
    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0)
    this.setData({
      items,
      selectedKeys: selectedItems.map((item) => item.key),
      totalAmountText: formatMoney(totalAmount),
      amountLabel: hasEstimatedPrice ? '预估合计' : '合计'
    })
    Promise.all([
      this.loadProfile(),
      this.loadCheckoutOptions(items)
    ]).finally(() => this.setData({ pageStatus: 'success' }))
  },
  loadProfile() {
    return callOrderService('getProfile')
      .then((profile) => {
        if (!profile) return
        this.setData({
          contact: {
            name: profile.name || '',
            phone: profile.phone || '',
            address: profile.address || ''
          }
        })
      })
      .catch((err) => console.warn('读取联系人信息失败:', err))
  },
  loadCheckoutOptions(items) {
    const orderItems = items.map((item) => ({
      productId: item.productId,
      skuId: item.skuId,
      quantity: item.quantity
    }))
    return callOrderService('getCheckoutOptions', { items: orderItems })
      .then(({ onsiteProductIds = [] }) => {
        const onsiteProductIdSet = new Set(onsiteProductIds)
        const onsiteItems = items.filter((item) => onsiteProductIdSet.has(item.productId))
        const standardItems = items.filter((item) => !onsiteProductIdSet.has(item.productId))
        this.setData({
          standardItems,
          onsiteItems,
          hasStandardItems: standardItems.length > 0,
          hasOnsiteItems: onsiteItems.length > 0,
          onsiteFulfillmentType: onsiteItems.length ? this.data.onsiteFulfillmentType : 'store',
          orderCount: standardItems.length && onsiteItems.length ? 2 : 1
        })
      })
      .catch((err) => {
        console.warn('读取办理方式失败:', err)
        this.setData({
          standardItems: items,
          onsiteItems: [],
          hasStandardItems: true,
          hasOnsiteItems: false,
          onsiteFulfillmentType: 'store',
          orderCount: 1
        })
      })
  },
  selectFulfillment(e) {
    if (!this.data.hasOnsiteItems) return
    this.setData({ onsiteFulfillmentType: e.currentTarget.dataset.type })
  },
  handleContactInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`contact.${field}`]: e.detail.value })
  },
  handleNoteInput(e) {
    this.setData({ note: e.detail.value })
  },
  validateForm() {
    const contact = {
      name: this.data.contact.name.trim(),
      phone: this.data.contact.phone.trim(),
      address: this.data.contact.address.trim()
    }
    if (contact.name.length < 2) return '请填写联系人姓名'
    if (!PHONE_PATTERN.test(contact.phone)) return '请填写正确的手机号码'
    if (this.data.onsiteFulfillmentType === 'delivery' && !this.data.hasOnsiteItems) return '当前商品不支持上门服务'
    if (this.data.onsiteFulfillmentType === 'delivery' && contact.address.length < 5) return '请填写详细地址'
    return ''
  },
  submitOrder() {
    if (this.data.submitting) return
    const errorMessage = this.validateForm()
    if (errorMessage) {
      wx.showToast({ title: errorMessage, icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    const contact = {
      name: this.data.contact.name.trim(),
      phone: this.data.contact.phone.trim(),
      address: this.data.contact.address.trim()
    }
    const items = this.data.items.map((item) => ({
      productId: item.productId,
      skuId: item.skuId,
      quantity: item.quantity
    }))

    callOrderService('createOrders', {
      items,
      contact,
      onsiteFulfillmentType: this.data.onsiteFulfillmentType,
      note: this.data.note.trim()
    }).then((result) => {
      removeCartItems(this.data.selectedKeys)
      wx.showToast({ title: '订单已提交', icon: 'success' })
      setTimeout(() => {
        const orders = Array.isArray(result.orders) ? result.orders : []
        const url = orders.length === 1
          ? `/pages/order-detail/order-detail?id=${orders[0].orderId}`
          : '/pages/orders/orders'
        wx.redirectTo({ url })
      }, 500)
    }).catch((err) => {
      console.error('提交订单失败:', err)
      wx.showModal({
        title: '提交失败',
        content: err.message || '请稍后重试',
        showCancel: false
      })
    }).finally(() => this.setData({ submitting: false }))
  },
  goShopping() {
    wx.switchTab({ url: '/pages/type/type' })
  }
})
