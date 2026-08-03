const documents = require('./documents')

Component({
  properties: {
    checked: {
      type: Boolean,
      value: false
    }
  },
  data: {
    documentVisible: false,
    documentTitle: '',
    documentSections: []
  },
  methods: {
    handleChange(e) {
      const checked = Array.isArray(e.detail.value) && e.detail.value.includes('accepted')
      this.triggerEvent('change', { checked })
    },
    openDocument(e) {
      const document = documents[e.currentTarget.dataset.document]
      if (!document) return
      this.setData({
        documentVisible: true,
        documentTitle: document.title,
        documentSections: document.sections
      })
    },
    closeDocument() {
      this.setData({ documentVisible: false })
    },
    noop() {}
  }
})
