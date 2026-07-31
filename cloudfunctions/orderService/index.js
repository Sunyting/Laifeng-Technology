const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const command = db.command
const MAX_APPOINTMENT_DAYS = 90

class BusinessError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const success = (data) => ({ success: true, data })
const failure = (code, message) => ({ success: false, code, message })

const normalizeText = (value, maxLength) => String(value || '').trim().slice(0, maxLength)

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
  const itemOptions = products.map((product) => {
    if (!product || product.status !== '1') throw new BusinessError('PRODUCT_UNAVAILABLE', '部分商品已下架，请返回购物车重新选择')
    return { productId: product._id, ...getProductBusinessConfig(product) }
  })
  const onsiteProductIds = itemOptions
    .filter((option) => option.fulfillmentTypes.includes('delivery'))
    .map((option) => option.productId)
  return success({ itemOptions, onsiteProductIds })
}

const createOrders = async (event, openid, splitOrders) => {
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
      const totalQuantity = orderItems.reduce((sum, item) => sum + item.quantity, 0)
      const amountType = orderItems.some((item) => item.priceType === 'starting' || item.priceRemark)
        ? 'estimated'
        : 'fixed'
      const order = {
        orderNo,
        userId: openid,
        items: orderItems,
        totalQuantity,
        totalAmount: totalAmountCents / 100,
        amountType,
        orderType: group.orderType,
        fulfillmentType: group.fulfillmentType,
        contact: {
          ...payload.contact,
          address: group.fulfillmentType === 'delivery' ? payload.contact.address : ''
        },
        appointment: group.fulfillmentType === 'delivery' ? appointment : null,
        note: payload.note,
        paymentStatus: 'unpaid',
        status: 'pending_confirmation',
        statusHistory: [{ status: 'pending_confirmation', createdAt: now }],
        createdAt: now,
        updatedAt: now
      }
      await transaction.collection('orders').doc(orderNo).set({ data: order })
      createdOrders.push({
        orderId: orderNo,
        orderNo,
        orderType: group.orderType,
        fulfillmentType: group.fulfillmentType
      })
    }

    const profileRef = transaction.collection('users').doc(openid)
    const profileUpdate = {
      name: payload.contact.name,
      phone: payload.contact.phone,
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
  try {
    const result = await db.collection('users').doc(openid).get()
    const profile = result.data || {}
    return success({
      nickName: profile.nickName || '',
      avatarUrl: profile.avatarUrl || '',
      name: profile.name || '',
      phone: profile.phone || '',
      address: profile.address || ''
    })
  } catch (err) {
    return success(null)
  }
}

const updateProfile = async (event, openid) => {
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
  const profileRef = db.collection('users').doc(openid)
  try {
    await profileRef.get()
    await profileRef.update({ data: { ...profile, updatedAt: now } })
  } catch (err) {
    await profileRef.set({
      data: { ...profile, createdAt: now, updatedAt: now }
    })
  }
  return success(profile)
}

const listOrders = async (openid) => {
  const result = await db.collection('orders')
    .where({ userId: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
  return success(result.data.map(sanitizeOrder))
}

const getOrder = async (event, openid) => {
  const orderId = normalizeText(event.orderId, 64)
  if (!orderId) throw new BusinessError('INVALID_ORDER', '订单参数无效')
  const result = await db.collection('orders').doc(orderId).get()
  if (!result.data || result.data.userId !== openid) {
    throw new BusinessError('ORDER_NOT_FOUND', '订单不存在或无权查看')
  }
  return success(sanitizeOrder(result.data))
}

exports.main = async (event = {}) => {
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
      default:
        return failure('INVALID_ACTION', '不支持的订单操作')
    }
  } catch (err) {
    console.error('orderService failed:', err)
    if (err instanceof BusinessError) return failure(err.code, err.message)
    return failure('INTERNAL_ERROR', '订单服务暂不可用，请稍后重试')
  }
}
