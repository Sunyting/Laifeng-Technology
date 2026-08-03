const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const command = db.command
const MAX_APPOINTMENT_DAYS = 90
const PAYMENT_TIMEOUT_MS = 30 * 60 * 1000
const EXPIRY_BATCH_LIMIT = 100
const PRIVACY_CONSENT_VERSION = '2026-08-03'

class BusinessError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const success = (data) => ({ success: true, data })
const failure = (code, message) => ({ success: false, code, message })

const normalizeText = (value, maxLength) => String(value || '').trim().slice(0, maxLength)

const requirePrivacyConsent = (event) => {
  if (event.privacyConsent !== true) {
    throw new BusinessError('PRIVACY_CONSENT_REQUIRED', '请先阅读并同意用户服务协议和隐私政策')
  }
}

const validateItems = (rawItems) => {
  const items = Array.isArray(rawItems) ? rawItems : []
  if (!items.length || items.length > 50) {
    throw new BusinessError('INVALID_ITEMS', '请选择需要结算的商品')
  }

  const seenKeys = new Set()
  return items.map((item) => {
    const productId = normalizeText(item.productId, 64)
    const skuId = normalizeText(item.skuId, 80)
    const quantity = Number(item.quantity)
    const fulfillmentType = ['store', 'delivery'].includes(item.fulfillmentType) ? item.fulfillmentType : ''
    const key = `${productId}::${skuId}`
    if (!productId || !skuId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || seenKeys.has(key)) {
      throw new BusinessError('INVALID_ITEMS', '商品信息已失效，请返回购物车重新选择')
    }
    seenKeys.add(key)
    return { productId, skuId, quantity, fulfillmentType }
  })
}

const formatSpecText = (specs = {}) => Object.keys(specs)
  .map((key) => `${key}：${specs[key]}`)
  .join('；')

const createOrderNo = () => {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `LFT${timestamp}${Math.floor(1000 + Math.random() * 9000)}`
}

const validateAppointment = (rawAppointment) => {
  const date = normalizeText(rawAppointment && rawAppointment.date, 10)
  const time = normalizeText(rawAppointment && rawAppointment.time, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new BusinessError('INVALID_APPOINTMENT', '请选择上门日期和时间')
  }

  const [year, month, day] = date.split('-').map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new BusinessError('INVALID_APPOINTMENT', '请选择正确的上门日期')
  }

  const scheduledAt = Date.parse(`${date}T${time}:00+08:00`)
  const maxScheduledAt = Date.now() + MAX_APPOINTMENT_DAYS * 24 * 60 * 60 * 1000
  if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
    throw new BusinessError('INVALID_APPOINTMENT', '请选择晚于当前时间的上门时间')
  }
  if (scheduledAt > maxScheduledAt) {
    throw new BusinessError('INVALID_APPOINTMENT', `仅支持预约未来${MAX_APPOINTMENT_DAYS}天内的上门服务`)
  }

  return { date, time, scheduledAt }
}

const sanitizeOrder = (order = {}) => {
  const { userId, ...visibleOrder } = order
  return visibleOrder
}

const isUnpaidOrder = (order = {}) => ['unpaid', 'paying'].includes(order.paymentStatus)

const isExpiredOrder = (order = {}, now = Date.now()) => {
  const deadline = Number(order.paymentDeadlineAt) || (Number(order.createdAt) + PAYMENT_TIMEOUT_MS)
  return isUnpaidOrder(order) && order.status !== 'cancelled' && Number.isFinite(deadline) && deadline <= now
}

