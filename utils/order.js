const ORDER_STATUS_LABELS = {
  pending_confirmation: '待商家确认',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消'
}

const formatMoney = (value) => (Number(value) || 0).toFixed(2)

const padNumber = (value) => String(value).padStart(2, '0')

const formatOrderTime = (value) => {
  const date = new Date(Number(value))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`
}

const formatOrderItem = (item = {}) => ({
  ...item,
  unitPriceText: formatMoney(item.unitPrice),
  subtotalText: formatMoney(item.subtotal)
})

const formatOrder = (order = {}) => ({
  ...order,
  items: Array.isArray(order.items) ? order.items.map(formatOrderItem) : [],
  statusLabel: ORDER_STATUS_LABELS[order.status] || '处理中',
  totalAmountText: formatMoney(order.totalAmount),
  createdAtText: formatOrderTime(order.createdAt),
  fulfillmentLabel: order.fulfillmentType === 'delivery' ? '上门服务' : '到店办理'
})

const callOrderService = (action, data = {}) => wx.cloud.callFunction({
  name: 'orderService',
  data: { action, ...data }
}).then((res) => {
  const result = res.result || {}
  if (!result.success) {
    const error = new Error(result.message || '订单服务暂不可用')
    error.code = result.code || 'ORDER_SERVICE_ERROR'
    throw error
  }
  return result.data
})

module.exports = {
  callOrderService,
  formatMoney,
  formatOrder,
  formatOrderItem,
  formatOrderTime
}
