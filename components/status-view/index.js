Component({
  properties: {
    status: {
      type: String,
      value: 'empty'
    },
    message: {
      type: String,
      value: ''
    },
    actionText: {
      type: String,
      value: ''
    }
  },
  methods: {
    handleAction() {
      this.triggerEvent('action')
    }
  }
})