const restoreOrderStock = async (transaction, order) => {
  const groupedItems = (Array.isArray(order.items) ? order.items : []).reduce((groups, item) => {
    if (!item || !item.productId || !item.skuId) return groups
    if (!groups[item.productId]) groups[item.productId] = {}
    groups[item.productId][item.skuId] = (groups[item.productId][item.skuId] || 0) + Math.max(0, Number(item.quantity) || 0)
    return groups
  }, {})

  for (const [productId, skuQuantities] of Object.entries(groupedItems)) {
    const productResult = await transaction.collection('goods').doc(productId).get()
    const product = productResult.data
    if (!product) throw new BusinessError('STOCK_RESTORE_FAILED', '商品库存恢复失败，请联系门店')
    if (product.inventoryType !== 'finite') continue

    const skuList = Array.isArray(product.SKUlist) ? product.SKUlist : []
    const stockUpdates = {}
    for (const [skuId, quantity] of Object.entries(skuQuantities)) {
      const skuIndex = skuList.findIndex((sku) => sku.id === skuId)
      if (skuIndex < 0) throw new BusinessError('STOCK_RESTORE_FAILED', '商品规格库存恢复失败，请联系门店')
      stockUpdates[`SKUlist.${skuIndex}.stock`] = command.inc(quantity)
    }
    if (Object.keys(stockUpdates).length) {
      await transaction.collection('goods').doc(productId).update({ data: stockUpdates })
    }
  }
}

const cancelOrderById = async (orderId, openid = '', reason = 'payment_timeout', markDeleted = false) => {
  return db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection('orders').doc(orderId)
    const result = await orderRef.get()
    const order = result.data
    if (!order) throw new BusinessError('ORDER_NOT_FOUND', '订单不存在')
    if (openid && order.userId !== openid) throw new BusinessError('ORDER_NOT_FOUND', '订单不存在或无权操作')
    if (order.userDeletedAt && !markDeleted) return order

    const requiresRetention = ['paid', 'refunding'].includes(order.paymentStatus)
    const canCancel = isUnpaidOrder(order) && order.status !== 'cancelled' && order.status !== 'completed'
    if (reason === 'user_cancelled' && !canCancel) {
      throw new BusinessError('ORDER_CANCEL_FORBIDDEN', '只有未支付订单可以取消')
    }
    if (markDeleted && requiresRetention && !['cancelled', 'completed'].includes(order.status)) {
      throw new BusinessError('ORDER_DELETE_FORBIDDEN', '已支付订单需保留至商家处理完成')
    }

    const now = Date.now()
    const update = { updatedAt: now }
    if (canCancel) {
      await restoreOrderStock(transaction, order)
      if (order.currentPaymentId) {
        const paymentRef = transaction.collection('payments').doc(order.currentPaymentId)
        const paymentResult = await paymentRef.get()
        if (paymentResult.data && paymentResult.data.status === 'pending') {
          await paymentRef.update({ data: { status: 'closed', updatedAt: now } })
        }
      }
      update.status = 'cancelled'
      update.paymentStatus = isUnpaidOrder(order) ? 'closed' : order.paymentStatus
      update.currentPaymentId = null
      update.paymentDeadlineAt = null
      update.cancelledAt = now
      update.cancellationReason = reason
      update.statusHistory = command.push({ status: 'cancelled', createdAt: now, reason })
    }
    if (markDeleted) update.userDeletedAt = now
    await orderRef.update({ data: update })
    return { ...order, ...update }
  })
}

const migrateLegacyPendingPayment = async (order) => {
  const legacyUnpaid = order && !['paid', 'refunding', 'refunded'].includes(order.paymentStatus) && !order.paidAt
  if (!order || order.status !== 'pending_confirmation' || !legacyUnpaid) return order
  const now = Date.now()
  const deadline = Number(order.paymentDeadlineAt) || (Number(order.createdAt) + PAYMENT_TIMEOUT_MS)
  const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : []
  await db.collection('orders').doc(order._id).update({
    data: {
      status: 'pending_payment',
      paymentStatus: order.paymentStatus || 'unpaid',
      paymentDeadlineAt: deadline,
      statusHistory: command.push({ status: 'pending_payment', createdAt: now, reason: 'legacy_migration' }),
      updatedAt: now
    }
  })
  return { ...order, status: 'pending_payment', paymentStatus: order.paymentStatus || 'unpaid', paymentDeadlineAt: deadline, statusHistory }
}

