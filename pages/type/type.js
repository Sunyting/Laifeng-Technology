// pages/type/type.js
Page({
  /**
   * 页面的初始数据
   */
  data: {
    firstTypes: [],
    products: [],
    currentFirstType: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.getFirstTypes()
  },

  /**
   * 获取一级分类
   */
  getFirstTypes() {
    const db = wx.cloud.database()
    db.collection('shop_firstType').get({
      success: (res) => {
        this.setData({
          firstTypes: res.data
        })
        if (res.data.length > 0) {
          this.setData({
            currentFirstType: res.data[0]._id
          })
          this.getProducts(res.data[0]._id)
        }
      },
      fail: (err) => {
        console.error('获取一级分类失败:', err)
      }
    })
  },

  /**
   * 获取商品列表
   */
  getProducts(categoryId) {
    const db = wx.cloud.database()
    db.collection('goods')
      .where({
        categoryId: categoryId
      })
      .orderBy('sort', 'asc')
      .get({
        success: (res) => {
          const products = res.data.map((item) => {
            return this.processProductData(item)
          })
          this.setData({
            products: products
          })
        },
        fail: (err) => {
          console.error('获取商品列表失败:', err)
        }
      })
  },

  /**
   * 处理商品数据，计算价格范围、SKU数量和总库存
   */
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
  },

  /**
   * 切换一级分类
   */
  switchFirstType(e) {
    const firstTypeId = e.currentTarget.dataset.id
    this.setData({
      currentFirstType: firstTypeId
    })
    this.getProducts(firstTypeId)
  }
})
