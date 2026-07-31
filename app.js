// app.js
App({
  globalData: {
    openProfileEditor: false,
    payment: {
      envId: 'cloud1-6gwdbwvi5f830ad2',
      functionName: 'laifeng-pay-8cd3oihn-demo-scfweb',
      createPath: '/wx-pay/order',
      queryPath: '/wx-pay/query'
    }
  },
  onLaunch() {
    wx.cloud.init({
      env: this.globalData.payment.envId,
      traceUser: true
    })
  }
})
