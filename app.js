// app.js
App({
  globalData: {
    openProfileEditor: false
  },
  onLaunch() {
    wx.cloud.init({
      env: 'cloud1-6gwdbwvi5f830ad2'
    })
  }
})
