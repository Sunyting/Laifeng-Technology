Component({
  properties: {
    product: {
      type: Object,
      value: {}
    },
    layout: {
      type: String,
      value: 'grid'
    },
    showAction: {
      type: Boolean,
      value: true
    }
  },
  data: {
    imageFailed: false
  },
  observers: {
    'product.image': function resetImageState() {
      this.setData({ imageFailed: false })
    }
  },
  methods: {
    handleImageError() {
      this.setData({ imageFailed: true })
    },
    handleTap() {
      this.triggerEvent('cardtap', { product: this.properties.product })
    },
    handleAdd() {
      this.triggerEvent('addcart', { product: this.properties.product })
    }
  }
})