const cancelExpiredOrdersForUser = async (openid) => {
  const now = Date.now()
  const result = await db.collection('orders')
    .where({ userId: openid })
    .limit(EXPIRY_BATCH_LIMIT)
    .get()
  for (const rawOrder of result.data || []) {
    const order = await migrateLegacyPendingPayment(rawOrder)
    if (!isExpiredOrder(order, now)) continue
    try {
      await cancelOrderById(order._id, openid, 'payment_timeout')
    } catch (err) {
      console.error('自动取消订单失败:', order._id, err)
    }
  }
}

const cancelExpiredOrders = async () => {
  const now = Date.now()
  const result = await db.collection('orders')
    .limit(EXPIRY_BATCH_LIMIT)
    .get()
  let cancelledCount = 0
  for (const rawOrder of result.data || []) {
    const order = await migrateLegacyPendingPayment(rawOrder)
    if (!isExpiredOrder(order, now)) continue
    try {
      await cancelOrderById(order._id, '', 'payment_timeout')
      cancelledCount += 1
    } catch (err) {
      console.error('定时取消订单失败:', order._id, err)
    }
  }
  return { cancelledCount }
}

const getUserProfile = async (openid) => {
  try {
    const result = await db.collection('users').doc(openid).get()
    return result.data || null
  } catch (err) {
    return null
  }
}

const requireLoggedInProfile = async (openid) => {
  const profile = await getUserProfile(openid)
  if (!profile || !normalizeText(profile.nickName, 30) || !normalizeText(profile.avatarUrl, 500)) {
    throw new BusinessError('LOGIN_REQUIRED', '请先完善微信头像和昵称')
  }
  return profile
}

const validateCreatePayload = (event) => {
  const items = validateItems(event.items)

  const contact = {
    name: normalizeText(event.contact && event.contact.name, 30),
    phone: normalizeText(event.contact && event.contact.phone, 20),
    address: normalizeText(event.contact && event.contact.address, 120)
  }
  if (contact.name.length < 2) throw new BusinessError('INVALID_CONTACT', '请填写联系人姓名')
  if (!/^1\d{10}$/.test(contact.phone)) throw new BusinessError('INVALID_CONTACT', '请填写正确的手机号码')

  const legacyFulfillmentType = (event.onsiteFulfillmentType || event.fulfillmentType) === 'delivery'
    ? 'delivery'
    : 'store'

  return {
    items,
    contact,
    legacyFulfillmentType,
    rawAppointment: event.appointment,
    note: normalizeText(event.note, 200)
  }
}

const getProductBusinessConfig = (product) => {
  const itemType = product && product.itemType
  const fulfillmentTypes = [...new Set(Array.isArray(product && product.fulfillmentTypes)
    ? product.fulfillmentTypes.filter((type) => type === 'store' || type === 'delivery')
    : [])]
  const inventoryType = product && product.inventoryType
  if (!['physical', 'service'].includes(itemType) || !fulfillmentTypes.length || !['finite', 'unlimited'].includes(inventoryType)) {
    throw new BusinessError('INVALID_PRODUCT_CONFIG', `${product && product.name ? product.name : '商品'}的业务配置不完整，请联系门店`)
  }
  if (itemType === 'physical' && (fulfillmentTypes.length !== 1 || fulfillmentTypes[0] !== 'store' || inventoryType !== 'finite')) {
    throw new BusinessError('INVALID_PRODUCT_CONFIG', `${product.name}的实体商品配置异常，请联系门店`)
  }
  return {
    itemType,
    fulfillmentTypes,
    requiresAppointment: Boolean(product.requiresAppointment),
    inventoryType
  }
}

