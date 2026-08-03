const { clearBuyNowItem, getBuyNowItem, getCartItems, removeCartItems } = require('../../utils/cart')
const { loadUserSession, openLogin } = require('../../utils/auth')
const { callOrderService, formatMoney, formatOrderItem, MERCHANT_PHONE } = require('../../utils/order')
const { formatSpecText, toFiniteNumber } = require('../../utils/product')

const PHONE_PATTERN = /^1\d{10}$/
const padNumber = (value) => String(value).padStart(2, '0')

const formatDate = (date) => `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`

const getAppointmentDefaults = () => {
  const now = new Date()
  const defaultDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const maxDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90)
  return {
    appointmentDate: formatDate(defaultDate),
    appointmentTime: '09:00',
    minAppointmentDate: formatDate(now),
    maxAppointmentDate: formatDate(maxDate)
  }
}

const getAppointmentTimestamp = (date, time) => new Date(`${date}T${time}:00+08:00`).getTime()

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
  paymentMode: item.paymentMode,
  inspectionFeeCents: toFiniteNumber(item.inspectionFeeCents),
  priceRemark: item.priceRemark
})

const getOnlinePaymentSummary = (items) => {
  const summary = items.reduce((result, item) => {
    const unitPriceCents = Math.round(toFiniteNumber(item.unitPrice) * 100)
    const isInspectionFee = item.itemType === 'service' && (
      item.paymentMode === 'inspection_fee' || (!item.paymentMode && item.priceType === 'starting')
    )
    const onlineUnitAmountCents = isInspectionFee && item.inspectionFeeCents > 0
      ? Math.round(item.inspectionFeeCents)
      : unitPriceCents
    result.onlinePayableAmountCents += onlineUnitAmountCents * toFiniteNumber(item.quantity, 1)
    result.hasInspectionFee = result.hasInspectionFee || isInspectionFee
    return result
  }, { onlinePayableAmountCents: 0, hasInspectionFee: false })
  return {
    totalAmountText: formatMoney(summary.onlinePayableAmountCents / 100),
    amountLabel: summary.hasInspectionFee ? '本次应付' : '合计',
    paymentHint: summary.hasInspectionFee ? '起步价服务仅收检查费，维修费到店支付。' : ''
  }
}

const getDefaultFulfillmentType = (fulfillmentTypes) => {
  if (fulfillmentTypes.length === 1) return fulfillmentTypes[0]
  return fulfillmentTypes.includes('store') ? 'store' : fulfillmentTypes[0]
}

const getCheckoutGroups = (serviceItems, physicalItems) => {
  const hasStoreServices = serviceItems.some((item) => item.fulfillmentType === 'store')
  const hasDeliveryItems = serviceItems.some((item) => item.fulfillmentType === 'delivery')
  const hasAppointmentItems = serviceItems.some((item) => item.fulfillmentType === 'delivery' && item.requiresAppointment)
  const orderCount = Number(physicalItems.length > 0) + Number(hasStoreServices) + Number(hasDeliveryItems)
  return {
    hasDeliveryItems,
    hasAppointmentItems,
    orderCount: Math.max(1, orderCount),
    submitButtonText: orderCount > 1 ? `提交${orderCount}个订单` : '提交订单'
  }
}

