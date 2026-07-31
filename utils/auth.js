const { callOrderService } = require('./order')

const USER_SESSION_KEY = 'laifeng_user_session'

const buildSession = (profile = {}) => {
  const userId = String(profile.userId || '')
  const nickName = String(profile.nickName || '').trim()
  const avatarUrl = String(profile.avatarUrl || '').trim()
  return {
    userId,
    nickName,
    avatarUrl,
    loggedIn: Boolean(userId && nickName && avatarUrl)
  }
}

const getUserSession = () => {
  const session = wx.getStorageSync(USER_SESSION_KEY)
  return session && typeof session === 'object' ? session : buildSession()
}

const saveUserSession = (profile) => {
  const previousSession = getUserSession()
  const session = buildSession({ ...previousSession, ...(profile || {}) })
  wx.setStorageSync(USER_SESSION_KEY, session)
  return session
}

const loadUserSession = (force = false) => {
  const cachedSession = getUserSession()
  if (!force && cachedSession.userId) return Promise.resolve(cachedSession)
  return callOrderService('getProfile').then(saveUserSession)
}

const openLogin = () => {
  const app = getApp()
  if (app && app.globalData) app.globalData.openProfileEditor = true
  wx.switchTab({ url: '/pages/home/home' })
}

const requireLogin = () => loadUserSession(true).then((session) => {
  if (session.loggedIn) return session
  wx.showModal({
    title: '请先登录',
    content: '完善微信头像和昵称后，才可以加入购物车和提交订单。',
    confirmText: '去登录',
    cancelText: '暂不登录',
    success: (result) => {
      if (result.confirm) openLogin()
    }
  })
  return null
})

module.exports = {
  getUserSession,
  loadUserSession,
  openLogin,
  requireLogin,
  saveUserSession
}