const getSkuPaymentConfig = (sku, productConfig, unitPriceCents, productName) => {
  const configuredPaymentMode = normalizeText(sku.paymentMode, 30)
  if (configuredPaymentMode && !['full', 'inspection_fee'].includes(configuredPaymentMode)) {
    throw new BusinessError('INVALID_PRODUCT_CONFIG', `${productName}的付款方式配置异常，请联系门店`)
  }
  const paymentMode = configuredPaymentMode || (
    productConfig.itemType === 'service' && sku.priceType === 'starting'
      ? 'inspection_fee'
      : 'full'
  )
  if (paymentMode === 'full') {
    return { paymentMode, inspectionFeeCents: 0, onlineUnitAmountCents: unitPriceCents }
  }

  const configuredInspectionFeeCents = Number(sku.inspectionFeeCents)
  const hasConfiguredInspectionFee = sku.inspectionFeeCents !== undefined && sku.inspectionFeeCents !== null
  if (hasConfiguredInspectionFee && (!Number.isInteger(configuredInspectionFeeCents) || configuredInspectionFeeCents < 1)) {
    throw new BusinessError('INVALID_PRODUCT_CONFIG', `${productName}的检查费配置异常，请联系门店`)
  }
  const inspectionFeeCents = hasConfiguredInspectionFee ? configuredInspectionFeeCents : unitPriceCents
  if (inspectionFeeCents < 1) {
    throw new BusinessError('INVALID_PRICE', `${productName}的检查费不能低于0.01元`)
  }
  return { paymentMode, inspectionFeeCents, onlineUnitAmountCents: inspectionFeeCents }
}

const buildOrderGroups = (itemSnapshots) => {
  const orderGroupMap = itemSnapshots.reduce((groups, snapshot) => {
    const key = `${snapshot.itemType}:${snapshot.fulfillmentType}`
    if (!groups[key]) {
      groups[key] = {
        snapshots: [],
        orderType: snapshot.itemType,
        fulfillmentType: snapshot.fulfillmentType
      }
    }
    groups[key].snapshots.push(snapshot)
    return groups
  }, {})
  return Object.values(orderGroupMap)
}

const getCheckoutOptions = async (event) => {
  const items = validateItems(event.items)
  const productIds = [...new Set(items.map((item) => item.productId))]
  const products = await Promise.all(productIds.map(async (productId) => {
    const result = await db.collection('goods').doc(productId).get()
    return result.data
  }))
  const productMap = new Map(products.map((product) => [product && product._id, product]))
  const itemOptions = products.map((product) => {
    if (!product || product.status !== '1') throw new BusinessError('PRODUCT_UNAVAILABLE', '部分商品已下架，请返回购物车重新选择')
    return { productId: product._id, ...getProductBusinessConfig(product) }
  })
  const itemPaymentOptions = items.map((item) => {
    const product = productMap.get(item.productId)
    const productConfig = getProductBusinessConfig(product)
    const sku = (Array.isArray(product.SKUlist) ? product.SKUlist : []).find((candidate) => candidate.id === item.skuId)
    const unitPrice = Number(sku && sku.prices)
    if (!sku || sku.status !== '1') throw new BusinessError('SKU_UNAVAILABLE', `${product.name}的所选规格已下架`)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new BusinessError('INVALID_PRICE', `${product.name}价格异常，请联系门店`)
    }
    const unitPriceCents = Math.round(unitPrice * 100)
    return {
      key: `${item.productId}::${item.skuId}`,
      unitPriceCents,
      ...getSkuPaymentConfig(sku, productConfig, unitPriceCents, product.name)
    }
  })
  const onsiteProductIds = itemOptions
    .filter((option) => option.fulfillmentTypes.includes('delivery'))
    .map((option) => option.productId)
  return success({ itemOptions, itemPaymentOptions, onsiteProductIds })
}