Page({
  data: {
    items: [],
    selectedKeys: [],
    totalAmountText: '0.00',
    amountLabel: '合计',
    paymentHint: '',
    physicalItems: [],
    serviceItems: [],
    hasPhysicalItems: false,
    hasServiceItems: false,
    hasDeliveryCapableItems: false,
    hasDeliveryItems: false,
    hasAppointmentItems: false,
    merchantPhone: MERCHANT_PHONE,
    appointmentDate: '',
    appointmentTime: '',
    minAppointmentDate: '',
    maxAppointmentDate: '',
    orderCount: 1,
    submitButtonText: '提交订单',
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
  onLoad(options) {
    this.checkoutMode = options && options.mode === 'buyNow' ? 'buyNow' : 'cart'
    this.setData({
      ...getAppointmentDefaults(),
      pageStatus: 'loading',
      pageMessage: ''
    })
    loadUserSession(true)
      .then((session) => {
        if (!session.loggedIn) {
          this.setData({ pageStatus: 'loginRequired', pageMessage: '请先登录后再结算' })
          return
        }
        this.initializeCheckout()
      })
      .catch((err) => {
        console.error('结算登录状态检查失败:', err)
        this.setData({ pageStatus: 'error', pageMessage: '登录状态检查失败，请稍后重试' })
      })
  },
  initializeCheckout() {
    const buyNowItem = this.checkoutMode === 'buyNow' ? getBuyNowItem() : null
    const selectedItems = buyNowItem
      ? [buyNowItem]
      : getCartItems().filter((item) => item.selected !== false)
    if (!selectedItems.length) {
      this.setData({ pageStatus: 'empty', pageMessage: '没有可结算的商品' })
      return
    }

    const items = selectedItems.map(toCheckoutItem)
    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0)
    this.setData({
      items,
      selectedKeys: selectedItems.map((item) => item.key),
      totalAmountText: formatMoney(totalAmount),
      amountLabel: '合计'
    })
    Promise.all([
      this.loadProfile(),
      this.loadCheckoutOptions(items)
    ]).then(() => this.setData({ pageStatus: 'success' })).catch(() => {})
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
      .then(({ itemOptions = [], itemPaymentOptions = [], onsiteProductIds = [] }) => {
        const itemOptionMap = new Map(itemOptions.map((option) => [option.productId, option]))
        const itemPaymentOptionMap = new Map(itemPaymentOptions.map((option) => [option.key, option]))
        const legacyOnsiteProductIds = new Set(onsiteProductIds)
        const classifiedItems = items.map((item) => {
          const option = itemOptionMap.get(item.productId) || (legacyOnsiteProductIds.has(item.productId)
            ? { itemType: 'service', fulfillmentTypes: ['store', 'delivery'], requiresAppointment: true }
            : { itemType: 'physical', fulfillmentTypes: ['store'], requiresAppointment: false })
          const fulfillmentTypes = Array.isArray(option.fulfillmentTypes) && option.fulfillmentTypes.length
            ? option.fulfillmentTypes
            : ['store']
          const itemType = option.itemType === 'service' ? 'service' : 'physical'
          const paymentOption = itemPaymentOptionMap.get(item.key) || {}
          const unitPrice = Number.isInteger(paymentOption.unitPriceCents)
            ? paymentOption.unitPriceCents / 100
            : item.unitPrice
          const normalizedItem = formatOrderItem({
            ...item,
            itemType,
            unitPrice,
            subtotal: unitPrice * item.quantity,
            paymentMode: paymentOption.paymentMode || item.paymentMode,
            inspectionFeeCents: Number.isInteger(paymentOption.inspectionFeeCents)
              ? paymentOption.inspectionFeeCents
              : item.inspectionFeeCents,
            fulfillmentTypes,
            requiresAppointment: Boolean(option.requiresAppointment),
            fulfillmentType: itemType === 'service' ? getDefaultFulfillmentType(fulfillmentTypes) : 'store',
            canChooseFulfillment: fulfillmentTypes.includes('store') && fulfillmentTypes.includes('delivery')
          })
          return { ...normalizedItem, displayItems: [normalizedItem] }
        })
        const physicalItems = classifiedItems.filter((item) => item.itemType === 'physical')
        const serviceItems = classifiedItems.filter((item) => item.itemType === 'service')
        const groups = getCheckoutGroups(serviceItems, physicalItems)
        this.setData({
          items: classifiedItems,
          physicalItems,
          serviceItems,
          hasPhysicalItems: physicalItems.length > 0,
          hasServiceItems: serviceItems.length > 0,
          hasDeliveryCapableItems: serviceItems.some((item) => item.fulfillmentTypes.includes('delivery')),
          ...getOnlinePaymentSummary(classifiedItems),
          ...groups
        })
      })
      .catch((err) => {
        console.warn('读取办理方式失败:', err)
        this.setData({
          pageStatus: 'error',
          pageMessage: err.message || '商品办理方式加载失败，请稍后重试'
        })
        throw err
      })
  },
  selectFulfillment(e) {
    const itemKey = e.currentTarget.dataset.key
    const fulfillmentType = e.currentTarget.dataset.type
    const serviceItems = this.data.serviceItems.map((item) => {
      if (item.key !== itemKey || !item.fulfillmentTypes.includes(fulfillmentType)) return item
      return { ...item, fulfillmentType }
    })
    const items = this.data.items.map((item) => {
      const serviceItem = serviceItems.find((candidate) => candidate.key === item.key)
      return serviceItem || item
    })
    this.setData({
      items,
      serviceItems,
      ...getCheckoutGroups(serviceItems, this.data.physicalItems)
    })
  },
  handleAppointmentDateChange(e) {
    this.setData({ appointmentDate: e.detail.value })
  },
  handleAppointmentTimeChange(e) {
    this.setData({ appointmentTime: e.detail.value })
  },
  callMerchant() {
    wx.makePhoneCall({ phoneNumber: MERCHANT_PHONE })
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
    if (this.data.hasDeliveryItems && contact.address.length < 5) return '请填写详细地址'
    if (this.data.hasAppointmentItems) {
      const appointmentAt = getAppointmentTimestamp(this.data.appointmentDate, this.data.appointmentTime)
      if (!Number.isFinite(appointmentAt)) return '请选择上门日期和时间'
      if (appointmentAt <= Date.now()) return '请选择晚于当前时间的上门时间'
    }
    return ''
  },
  openCreatedOrders(result) {
    const orders = Array.isArray(result.orders) ? result.orders : []
    const url = orders.length === 1
      ? `/pages/order-detail/order-detail?id=${orders[0].orderId}`
      : '/pages/orders/orders'
    wx.redirectTo({ url })
  },
  showAppointmentConfirmation(result) {
    wx.showModal({
      title: '预约已提交',
      content: `请拨打商家电话 ${MERCHANT_PHONE}，确认上门时间。`,
      confirmText: '拨打电话',
      cancelText: '查看订单',
      success: (modalResult) => {
        if (!modalResult.confirm) {
          this.openCreatedOrders(result)
          return
        }
        wx.makePhoneCall({
          phoneNumber: MERCHANT_PHONE,
          complete: () => this.openCreatedOrders(result)
        })
      },
      fail: () => this.openCreatedOrders(result)
    })
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
      quantity: item.quantity,
      fulfillmentType: item.fulfillmentType || 'store'
    }))

    callOrderService('createOrders', {
      items,
      contact,
      appointment: this.data.hasAppointmentItems
        ? { date: this.data.appointmentDate, time: this.data.appointmentTime }
        : null,
      note: this.data.note.trim()
    }).then((result) => {
      if (this.checkoutMode === 'buyNow') {
        clearBuyNowItem()
      } else {
        removeCartItems(this.data.selectedKeys)
      }
      if (this.data.hasDeliveryItems) {
        this.showAppointmentConfirmation(result)
        return
      }
      wx.showToast({ title: '订单已提交', icon: 'success' })
      setTimeout(() => this.openCreatedOrders(result), 500)
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
  },
  handleStatusAction() {
    if (this.data.pageStatus === 'loginRequired') {
      openLogin()
      return
    }
    if (this.data.pageStatus === 'empty') {
      this.goShopping()
      return
    }
    this.onLoad()
  }
})
