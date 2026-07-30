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
      const prices = skuList.map((sku) => sku.prices)
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