const createOrders = async (event, openid, splitOrders) => {
  await requireLoggedInProfile(openid)
  requirePrivacyConsent(event)
  const payload = validateCreatePayload(event)
  const groupedItems = payload.items.reduce((groups, item) => {
    if (!groups[item.productId]) groups[item.productId] = []
    groups[item.productId].push(item)
    return groups
  }, {})

  return db.runTransaction(async (transaction) => {
    const itemSnapshots = []

    for (const [productId, selectedItems] of Object.entries(groupedItems)) {
      const productResult = await transaction.collection('goods').doc(productId).get()
      const product = productResult.data
      if (!product || product.status !== '1') {
        throw new BusinessError('PRODUCT_UNAVAILABLE', '部分商品已下架，请返回购物车重新选择')
      }
      const productConfig = getProductBusinessConfig(product)

      const skuList = Array.isArray(product.SKUlist) ? product.SKUlist : []
      const stockUpdates = {}
      selectedItems.forEach((selectedItem) => {
        const skuIndex = skuList.findIndex((sku) => sku.id === selectedItem.skuId)
        const sku = skuList[skuIndex]
        if (!sku || sku.status !== '1') {
          throw new BusinessError('SKU_UNAVAILABLE', `${product.name}的所选规格已下架`)
        }
        const stock = Number(sku.stock)
        const unitPrice = Number(sku.prices)
        if (productConfig.inventoryType === 'finite' && (!Number.isFinite(stock) || stock < selectedItem.quantity)) {
          throw new BusinessError('INSUFFICIENT_STOCK', `${product.name}库存不足`)
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new BusinessError('INVALID_PRICE', `${product.name}价格异常，请联系门店`)
        }

        const unitPriceCents = Math.round(unitPrice * 100)
        const subtotalCents = unitPriceCents * selectedItem.quantity
        const paymentConfig = getSkuPaymentConfig(sku, productConfig, unitPriceCents, product.name)
        const onlineSubtotalCents = paymentConfig.onlineUnitAmountCents * selectedItem.quantity
        const requestedFulfillmentType = selectedItem.fulfillmentType || (productConfig.fulfillmentTypes.length === 1
          ? productConfig.fulfillmentTypes[0]
          : payload.legacyFulfillmentType)
        if (!productConfig.fulfillmentTypes.includes(requestedFulfillmentType)) {
          throw new BusinessError('INVALID_FULFILLMENT', `${product.name}不支持所选办理方式`)
        }
        if (productConfig.inventoryType === 'finite') {
          stockUpdates[`SKUlist.${skuIndex}.stock`] = command.inc(-selectedItem.quantity)
        }
        itemSnapshots.push({
          itemType: productConfig.itemType,
          fulfillmentType: requestedFulfillmentType,
          requiresAppointment: productConfig.requiresAppointment,
          item: {
            key: `${productId}::${sku.id}`,
            productId,
            skuId: sku.id,
            name: product.name,
            image: sku.image || product.image || '',
            specs: sku.specs || {},
            specText: formatSpecText(sku.specs),
            unitPrice: unitPriceCents / 100,
            subtotal: subtotalCents / 100,
            quantity: selectedItem.quantity,
            itemType: productConfig.itemType,
            fulfillmentType: requestedFulfillmentType,
            priceType: sku.priceType || 'fixed',
            paymentMode: paymentConfig.paymentMode,
            inspectionFeeCents: paymentConfig.inspectionFeeCents,
            onlineUnitAmountCents: paymentConfig.onlineUnitAmountCents,
            onlineSubtotalCents,
            unit: sku.unit || '',
            priceRemark: sku.priceRemark || ''
          }
        })
      })

      if (Object.keys(stockUpdates).length) {
        await transaction.collection('goods').doc(productId).update({ data: stockUpdates })
      }
    }

    const hasDeliveryItems = itemSnapshots.some((snapshot) => snapshot.fulfillmentType === 'delivery')
    if (hasDeliveryItems && payload.contact.address.length < 5) {
      throw new BusinessError('INVALID_CONTACT', '请填写详细地址')
    }
    const needsAppointment = itemSnapshots.some((snapshot) => {
      return snapshot.fulfillmentType === 'delivery' && snapshot.requiresAppointment
    })
    const appointment = needsAppointment ? validateAppointment(payload.rawAppointment) : null
    const orderGroups = buildOrderGroups(itemSnapshots)
    if (!splitOrders && orderGroups.length > 1) {
      throw new BusinessError('INVALID_ITEMS', '混合商品需要拆分提交，请返回购物车重新结算')
    }

    const now = Date.now()
    const usedOrderNos = new Set()
    const createdOrders = []
    for (const group of orderGroups) {
      let orderNo = createOrderNo()
      while (usedOrderNos.has(orderNo)) orderNo = createOrderNo()
      usedOrderNos.add(orderNo)

      const orderItems = group.snapshots.map((snapshot) => snapshot.item)
      const totalAmountCents = orderItems.reduce((sum, item) => sum + Math.round(item.subtotal * 100), 0)
      const onlinePayableAmountCents = orderItems.reduce((sum, item) => sum + item.onlineSubtotalCents, 0)
      const inspectionFeeCents = orderItems.reduce((sum, item) => {
        return sum + (item.paymentMode === 'inspection_fee' ? item.onlineSubtotalCents : 0)
      }, 0)
      const totalQuantity = orderItems.reduce((sum, item) => sum + item.quantity, 0)
      const inspectionItemCount = orderItems.filter((item) => item.paymentMode === 'inspection_fee').length
      const amountType = inspectionItemCount > 0 ? 'estimated' : 'fixed'
      const onlinePaymentType = inspectionItemCount === orderItems.length
        ? 'inspection_fee'
        : (inspectionItemCount > 0 ? 'mixed' : 'full')
      const order = {
        orderNo,
        userId: openid,
        items: orderItems,
        totalQuantity,
        totalAmount: totalAmountCents / 100,
        amountType,
        onlinePaymentType,
        onlinePayableAmountCents,
        inspectionFeeCents,
        paidAmountCents: 0,
        currentPaymentId: null,
        paymentExpiresAt: null,
        paymentDeadlineAt: now + PAYMENT_TIMEOUT_MS,
        paidAt: null,
        quoteStatus: amountType === 'estimated' ? 'pending' : 'not_required',
        finalQuoteAmountCents: null,
        offlineAmountCents: null,
        offlinePaymentStatus: amountType === 'estimated' ? 'pending' : 'not_required',
        orderType: group.orderType,
        fulfillmentType: group.fulfillmentType,
        contact: {
          ...payload.contact,
          address: group.fulfillmentType === 'delivery' ? payload.contact.address : ''
        },
        appointment: group.fulfillmentType === 'delivery' ? appointment : null,
        note: payload.note,
        paymentStatus: 'unpaid',
        status: 'pending_payment',
        statusHistory: [{ status: 'pending_payment', createdAt: now }],
        createdAt: now,
        updatedAt: now
      }
      await transaction.collection('orders').doc(orderNo).set({ data: order })
      createdOrders.push({
        orderId: orderNo,
        orderNo,
        orderType: group.orderType,
        fulfillmentType: group.fulfillmentType,
        onlinePayableAmountCents
      })
    }

    const profileRef = transaction.collection('users').doc(openid)
    const profileUpdate = {
      name: payload.contact.name,
      phone: payload.contact.phone,
      privacyConsentVersion: PRIVACY_CONSENT_VERSION,
      privacyConsentedAt: now,
      updatedAt: now
    }
    if (orderGroups.some((group) => group.fulfillmentType === 'delivery')) {
      profileUpdate.address = payload.contact.address
    }
    try {
      await profileRef.get()
      await profileRef.update({
        data: profileUpdate
      })
    } catch (err) {
      await profileRef.set({
        data: {
          name: payload.contact.name,
          phone: payload.contact.phone,
          address: payload.contact.address,
          privacyConsentVersion: PRIVACY_CONSENT_VERSION,
          privacyConsentedAt: now,
          createdAt: now,
          updatedAt: now
        }
      })
    }

    return success({
      orders: createdOrders,
      orderIds: createdOrders.map((order) => order.orderId),
      orderId: createdOrders.length === 1 ? createdOrders[0].orderId : ''
    })
  })
}

