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
      const prices = skuList.map(sku => sku.prices)
      minPrice = Math.min(...prices)
      maxPrice = Math.max(...prices)
    }

    // 计算总库存
    const totalStock = skuList.reduce((sum, sku) => sum + (sku.stock || 0), 0)

    // SKU数量 - 从specs.levels中获取规格数量
    const levels = product.specs?.levels || []
    const skuCount = levels.length > 0 ? levels[0].values.length : skuList.length

    return {
      ...product,
      priceRange: {
        min: minPrice,
        max: maxPrice
      },
      totalStock: totalStock,
      skuCount: skuCount
    }
  }
})
