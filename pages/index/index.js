Page({
  data: {
    banners: [],
    recommendedProducts: []
  },
  onLoad() {
    this.getBanners()
    this.getRecommendedProducts()
  },
  getBanners() {
    const db = wx.cloud.database()
    db.collection('top-banner').get({
      success: (res) => {
        this.setData({
          banners: res.data
        })
      },
      fail: (err) => {
        console.error('获取轮播图失败:', err)
      }
    })
  },
  getRecommendedProducts() {
    const db = wx.cloud.database()
    db.collection('goods')
      .where({
        isrecommend: true
      })
      .orderBy('sort', 'asc')
      .get({
        success: (res) => {
          const products = res.data.map((item) => {
            return this.processProductData(item)
          })
          this.setData({
            recommendedProducts: products
          })
        },
        fail: (err) => {
          console.error('获取推荐商品失败:', err)
        }
      })
  },
  processProductData(product) {
    const skuList = product.SKUlist || []

    // 计算价格范围
    let minPrice = 0
    let maxPrice = 0
    if (skuList.length > 0) {
      const prices = skuList.map((sku) => Number(sku.prices)).filter(Number.isFinite)
      if (prices.length > 0) {
        minPrice = Math.min(...prices)
        maxPrice = Math.max(...prices)
      }
    }

    // 计算总库存
    const totalStock = skuList.reduce((sum, sku) => {
      const stock = Number(sku.stock)
      return sum + (Number.isFinite(stock) ? stock : 0)
    }, 0)

    // 多级规格的实际可售组合以 SKU 列表为准
    const skuCount = skuList.length
    const minPriceSkus = skuList.filter((sku) => Number(sku.prices) === minPrice)
    const units = [...new Set(skuList.map((sku) => sku.unit).filter(Boolean))]
    const remarks = [...new Set(skuList.map((sku) => sku.priceRemark).filter(Boolean))]
    const priceMeta = {
      startsAt: minPriceSkus.some((sku) => sku.priceType === 'starting'),
      unit: units.length === 1 && skuList.every((sku) => sku.unit === units[0]) ? units[0] : '',
      remark: remarks.length === 1 && skuList.every((sku) => sku.priceRemark === remarks[0]) ? remarks[0] : ''
    }

    return {
      ...product,
      priceRange: {
        min: minPrice,
        max: maxPrice
      },
      totalStock: totalStock,
      skuCount: skuCount,
      priceMeta: priceMeta
    }
  }
})
