Component({
  properties: {
    levels: {
      type: Array,
      value: []
    },
    selectedValues: {
      type: Object,
      value: {}
    },
    skuList: {
      type: Array,
      value: []
    }
  },
  data: {
    displayLevels: []
  },
  observers: {
    'levels, selectedValues, skuList': function updateLevels(levels, selectedValues, skuList) {
      const safeLevels = Array.isArray(levels) ? levels : []
      const safeSelection = selectedValues || {}
      const safeSkuList = Array.isArray(skuList) ? skuList : []
      const displayLevels = safeLevels.map((level) => ({
        name: level.name,
        values: (level.values || []).map((value) => {
          const disabled = !safeSkuList.some((sku) => {
            return sku.specs && sku.specs[level.name] === value && Number(sku.stock) > 0
          })
          return {
            value,
            selected: safeSelection[level.name] === value,
            disabled
          }
        })
      }))
      this.setData({ displayLevels })
    }
  },
  methods: {
    handleSelect(e) {
      if (e.currentTarget.dataset.disabled) return
      this.triggerEvent('select', {
        levelName: e.currentTarget.dataset.level,
        value: e.currentTarget.dataset.value
      })
    }
  }
})