const getProfile = async (openid) => {
  const profile = await getUserProfile(openid) || {}
  return success({
    userId: openid,
    nickName: profile.nickName || '',
    avatarUrl: profile.avatarUrl || '',
    name: profile.name || '',
    phone: profile.phone || '',
    address: profile.address || '',
    privacyConsentVersion: profile.privacyConsentVersion || '',
    privacyConsentedAt: profile.privacyConsentedAt || null
  })
}

const updateProfile = async (event, openid) => {
  requirePrivacyConsent(event)
  const profile = {
    nickName: normalizeText(event.profile && event.profile.nickName, 30),
    avatarUrl: normalizeText(event.profile && event.profile.avatarUrl, 500),
    name: normalizeText(event.profile && event.profile.name, 30),
    phone: normalizeText(event.profile && event.profile.phone, 20),
    address: normalizeText(event.profile && event.profile.address, 120)
  }
  if (profile.phone && !/^1\d{10}$/.test(profile.phone)) {
    throw new BusinessError('INVALID_PROFILE', '请填写正确的手机号码')
  }
  if (profile.address && profile.address.length < 5) {
    throw new BusinessError('INVALID_PROFILE', '请填写详细地址')
  }
  if (profile.avatarUrl && !profile.avatarUrl.startsWith('cloud://')) {
    throw new BusinessError('INVALID_PROFILE', '头像地址无效，请重新选择')
  }

  const now = Date.now()
  const privacyConsent = {
    privacyConsentVersion: PRIVACY_CONSENT_VERSION,
    privacyConsentedAt: now
  }
  const profileRef = db.collection('users').doc(openid)
  try {
    await profileRef.get()
    await profileRef.update({ data: { ...profile, ...privacyConsent, updatedAt: now } })
  } catch (err) {
    await profileRef.set({
      data: { ...profile, ...privacyConsent, createdAt: now, updatedAt: now }
    })
  }
  return success({ userId: openid, ...profile, ...privacyConsent })
}

