Component({
  properties: {
    priceRange: {
      type: Object,
      value: { min: 0, max: 0 }
    },
    priceMeta: {
      type: Object,
      value: { startsAt: false, unit: '', remark: '' }
    },
    sku: {
      type: Object,
      value: null
    },
    itemType: {
      type: String,
      value: ''
    },
    size: {
      type: String,
      value: 'medium'
    }
  },
  data: {
    displayPrice: 0,
    maxPrice: 0,
    showRange: false,
    startsAt: false,
    inspectionFee: false,
    unit: '',
    remark: ''
  },
  observers: {
    'priceRange, priceMeta, sku, itemType': function updatePrice(priceRange, priceMeta, sku, itemType) {
      if (sku && sku.id) {
        const inspectionFee = itemType === 'service' && (
          sku.paymentMode === 'inspection_fee' || (!sku.paymentMode && sku.priceType === 'starting')
        )
        this.setData({
          displayPrice: Number(sku.prices) || 0,
          maxPrice: 0,
          showRange: false,
          startsAt: sku.priceType === 'starting',
          inspectionFee,
          unit: sku.unit || '',
          remark: sku.priceRemark || ''
        })
        return
      }

      const min = Number(priceRange && priceRange.min) || 0
      const max = Number(priceRange && priceRange.max) || 0
      const startsAt = Boolean(priceMeta && priceMeta.startsAt)
      this.setData({
        displayPrice: min,
        maxPrice: max,
        showRange: !startsAt && min !== max,
        startsAt,
        inspectionFee: Boolean(priceMeta && priceMeta.inspectionFee),
        unit: priceMeta && priceMeta.unit ? priceMeta.unit : '',
        remark: priceMeta && priceMeta.remark ? priceMeta.remark : ''
      })
    }
  }
})
