const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const normalizeProduct = (product = {}) => {
  const skuList = Array.isArray(product.SKUlist) ? product.SKUlist : []
  const prices = skuList
    .map((sku) => toFiniteNumber(sku.prices, NaN))
    .filter(Number.isFinite)
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
  const minPriceSkus = skuList.filter((sku) => toFiniteNumber(sku.prices, NaN) === minPrice)
  const units = [...new Set(skuList.map((sku) => sku.unit).filter(Boolean))]
  const remarks = [...new Set(skuList.map((sku) => sku.priceRemark).filter(Boolean))]

  return {
    ...product,
    SKUlist: skuList,
    specs: product.specs || { levels: [] },
    priceRange: {
      min: minPrice,
      max: maxPrice
    },
    priceMeta: {
      startsAt: minPriceSkus.some((sku) => sku.priceType === 'starting'),
      unit: units.length === 1 && skuList.every((sku) => sku.unit === units[0]) ? units[0] : '',
      remark: remarks.length === 1 && skuList.every((sku) => sku.priceRemark === remarks[0]) ? remarks[0] : ''
    },
    totalStock: skuList.reduce((sum, sku) => sum + Math.max(0, toFiniteNumber(sku.stock)), 0),
    skuCount: skuList.length
  }
}

const formatSpecText = (specs = {}) => Object.keys(specs)
  .map((key) => `${key}：${specs[key]}`)
  .join('；')

const getInitialSelection = (product) => {
  const skuList = product && Array.isArray(product.SKUlist) ? product.SKUlist : []
  return skuList.length > 0 ? { ...(skuList[0].specs || {}) } : {}
}

const findSelectedSku = (product, selectedValues = {}) => {
  const skuList = product && Array.isArray(product.SKUlist) ? product.SKUlist : []
  const selectedKeys = Object.keys(selectedValues)
  return skuList.find((sku) => selectedKeys.every((key) => {
    return sku.specs && sku.specs[key] === selectedValues[key]
  })) || null
}

module.exports = {
  findSelectedSku,
  formatSpecText,
  getInitialSelection,
  normalizeProduct,
  toFiniteNumber
}