const listOrders = async (openid) => {
  await requireLoggedInProfile(openid)
  await cancelExpiredOrdersForUser(openid)
  const result = await db.collection('orders')
    .where({ userId: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
  return success(result.data.filter((order) => !order.userDeletedAt).map(sanitizeOrder))
}

const getOrder = async (event, openid) => {
  await requireLoggedInProfile(openid)
  let orderId = normalizeText(event.orderId, 64)
  const paymentId = normalizeText(event.paymentId, 64)
  if (!orderId && paymentId) {
    const paymentResult = await db.collection('payments').doc(paymentId).get()
    const payment = paymentResult.data
    if (!payment || payment.userId !== openid) {
      throw new BusinessError('ORDER_NOT_FOUND', '订单不存在或无权查看')
    }
    orderId = normalizeText(payment.orderId, 64)
  }
  if (!orderId) throw new BusinessError('INVALID_ORDER', '订单参数无效')
  let result = await db.collection('orders').doc(orderId).get()
  if (!result.data || result.data.userId !== openid) {
    throw new BusinessError('ORDER_NOT_FOUND', '订单不存在或无权查看')
  }
  result.data = await migrateLegacyPendingPayment(result.data)
  if (isExpiredOrder(result.data)) {
    await cancelOrderById(orderId, openid, 'payment_timeout')
    result = await db.collection('orders').doc(orderId).get()
  }
  if (result.data.userDeletedAt) throw new BusinessError('ORDER_NOT_FOUND', '订单不存在或已删除')
  return success(sanitizeOrder(result.data))
}

const deleteOrder = async (event, openid) => {
  await requireLoggedInProfile(openid)
  const orderId = normalizeText(event.orderId, 64)
  if (!orderId) throw new BusinessError('INVALID_ORDER', '订单参数无效')
  const existing = await db.collection('orders').doc(orderId).get()
  if (!existing.data || existing.data.userId !== openid) {
    throw new BusinessError('ORDER_NOT_FOUND', '订单不存在或无权操作')
  }
  if (!['cancelled', 'completed'].includes(existing.data.status)) {
    throw new BusinessError('ORDER_DELETE_FORBIDDEN', '只有已完成或已取消的订单可以删除')
  }
  const order = await cancelOrderById(orderId, openid, 'user_deleted', true)
  return success({ orderId, deletedAt: order.userDeletedAt || Date.now() })
}

const cancelUserOrder = async (event, openid) => {
  await requireLoggedInProfile(openid)
  const orderId = normalizeText(event.orderId, 64)
  if (!orderId) throw new BusinessError('INVALID_ORDER', '订单参数无效')
  const order = await cancelOrderById(orderId, openid, 'user_cancelled')
  return success(sanitizeOrder(order))
}

const requestRefund = async (event, openid) => {
  await requireLoggedInProfile(openid)
  const orderId = normalizeText(event.orderId, 64)
  if (!orderId) throw new BusinessError('INVALID_ORDER', '订单参数无效')
  const now = Date.now()
  return db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection('orders').doc(orderId)
    const result = await orderRef.get()
    const order = result.data
    if (!order || order.userId !== openid) throw new BusinessError('ORDER_NOT_FOUND', '订单不存在或无权操作')
    if (order.paymentStatus !== 'paid') throw new BusinessError('REFUND_NOT_ALLOWED', '只有已支付订单可以申请退款')
    if (order.refundRequestStatus === 'requested' || order.paymentStatus === 'refunding') {
      throw new BusinessError('REFUND_ALREADY_REQUESTED', '退款申请已提交，请等待商家处理')
    }
    const update = {
      refundRequestStatus: 'requested',
      refundRequestedAt: now,
      updatedAt: now,
      statusHistory: command.push({ status: 'refund_requested', createdAt: now })
    }
    await orderRef.update({ data: update })
    return success({ orderId, refundRequestStatus: 'requested', refundRequestedAt: now })
  })
}

