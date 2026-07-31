const { callOrderService, MERCHANT_PHONE } = require('../../utils/order')
const { saveUserSession } = require('../../utils/auth')

const EMPTY_PROFILE = {
  nickName: '',
  avatarUrl: '',
  name: '',
  phone: '',
  address: ''
}

Page({
  data: {
    profile: { ...EMPTY_PROFILE },
    profileDraft: { ...EMPTY_PROFILE },
    avatarPreview: '',
    avatarText: '顾',
    orderCounts: {
      all: 0,
      unpaid: 0,
      paid: 0,
      pending: 0
    },
    isLoggedIn: false,
    isLoading: true,
    isSaving: false,
    editorType: ''
  },
  onShow() {
    this.loadPageData().then(() => {
      const app = getApp()
      if (!app.globalData.openProfileEditor) return
      app.globalData.openProfileEditor = false
      this.openProfileEditor()
    })
  },
  onPullDownRefresh() {
    this.loadPageData().finally(() => wx.stopPullDownRefresh())
  },
  loadPageData() {
    this.setData({ isLoading: true })
    return callOrderService('getProfile').then((profileData) => {
      const profile = { ...EMPTY_PROFILE, ...(profileData || {}) }
      const session = saveUserSession(profile)
      this.setData({
        profile,
        isLoggedIn: session.loggedIn,
        avatarPreview: profile.avatarUrl,
        avatarText: (profile.nickName || profile.name || '顾').slice(0, 1),
        orderCounts: { all: 0, unpaid: 0, paid: 0, pending: 0 }
      })
      if (!session.loggedIn) return
      return callOrderService('listOrders').then((orders) => {
        const orderList = Array.isArray(orders) ? orders : []
        this.setData({
        orderCounts: {
          all: orderList.length,
          unpaid: orderList.filter((order) => order.paymentStatus !== 'paid').length,
          paid: orderList.filter((order) => order.paymentStatus === 'paid').length,
          pending: orderList.filter((order) => order.status === 'pending_confirmation').length
        }
        })
      })
    }).catch((err) => {
      console.error('个人中心加载失败:', err)
      wx.showToast({ title: err.message || '加载失败，请稍后重试', icon: 'none' })
    }).finally(() => {
      this.setData({ isLoading: false })
    })
  },
  openOrders(e) {
    if (!this.data.isLoggedIn) {
      this.openProfileEditor()
      return
    }
    const filter = e.currentTarget.dataset.filter || 'all'
    wx.navigateTo({ url: `/pages/orders/orders?filter=${filter}` })
  },
  callMerchant() {
    wx.makePhoneCall({ phoneNumber: MERCHANT_PHONE })
  },
  openProfileEditor() {
    this.setData({
      editorType: 'profile',
      profileDraft: { ...this.data.profile },
      avatarPreview: this.data.profile.avatarUrl
    })
  },
  openAddressEditor() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先完善微信资料', icon: 'none' })
      this.openProfileEditor()
      return
    }
    this.setData({
      editorType: 'address',
      profileDraft: { ...this.data.profile }
    })
  },
  closeEditor() {
    if (this.data.isSaving) return
    this.setData({ editorType: '', avatarPreview: this.data.profile.avatarUrl })
  },
  noop() {},
  handleProfileInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`profileDraft.${field}`]: e.detail.value })
  },
  chooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    if (!avatarUrl) return
    this.setData({ avatarPreview: avatarUrl })
  },
  uploadAvatarIfNeeded() {
    const avatarPreview = this.data.avatarPreview
    if (!avatarPreview || avatarPreview === this.data.profile.avatarUrl) {
      return Promise.resolve(this.data.profile.avatarUrl)
    }
    const extensionMatch = avatarPreview.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'jpg'
    const cloudPath = `user-avatars/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`
    return wx.cloud.uploadFile({ cloudPath, filePath: avatarPreview })
      .then((result) => result.fileID)
  },
  saveProfile() {
    if (this.data.isSaving) return
    const draft = {
      ...this.data.profileDraft,
      nickName: this.data.profileDraft.nickName.trim(),
      name: this.data.profileDraft.name.trim(),
      phone: this.data.profileDraft.phone.trim(),
      address: this.data.profileDraft.address.trim()
    }
    if (this.data.editorType === 'profile' && !draft.nickName) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (this.data.editorType === 'profile' && !this.data.avatarPreview) {
      wx.showToast({ title: '请选择微信头像', icon: 'none' })
      return
    }
    if (this.data.editorType === 'address') {
      if (draft.name.length < 2) {
        wx.showToast({ title: '请填写联系人姓名', icon: 'none' })
        return
      }
      if (!/^1\d{10}$/.test(draft.phone)) {
        wx.showToast({ title: '请填写正确的手机号码', icon: 'none' })
        return
      }
      if (draft.address.length < 5) {
        wx.showToast({ title: '请填写详细地址', icon: 'none' })
        return
      }
    }

    this.setData({ isSaving: true })
    wx.showLoading({ title: '保存中', mask: true })
    const avatarPromise = this.data.editorType === 'profile'
      ? this.uploadAvatarIfNeeded()
      : Promise.resolve(this.data.profile.avatarUrl)
    avatarPromise
      .then((avatarUrl) => callOrderService('updateProfile', {
        profile: { ...draft, avatarUrl }
      }))
      .then((profile) => {
        const session = saveUserSession(profile)
        this.setData({
          profile,
          isLoggedIn: session.loggedIn,
          profileDraft: profile,
          avatarPreview: profile.avatarUrl,
          avatarText: (profile.nickName || profile.name || '顾').slice(0, 1),
          editorType: ''
        })
        return this.loadPageData()
      })
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch((err) => {
        console.error('保存个人资料失败:', err)
        wx.showToast({ title: err.message || '保存失败，请稍后重试', icon: 'none' })
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ isSaving: false })
      })
  }
})
