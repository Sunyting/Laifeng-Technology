const ORDER_STATUS_LABELS = {
  pending_payment: '待付款',
  pending_confirmation: '待商家确认',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消'
}
const ORDER_TYPE_LABELS = {
  physical: '实体商品订单',
  service: '服务订单'
}
const PAYMENT_STATUS_LABELS = {
  unpaid: '待付款',
  paying: '支付确认中',
  paid: '已付款',
  closed: '已关闭',
  refunding: '退款中',
  refunded: '已退款'
}
const MERCHANT_PHONE = '13872533145'

const formatMoney = (value) => (Number(value) || 0).toFixed(2)

const padNumber = (value) => String(value).padStart(2, '0')

const formatOrderTime = (value) => {
  const date = new Date(Number(value))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`
}

const formatPaymentCountdown = (deadline, now = Date.now()) => {
  const remainingMs = Number(deadline) - now
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return ''
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `剩余${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}自动取消`
}

const formatOrderItem = (item = {}) => ({
  ...item,
  unitPriceText: formatMoney(item.unitPrice),
  subtotalText: formatMoney(item.subtotal)
})

const formatOrder = (order = {}, now = Date.now()) => {
  const orderType = order.orderType || (order.fulfillmentType === 'delivery' ? 'service' : '')
  const paymentStatus = PAYMENT_STATUS_LABELS[order.paymentStatus] ? order.paymentStatus : 'unpaid'
  const fallbackPayableAmountCents = Math.round((Number(order.totalAmount) || 0) * 100)
  const onlinePayableAmountCents = Number.isInteger(order.onlinePayableAmountCents)
    ? order.onlinePayableAmountCents
    : fallbackPayableAmountCents
  const onlinePaymentType = order.onlinePaymentType || (order.amountType === 'estimated' ? 'inspection_fee' : 'full')
  const onlinePaymentLabel = onlinePaymentType === 'inspection_fee'
    ? '本次支付检查费'
    : (onlinePaymentType === 'mixed' ? '本次在线应付' : '在线应付')
  const paymentDeadlineAt = ['unpaid', 'paying'].includes(paymentStatus)
    ? (Number(order.paymentDeadlineAt) || (Number(order.createdAt) + 30 * 60 * 1000))
    : 0
  const paymentCountdownText = ['unpaid', 'paying'].includes(paymentStatus)
    ? formatPaymentCountdown(paymentDeadlineAt, now)
    : ''
  const canCancel = ['unpaid', 'paying'].includes(paymentStatus) && order.status !== 'cancelled'
  const canRefund = paymentStatus === 'paid' && order.refundRequestStatus !== 'requested'
  const canDelete = ['cancelled', 'completed'].includes(order.status)
  const statusHint = order.status === 'cancelled'
    ? '订单已取消，已占用库存已经恢复'
    : order.status === 'completed'
      ? '订单已完成，感谢您的购买'
      : order.refundRequestStatus === 'requested'
        ? '退款申请已提交，请等待商家处理'
        : paymentStatus !== 'paid'
          ? '请在倒计时结束前完成支付'
          : order.fulfillmentType === 'delivery'
            ? '预约已提交，请致电商家确认上门时间'
            : '订单已支付，门店确认后会与您联系'
  return {
    ...order,
    orderType,
    items: Array.isArray(order.items) ? order.items.map(formatOrderItem) : [],
    statusLabel: order.refundRequestStatus === 'requested'
      ? '退款申请中'
      : (ORDER_STATUS_LABELS[order.status] || '处理中'),
    paymentStatus,
    paymentStatusLabel: PAYMENT_STATUS_LABELS[paymentStatus],
    orderTypeLabel: ORDER_TYPE_LABELS[orderType] || '订单',
    totalAmountText: formatMoney(order.totalAmount),
    onlinePayableAmountCents,
    onlinePayableAmountText: formatMoney(onlinePayableAmountCents / 100),
    onlinePaymentLabel,
    paymentDeadlineAt,
    paymentCountdownText,
    paymentActionText: paymentStatus === 'paying'
      ? '继续支付'
      : (onlinePaymentType === 'inspection_fee' ? '支付检查费' : '立即支付'),
    canPay: ['unpaid', 'paying'].includes(paymentStatus) && order.status !== 'cancelled' &&
      (!order.paymentDeadlineAt || Boolean(paymentCountdownText)),
    canCancel,
    canRefund,
    canDelete,
    statusHint,
    createdAtText: formatOrderTime(order.createdAt),
    appointmentText: order.appointment && order.appointment.date && order.appointment.time
      ? `${order.appointment.date} ${order.appointment.time}`
      : '',
    fulfillmentLabel: order.fulfillmentType === 'delivery' ? '上门服务' : '到店办理'
  }
}

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
  MERCHANT_PHONE,
  formatMoney,
  formatOrder,
  formatOrderItem,
  formatOrderTime
}