exports.main = async (event = {}) => {
  if (event.Type === 'Timer' || event.type === 'timer') {
    try {
      return success(await cancelExpiredOrders())
    } catch (err) {
      console.error('定时取消订单失败:', err)
      return failure('INTERNAL_ERROR', '订单自动取消失败')
    }
  }
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return failure('UNAUTHORIZED', '无法识别当前用户，请重新打开小程序')

  try {
    switch (event.action) {
      case 'createOrder':
        return await createOrders(event, OPENID, false)
      case 'createOrders':
        return await createOrders(event, OPENID, true)
      case 'getProfile':
        return await getProfile(OPENID)
      case 'updateProfile':
        return await updateProfile(event, OPENID)
      case 'getCheckoutOptions':
        return await getCheckoutOptions(event)
      case 'listOrders':
        return await listOrders(OPENID)
      case 'getOrder':
        return await getOrder(event, OPENID)
      case 'deleteOrder':
        return await deleteOrder(event, OPENID)
      case 'cancelOrder':
        return await cancelUserOrder(event, OPENID)
      case 'requestRefund':
        return await requestRefund(event, OPENID)
      default:
        return failure('INVALID_ACTION', '不支持的订单操作')
    }
  } catch (err) {
    console.error('orderService failed:', err)
    if (err instanceof BusinessError) return failure(err.code, err.message)
    return failure('INTERNAL_ERROR', '订单服务暂不可用，请稍后重试')
  }
}
