# 来锋科技云开发数据库设计

本文档是项目数据库结构的基准文档。修改集合、字段、数据类型、索引、权限或关联关系时，必须同步更新本文档和相关代码。

最后核对时间：2026-08-03
云开发环境：`cloud1-6gwdbwvi5f830ad2`（上海 `ap-shanghai`）

## 一、已部署结构概览

| 集合 | 用途 | 当前记录数 | 当前权限 | 状态 |
| --- | --- | ---: | --- | --- |
| `shop_firstType` | 一级商品分类 | 9 | `READONLY` | 已部署 |
| `goods` | 商品、规格和 SKU | 37 | `ADMINWRITE` | 已部署 |
| `top-banner` | 首页轮播图 | 6 | `READONLY` | 已部署 |
| `users` | 用户联系资料 | 1 | `ADMINONLY` | 已部署 |
| `orders` | 订单及订单明细 | 5 | `ADMINONLY` | 已部署 |
| `payments` | 微信支付单及支付结果 | 0 | `ADMINONLY` | 已部署 |

当前集合关系：

```text
shop_firstType._id
        │
        └──< goods.categoryId

users._id（用户 OpenID）
        ├──< orders.userId
        └──< payments.userId

orders._id
        │
        └──< payments.orderId

top-banner（当前独立，无外键关系）
```

云开发 NoSQL 不强制外键约束。写入或删除分类时，业务层必须校验 `goods.categoryId` 的引用关系。

## 二、公共管理字段

以下字段主要由云开发后台或微搭生成。历史导入数据不一定包含全部字段，因此小程序读取时应按可选字段处理。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | 是 | 文档主键，由云数据库生成 |
| `_openid` | `string` | 否 | 创建者 OpenID 或后台身份标识 |
| `_mainDep` | `string` | 否 | 微搭生成的关联元数据，当前值可能为字符串 `"null"` |
| `owner` | `string` | 否 | 微搭所有者标识 |
| `createBy` | `string` | 否 | 创建人标识 |
| `updateBy` | `string` | 否 | 最后更新人标识 |
| `createdAt` | `number` | 否 | 创建时间，Unix 毫秒时间戳 |
| `updatedAt` | `number` | 否 | 更新时间，Unix 毫秒时间戳 |

## 三、`shop_firstType` 一级分类集合

### 字段定义

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | 是 | 分类 ID，也是商品的 `categoryId` 引用值 |
| `name` | `string` | 是 | 分类名称 |
| 公共管理字段 | 见上节 | 否 | 云开发后台生成 |

当前分类名称：手机相关、电脑相关、办公打印及耗材、各类家电维修、图文视频、网络相关、监控安防、上门维修、数码配件。

### 当前索引

| 索引名 | 字段 | 方向 | 唯一 |
| --- | --- | --- | --- |
| `_id_` | `_id` | 升序 | 否 |
| `_openid_1` | `_openid` | 升序 | 否 |

## 四、`goods` 商品集合

### 商品字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | 是 | 商品 ID |
| `categoryId` | `string` | 是 | 引用 `shop_firstType._id` |
| `name` | `string` | 是 | 商品名称 |
| `description` | `string` | 否 | 商品简介 |
| `image` | `string` | 否 | 商品主图的云文件 ID；空字符串表示图片待补 |
| `images` | `string[]` | 否 | 商品详情图云文件 ID 列表 |
| `isrecommend` | `boolean` | 否 | 是否在首页推荐；缺省按 `false` 处理 |
| `sort` | `number` | 是 | 同一分类内按升序展示 |
| `status` | `string` | 是 | `"1"` 表示当前可用 |
| `type` | `string` | 是 | `"1"` 表示单 SKU，`"2"` 表示多 SKU |
| `itemType` | `"physical" \| "service"` | 是 | 实体商品或服务项目；不能通过一级分类名称推断 |
| `fulfillmentTypes` | `("store" \| "delivery")[]` | 是 | 商品支持的办理方式；`delivery` 在当前业务中表示上门服务 |
| `requiresAppointment` | `boolean` | 是 | 选择上门服务时是否必须填写预约时间 |
| `inventoryType` | `"finite" \| "unlimited"` | 是 | 有限库存或不限库存；不限库存服务下单时不扣减 SKU 库存 |
| `specs` | `object` | 否 | 商品规格维度定义 |
| `SKUlist` | `Sku[]` | 是 | 当前小程序使用的 SKU 和价格来源 |
| `skus` | `LegacySku[]` | 否 | 历史兼容字段，当前小程序不读取，不应继续作为新数据源 |
| `createTime` | `string` | 否 | 历史日期字段，格式为 `YYYY-MM-DD`，不应用于精确时间排序 |
| 公共管理字段 | 见第二节 | 否 | 云开发后台生成；部分历史商品缺失 |

### `specs` 结构

```text
specs
└── levels: SpecLevel[]
    ├── name: string
    └── values: string[]
```

`levels` 表示规格维度。例如“品牌 + 膜类型”应有两个 `SpecLevel`。实际可售组合必须以 `SKUlist` 为准，不能用第一层 `values.length` 代替 SKU 总数。

### `SKUlist` 当前结构

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | SKU ID；当前记录均非空且全局唯一，后续新增时必须保持唯一 |
| `image` | `string` | 否 | SKU 图片云文件 ID |
| `prices` | `number` | 是 | 当前销售价格；字段名保持现状 |
| `originalPrice` | `number` | 否 | 划线价 |
| `specs` | `Record<string, string>` | 是 | 该 SKU 对应的完整规格值；字段名必须与 `specs.levels[].name` 一致，字段值必须存在于对应 `values` 中 |
| `status` | `string` | 是 | SKU 状态，当前已出现 `"1"` |
| `stock` | `number` | 是 | 可售库存；服务类当前以 `999` 表示充足库存 |
| `priceType` | `"fixed" \| "starting"` | 是 | 固定价格或起始价格 |
| `paymentMode` | `"full" \| "inspection_fee"` | 否 | 在线付全款或仅付检查费；缺省时服务类 `starting` 按 `inspection_fee`，其他按 `full` 兼容 |
| `inspectionFeeCents` | `number` | 否 | 单件检查费，单位为分且必须为正整数；检查费模式缺省时暂以 `prices` 换算为分 |
| `unit` | `string` | 否 | 计价单位，如“张”“米”“个”“点” |
| `priceRemark` | `string` | 否 | 价格补充说明，如“检测费”“另加维修费” |

### `skus` 历史兼容结构

`skus` 使用 `price`、数字 `status` 等另一套字段，且部分商品内容与实际商品不一致。当前页面不读取该字段。删除或迁移前必须先核对所有调用方和后台配置；完成统一迁移后再从本文档移除。

### 已部署商品数据摘要

全部规划数据已于 2026-07-30 同步到 `goods`。当前 37 个商品均已上架并配置商品主图；77 个 SKU 的 `specs` 已于 2026-07-31 补齐，所有规格选项均可匹配到对应 SKU。37 个商品的业务类型、办理方式、预约要求和库存类型也已于 2026-07-31 完成迁移。

| 一级分类 | 商品数 | SKU 数量 | 已配置图片 | 待补图片 |
| --- | ---: | ---: | ---: | ---: |
| 手机相关 | 6 | 13 | 6 | 0 |
| 电脑相关 | 8 | 17 | 8 | 0 |
| 办公打印及耗材 | 4 | 12 | 4 | 0 |
| 各类家电维修 | 2 | 2 | 2 | 0 |
| 图文视频 | 2 | 2 | 2 | 0 |
| 网络相关 | 5 | 12 | 5 | 0 |
| 监控安防 | 3 | 7 | 3 | 0 |
| 上门维修 | 2 | 3 | 2 | 0 |
| 数码配件 | 5 | 9 | 5 | 0 |
| **总计** | **37** | **77** | **37** | **0** |

### 商品类型与办理方式

一级分类只用于商品导航，不能作为实体商品、服务项目或上门能力的判断依据。结算页和 `orderService` 必须读取商品业务字段。

| 商品范围 | `itemType` | `fulfillmentTypes` | `requiresAppointment` | `inventoryType` |
| --- | --- | --- | --- | --- |
| 键盘、鼠标、充电器、耳机等实体商品 | `physical` | `["store"]` | `false` | `finite` |
| 换屏、换电池、电脑维修、打印等到店服务 | `service` | `["store"]` | `false` | `unlimited` |
| 大件电器维修 | `service` | `["store", "delivery"]` | `true` | `unlimited` |
| 网络布线、监控安装、电脑上门维修、家电上门维修 | `service` | `["delivery"]` | `true` | `unlimited` |

`上门维修`一级分类下的商品固定仅支持 `delivery`，结算页只显示“上门服务”，不提供“到店办理”选项。

### 当前索引

| 索引名 | 字段 | 方向 | 唯一 |
| --- | --- | --- | --- |
| `_id_` | `_id` | 升序 | 否 |
| `_openid_1` | `_openid` | 升序 | 否 |
| `categoryId_1_sort_1` | `categoryId`、`sort` | 升序、升序 | 否 |
| `isrecommend_1_sort_1` | `isrecommend`、`sort` | 升序、升序 | 否 |

两个业务索引已于 2026-07-30 部署，分别服务于分类商品列表和首页推荐商品列表。页面需要稳定顺序时，应在查询中显式按 `sort` 升序排列，不能依赖数据库默认返回顺序。

## 五、`top-banner` 首页轮播集合

### 字段定义

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | 是 | 轮播项 ID |
| `pic` | `string` | 是 | 轮播图片云文件 ID |
| 公共管理字段 | 见第二节 | 否 | 云开发后台生成 |

当前集合没有排序、启用状态和跳转目标字段，页面按照数据库返回顺序展示。后续如需运营控制，建议统一新增 `sort`、`status`、`linkType` 和 `linkValue`，但新增前需同步修改页面逻辑。

### 当前索引

| 索引名 | 字段 | 方向 | 唯一 |
| --- | --- | --- | --- |
| `_id_` | `_id` | 升序 | 否 |
| `_openid_1` | `_openid` | 升序 | 否 |

## 六、`users` 用户集合

`users` 保存微信展示资料和结算时使用的默认联系资料，由 `orderService` 云函数按当前用户 OpenID 读写，客户端不能直接访问。微信头像和昵称必须由用户在个人中心主动选择或填写，不能在小程序启动时静默获取。

当前版本以 `nickName` 和 `avatarUrl` 均已保存作为“已登录并完善资料”的业务条件。云开发上下文中的 OpenID 是唯一可信用户身份；客户端返回或本地缓存的用户 ID 只用于界面状态和购物车分区，不能用于决定订单归属。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | 是 | 当前微信用户 OpenID |
| `nickName` | `string` | 否 | 用户主动填写的微信昵称，最多 30 个字符 |
| `avatarUrl` | `string` | 否 | 用户主动选择并上传到当前云环境的头像文件 ID |
| `name` | `string` | 否 | 默认上门联系人姓名，最多 30 个字符 |
| `phone` | `string` | 否 | 默认上门联系手机号码 |
| `address` | `string` | 否 | 默认送货或上门地址，最多 120 个字符 |
| `privacyConsentVersion` | `string` | 否 | 用户最近主动同意的《用户服务协议》和《隐私政策》版本 |
| `privacyConsentedAt` | `number \| null` | 否 | 最近一次主动同意协议的 Unix 毫秒时间戳 |
| `createdAt` | `number` | 是 | 首次保存时间，Unix 毫秒时间戳 |
| `updatedAt` | `number` | 是 | 最后更新时间，Unix 毫秒时间戳 |

### 当前索引

| 索引名 | 字段 | 方向 | 唯一 |
| --- | --- | --- | --- |
| `_id_` | `_id` | 升序 | 否 |
| `_openid_1` | `_openid` | 升序 | 否 |

## 七、`orders` 订单集合

订单只能通过 `orderService` 云函数创建和查询。创建订单时，云函数重新读取商品状态、SKU 状态、价格和库存，并在事务内扣减库存和写入订单；前端传入的商品名称与金额不作为订单依据。

### 订单字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | 是 | 与 `orderNo` 相同的订单主键 |
| `orderNo` | `string` | 是 | `LFT` 开头的订单编号 |
| `userId` | `string` | 是 | 引用 `users._id`，由云函数从当前用户身份取得 |
| `items` | `OrderItem[]` | 是 | 下单时的商品与 SKU 快照 |
| `totalQuantity` | `number` | 是 | 商品总件数 |
| `totalAmount` | `number` | 是 | 云端按 SKU 单价计算的金额 |
| `amountType` | `"fixed" \| "estimated"` | 是 | 固定金额或预估金额 |
| `onlinePaymentType` | `"full" \| "inspection_fee" \| "mixed"` | 是 | 本次在线支付全款、检查费或两者混合 |
| `onlinePayableAmountCents` | `number` | 是 | 本次微信支付应付金额，单位为分，由云函数计算 |
| `inspectionFeeCents` | `number` | 是 | 订单内检查费合计，单位为分；无检查费时为 `0` |
| `paidAmountCents` | `number` | 是 | 已确认到账金额，单位为分，新订单为 `0` |
| `currentPaymentId` | `string \| null` | 是 | 当前有效支付单号，引用 `payments._id`；尚未创建或已释放时为 `null` |
| `paymentExpiresAt` | `number \| null` | 是 | 当前支付单过期时间；尚未创建支付单时为 `null` |
| `paymentDeadlineAt` | `number \| null` | 是 | 订单支付截止时间，创建后 30 分钟；支付超时或取消后为 `null` |
| `paidAt` | `number \| null` | 是 | 在线支付到账时间；未支付时为 `null` |
| `refundRequestStatus` | `"requested" \| null` | 否 | 顾客退款申请状态；未申请时为空 |
| `refundRequestedAt` | `number \| null` | 否 | 顾客提交退款申请的时间 |
| `quoteStatus` | `"not_required" \| "pending" \| "confirmed"` | 是 | 后续维修报价状态 |
| `finalQuoteAmountCents` | `number \| null` | 是 | 检测后的最终报价，单位为分 |
| `offlineAmountCents` | `number \| null` | 是 | 后续到店实收维修费，单位为分 |
| `offlinePaymentStatus` | `"not_required" \| "pending" \| "paid"` | 是 | 后续到店付款状态 |
| `orderType` | `"physical" \| "service"` | 是 | 实体商品订单或服务订单 |
| `fulfillmentType` | `"store" \| "delivery"` | 是 | 到店办理或上门服务；必须同时被订单内所有商品的 `fulfillmentTypes` 允许 |
| `contact` | `object` | 是 | 联系人姓名、电话和地址快照；到店订单的地址为空字符串 |
| `appointment` | `Appointment \| null` | 是 | 上门预约时间；仅 `delivery` 订单保存预约对象，到店订单固定为 `null` |
| `note` | `string` | 否 | 用户订单备注，最多 200 个字符 |
| `paymentStatus` | `"unpaid" \| "paying" \| "paid" \| "closed" \| "refunding" \| "refunded"` | 是 | 在线付款状态，新订单初始为 `unpaid`；与业务订单状态相互独立 |
| `status` | `string` | 是 | 当前订单状态，初始为 `pending_payment`；支付成功后变为 `pending_confirmation` |
| `statusHistory` | `OrderStatus[]` | 是 | 订单状态变更记录 |
| `cancelledAt` | `number \| null` | 否 | 订单取消时间 |
| `cancellationReason` | `"payment_timeout" \| "user_cancelled"` | 否 | 超时自动取消或顾客主动取消 |
| `userDeletedAt` | `number \| null` | 否 | 顾客软删除时间；有值时不再向该顾客展示 |
| `createdAt` | `number` | 是 | 下单时间，Unix 毫秒时间戳 |
| `updatedAt` | `number` | 是 | 最后更新时间，Unix 毫秒时间戳 |

### `OrderItem` 快照结构

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | `productId::skuId` 组合键 |
| `productId` | `string` | 是 | 下单商品 ID |
| `skuId` | `string` | 是 | 下单 SKU ID |
| `name` | `string` | 是 | 下单时商品名称快照 |
| `image` | `string` | 否 | 下单时商品或 SKU 图片快照 |
| `specs` | `Record<string, string>` | 是 | 下单时规格快照 |
| `specText` | `string` | 否 | 规格展示文本 |
| `unitPrice` | `number` | 是 | 云端确认的 SKU 单价 |
| `subtotal` | `number` | 是 | 单价乘数量的小计 |
| `quantity` | `number` | 是 | 购买数量，范围 1 至 99 |
| `itemType` | `"physical" \| "service"` | 是 | 下单时的商品类型快照 |
| `fulfillmentType` | `"store" \| "delivery"` | 是 | 该订单项下单时选择的办理方式 |
| `priceType` | `string` | 是 | 下单时计价类型快照 |
| `paymentMode` | `"full" \| "inspection_fee"` | 是 | 下单时的在线付款方式快照 |
| `inspectionFeeCents` | `number` | 是 | 单件检查费快照，单位为分；全款项目为 `0` |
| `onlineUnitAmountCents` | `number` | 是 | 单件在线应付金额，单位为分 |
| `onlineSubtotalCents` | `number` | 是 | 当前订单项在线应付小计，单位为分 |
| `unit` | `string` | 否 | 下单时计价单位快照 |
| `priceRemark` | `string` | 否 | 下单时价格说明快照 |

### `Appointment` 预约结构

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `date` | `string` | 是 | 顾客选择的上门日期，格式为 `YYYY-MM-DD` |
| `time` | `string` | 是 | 顾客选择的上门时间，格式为 `HH:mm` |
| `scheduledAt` | `number` | 是 | 按北京时间换算的 Unix 毫秒时间戳，用于服务端校验和后续排序 |

上门预约仅支持未来 90 天。订单提交后，顾客需拨打商家电话 `13872533145` 确认具体上门时间。

当前订单状态：`pending_payment`（待付款）、`pending_confirmation`（待商家确认）、`confirmed`（已确认）、`completed`（已完成）、`cancelled`（已取消）。新订单先进入 `pending_payment`，只有微信支付回调或主动查单确认到账后才进入 `pending_confirmation`。商家后续维护确认和完成状态。

订单创建后 30 分钟内未支付会自动取消。`orderService` 配置 `cancelExpiredOrders` 定时触发器，每 5 分钟扫描一次；订单列表和详情查询也会即时补偿检查。取消操作在事务中恢复有限库存、关闭待处理支付单并写入状态历史。未支付订单可由顾客主动取消；已支付订单可提交退款申请；仅已完成和已取消订单可软删除。

当前付款状态：`unpaid`（待付款）、`paying`（支付确认中）、`paid`（已付款）、`closed`（已关闭）、`refunding`（退款中）、`refunded`（已退款）。历史订单缺少新增金额字段时，小程序暂按 `totalAmount` 兼容展示在线应付金额。

固定价订单在线支付全款。服务类起步价或显式设置 `paymentMode: "inspection_fee"` 的 SKU 在线只支付检查费，检测后的维修费用记录在 `offlineAmountCents`，由顾客到店支付。一个服务订单同时包含全款和检查费项目时，`onlinePaymentType` 为 `mixed`，在线应付金额为两类项目金额之和。

### 当前索引

| 索引名 | 字段 | 方向 | 唯一 |
| --- | --- | --- | --- |
| `_id_` | `_id` | 升序 | 否 |
| `_openid_1` | `_openid` | 升序 | 否 |
| `userId_1_createdAt_-1` | `userId` 升序、`createdAt` 降序 | 复合 | 否 |

## 八、`payments` 支付集合

`payments` 已于 2026-07-31 部署，权限为 `ADMINONLY`，仅允许支付 HTTP 云函数读写。云环境已通过集成中心创建并部署微信支付函数 `laifeng-pay-8cd3oihn-demo-scfweb`，已接入仅按业务订单下单和查单的安全路由。`orderService` 同日已部署包含 `onlinePayableAmountCents`、`currentPaymentId` 等支付字段的订单版本。

集成中心生成函数后，必须把实际函数名配置到 `app.js` 的 `globalData.payment.functionName`，并实现 `/wx-pay/order` 与 `/wx-pay/query` 两个仅接收 `orderId` 的业务路由；不得直接采用允许客户端传金额的通用下单入口。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | 是 | 微信支付商户订单号 `outTradeNo`，全局唯一 |
| `orderId` | `string` | 是 | 引用 `orders._id` |
| `userId` | `string` | 是 | 支付用户 OpenID，只能由服务端写入 |
| `amountCents` | `number` | 是 | 本次支付金额，必须等于订单的 `onlinePayableAmountCents` |
| `status` | `"pending" \| "paid" \| "closed" \| "refunding" \| "refunded"` | 是 | 支付单状态 |
| `transactionId` | `string` | 否 | 微信支付订单号 |
| `requestId` | `string` | 否 | 微信支付响应头 `Request-ID`，用于问题排查 |
| `paymentParams` | `object \| null` | 是 | 微信统一下单成功后返回的小程序调起支付参数；新支付单初始化为 `{}`，历史支付单在下单请求处理中可能为 `null`，写入时必须使用 `db.command.set` 整体替换 |
| `expiresAt` | `number` | 是 | 支付单过期时间，Unix 毫秒时间戳；同时写入微信下单的 `time_expire` |
| `paidAt` | `number \| null` | 是 | 支付到账时间 |
| `refundId` | `string` | 否 | 微信退款单号 |
| `refundedAt` | `number \| null` | 否 | 全额退款成功时间 |
| `createdAt` | `number` | 是 | 创建时间 |
| `updatedAt` | `number` | 是 | 更新时间 |

支付函数必须只接收 `orderId`，重新读取订单归属、状态及 `onlinePayableAmountCents` 后创建微信支付单，不能接收客户端传入的金额。小程序通过 `wx.cloud.callHTTPFunction` 调用，平台注入的 `x-wx-openid` 是支付函数唯一接受的用户身份来源。支付成功以服务端通知或主动查单结果为准，`wx.requestPayment` 的成功回调只用于界面反馈。支付通知必须校验商户订单号、金额、币种和用户归属，并以事务或条件更新实现幂等。

微信支付商户平台的“小程序商品订单详情 PATH”填写 `pages/order-detail/order-detail?paymentId=${商品订单号}`。微信会把占位符替换为 `payments._id`；订单详情页通过 `orderService` 校验支付单归属后解析对应的 `orders._id`，客户端不能直接读取 `payments` 集合。

### 当前索引

| 索引名 | 字段 | 方向 | 唯一 |
| --- | --- | --- | --- |
| `_id_` | `_id` | 升序 | 否 |
| `_openid_1` | `_openid` | 升序 | 否 |
| `orderId_1_createdAt_-1` | `orderId` 升序、`createdAt` 降序 | 复合 | 否 |
| `userId_1_createdAt_-1` | `userId` 升序、`createdAt` 降序 | 复合 | 否 |

## 九、权限与服务端写入

| 集合 | 已部署权限 | 客户端读取 | 客户端写入 |
| --- | --- | --- | --- |
| `shop_firstType` | `READONLY` | 允许 | 禁止 |
| `goods` | `ADMINWRITE` | 允许 | 仅管理员可写 |
| `top-banner` | `READONLY` | 允许 | 禁止 |
| `users` | `ADMINONLY` | 禁止 | 禁止 |
| `orders` | `ADMINONLY` | 禁止 | 禁止 |
| `payments` | `ADMINONLY` | 禁止 | 禁止 |

`orderService` 云函数使用 Node.js 20 和 `wx-server-sdk@4.0.2`，只允许已登录的非匿名用户调用。它负责保存微信展示资料和默认联系资料、创建订单、扣减库存以及按当前用户查询订单，客户端不直接读写 `users` 和 `orders`。

创建订单前，`orderService` 还会检查当前 OpenID 对应的 `users` 记录是否同时具备 `nickName` 和 `avatarUrl`；未完善资料时返回 `LOGIN_REQUIRED`。订单的 `userId` 始终由云函数写入当前 OpenID，不接收客户端指定的用户 ID。后续接入支付时，创建支付单和处理支付结果也必须执行相同的用户归属校验。

保存头像、昵称、联系人、电话或地址，以及创建订单前，客户端必须展示《用户服务协议》和《隐私政策》，并由用户主动勾选同意。`orderService` 仅接受显式传入 `privacyConsent: true` 的资料保存和下单请求，同时把当前协议版本和同意时间记录到 `users`；未同意时返回 `PRIVACY_CONSENT_REQUIRED`。

未完善头像和昵称时，个人中心不展示默认地址和订单概览，订单列表及订单详情接口也会返回 `LOGIN_REQUIRED`，不会向客户端返回订单数据。完善资料后，页面才按当前 OpenID 加载相应地址和订单。

购物车当前保存在小程序本地存储，键格式为 `laifeng_cart_items:{userId}`，其中 `userId` 来自云函数识别的当前 OpenID。未登录时禁止读取和写入购物车。旧版本的全局键 `laifeng_cart_items` 不再读取，也不会自动归属给任一用户，避免同一设备上的数据串号。

混合购物车结算时，`orderService` 在同一事务中按商品业务字段自动分组，最多形成实体商品、到店服务和上门服务 3 个订单。每个服务 SKU 可以分别选择办理方式，服务端会重新读取商品允许的 `fulfillmentTypes`，不能由客户端绕过。预约时间只写入需要预约的上门服务订单；实体商品和到店服务订单的 `appointment` 固定为 `null`。`finite` 商品在事务内扣减库存，`unlimited` 服务不扣减库存。任一商品校验或库存扣减失败时，全部订单一起回滚。

## 十、结构同步规则

1. `DB.md` 是结构基准，业务规划附录不是已部署数据清单。
2. 修改集合或字段前，先搜索小程序、云函数和后台配置中的全部调用方。
3. 云端结构、权限或索引变更后，同步更新本文档的“已部署”部分。
4. 字段迁移应先兼容读取，再迁移数据，最后删除旧字段；不能直接删除 `skus` 等兼容字段。
5. 金额统一存为 `number`，库存统一存为非负整数，状态字段不得混用字符串和数字。
6. 商品图片只保存稳定的云文件 ID，不把临时访问 URL 写入数据库。
7. 当前数据由云开发后台维护，新增记录必须符合本节字段约束。

## 十一、已部署商品目录

以下商品与 SKU 已录入云端，当前商品均已配置主图。

### 集合与商品目录

下方 `cat_01` 等名称仅是规划别名，不是云端真实 `_id`。商品写入时必须使用 `shop_firstType` 中实际存在的 `_id` 作为 `categoryId`。

```
云开发数据库
├── shop_firstType（一级分类表，已部署）
│   ├── cat_01 手机相关
│   ├── cat_02 电脑相关
│   ├── cat_03 办公打印及耗材
│   ├── cat_04 各类家电维修
│   ├── cat_05 图文视频
│   ├── cat_06 网络相关
│   ├── cat_07 监控安防
│   ├── cat_08 上门维修
│   └── cat_09 数码配件
│
├── goods（商品表）
│   ├── 手机相关
│   │   ├── 老年机
│   │   │   ├── SKU1: 189档（¥189/库存8）
│   │   │   ├── SKU2: 259档（¥259/库存6）
│   │   │   └── SKU3: 329档（¥329/库存6）
│   │   ├── 充电器
│   │   │   ├── SKU1: 氮化镓快充套餐（¥45/库存8）
│   │   │   ├── SKU2: 快充头（¥39/库存15）
│   │   │   └── SKU3: 120W快充头（¥59/库存20）
│   │   ├── 数据线
│   │   │   ├── SKU1: 2.4A数据线（¥15/库存30）
│   │   │   ├── SKU2: 6A快充线（¥25/库存20）
│   │   │   └── SKU3: Type-C线（¥12/库存25）
│   │   ├── 手机支架
│   │   │   ├── SKU1: 手机支架（¥28/库存15）
│   │   ├── 手机贴膜
│   │   │   ├── SKU1: 钢化膜（¥20/库存30）
│   │   │   ├── SKU2: 水凝膜（¥25/库存20）
│   │   │   ├── SKU3: 普通膜（¥10/库存25）
│   │   ├── 换屏服务
│   │   │   ├── SKU1: 手机换屏（¥1/库存999）
│   │   └── 换电池服务
│   │       ├── SKU1: iPhone换电池（¥89/库存999）
│   │       ├── SKU2: 换电池（¥59/库存999）
│   │
│   ├── 电脑相关
│   │   ├── 键盘
│   │   │   ├── SKU1: 键盘（¥59/库存20）
│   │   ├── 鼠标【2级规格】
│   │   │   ├── SKU1: 黑色有线鼠标（¥25/库存20）
│   │   │   ├── SKU2: 黑色无线鼠标（¥39/库存15）
│   │   │   ├── SKU3: 白色有线鼠标（¥25/库存18）
│   │   │   └── SKU4: 白色无线鼠标（¥39/库存12）
│   │   ├── 主板
│   │   │   ├── SKU1: 技嘉H410M（¥399/库存5）
│   │   │   └── SKU2: 其他主板（¥299起/库存3）
│   │   ├── 电源
│   │   │   ├── SKU1: 公牛电源（¥89/库存10）
│   │   │   └── SKU2: 电脑电源（¥129/库存6）
│   │   ├── 电脑维修
│   │   │   ├── SKU1: 笔记本维修（¥20检修费(若决定修,免检修费)/库存999）
│   │   │   └── SKU2: 台式机维修（¥20检修费(若决定修,免检修费)/库存999）
│   │   ├── 装系统
│   │   │   ├── SKU1: Windows重装（¥50/库存999）
│   │   │   └── SKU2: Mac重装（¥80/库存999）
│   │   ├── 电脑清灰
│   │   │   ├── SKU1: 笔记本清灰（¥50/库存999）
│   │   │   └── SKU2: 台式机清灰（¥80/库存999）
│   │   └── 电脑升级
│   │       ├── SKU1: 加内存（¥120起/库存999）
│   │       └── SKU2: 换固态硬盘（¥150起/库存999）
│   │
│   ├── 办公打印及耗材
│   │   ├── 复印打印
│   │   │   ├── SKU1: 黑白打/复印（¥2/张/库存999）
│   │   │   ├── SKU2: 彩色打/复印（¥4/张/库存999）
│   │   │   └── SKU4: 相纸打印（¥5/张(起)/库存999）
│   │   ├── 文档排版
│   │   │   ├── SKU1: Word排版（¥20起/库存999）
│   │   │   ├── SKU2: 文档录入（¥30起/库存999）
│   │   ├── 证件照
│   │   │   ├── SKU1: 一寸证件照（¥9/库存999）
│   │   │   ├── SKU2: 二寸证件照（¥15/库存999）
│   │   └── 打印耗材
│   │       ├── SKU1: 碳粉（¥30起/库存10）
│   │       ├── SKU2: 硒鼓（¥80起/库存8）
│   │       ├── SKU3: 粉盒（¥50起/库存12）
│   │       ├── SKU4: 墨水（¥20/瓶/库存15）
│   │       └── SKU5: 色带（¥15/条/库存20）
│   │
│   ├── 各类家电维修
│   │   ├── 小件电器
│   │   │   ├── SKU1: 电饭煲/电风扇/微波炉/电磁炉等（¥10检修费(若决定修,免检修费)/库存999）
│   │   └── 大件电器
│   │       └── SKU1: 洗衣机/空调/冰箱/音响等（¥15检修费(若决定修,免检修费)/库存999）

│   ├── 图文视频
│   │   ├── 视频剪辑
│   │   │   ├── SKU1: 视频剪辑（¥180/条(起)/库存999）
│   │   └── 照片修图
│   │       └── SKU1: 修头像（¥20/张/库存999）
│   │
│   ├── 网络相关
│   │   ├── 路由器
│   │   │   ├── SKU1: 450M路由（¥99/库存10）
│   │   │   └── SKU2: AX300 Wi-Fi6路由（¥199/库存8）
│   │   ├── 交换机
│   │   │   ├── SKU1: 百兆交换机（¥49/库存12）
│   │   │   └── SKU2: 千兆交换机（¥89/库存6）
│   │   ├── 网线
│   │   │   ├── SKU1: 六类网线（¥3/米/库存100）
│   │   │   ├── SKU2: 超五类网线（¥2/米/库存120）
│   │   │   └── SKU3: 网线成品（¥15起/库存20）
│   │   ├── 网络布线
│   │   │   ├── SKU1: 家庭网络布线（¥200起/库存999）
│   │   │   └── SKU2: 办公室网络布线（¥500起/库存999）
│   │   └── 网络工具
│   │       ├── SKU1: 水晶头（¥10/盒/库存20）
│   │       ├── SKU2: 网线钳（¥25/库存10）
│   │       └── SKU3: 测线仪（¥20/库存8）
│   │
│   ├── 监控安防
│   │   ├── 监控摄像机
│   │   │   ├── SKU1: 室内摄像头（¥99(起)/库存10）
│   │   ├── 监控线材
│   │   │   ├── SKU1: 监控综合线（¥2/米/库存80）
│   │   │   ├── SKU2: 电源线（¥1.5/米/库存100）
│   │   │   └── SKU3: 信号线（¥1/米/库存120）
│   │   └── 监控安装
│   │       ├── SKU1: 室内摄像头安装（¥100/个/库存999）
│   │       ├── SKU2: 室外摄像头安装（¥150/个/库存999）
│   │       └── SKU3: 多点位安装（¥80/点起/库存999）
│   │
│   ├── 上门维修
│   │   ├── 电脑上门维修
│   │   │   ├── SKU1: 上门修电脑（¥50+维修费/库存999）
│   │   │   └── SKU3: 上门装系统（¥80/库存999）
│   │   └── 家电上门维修
│   │       └── SKU1: 各类家电维修（上门费¥80(根据路程计费)/库存999）
│   │
│   └── 数码配件
│       ├── 扩展坞
│       │   ├── SKU1: Type-C扩展坞（¥89/库存8）
│       │   └── SKU2: HDMI转换器（¥25/库存15）
│       ├── 耳机
│       │   ├── SKU1: 有线耳机（¥20/库存10）
│       │   ├── SKU2: 无线耳机（¥60/库存10）
│       │   ├── SKU3: 运动耳机（¥80/库存5）
│       │   └── SKU4: 头戴式耳机（¥69/库存4）
│       ├── 充电宝
│       │   └── SKU1: 充电宝（¥80/库存6）
│       ├── 遥控器
│       │   └── SKU1: 通用遥控器（¥15/库存20）
│       └── 音响
│           └── SKU1: 音响（¥45/库存8）
│
├── users（用户表，已部署，当前0条）
│   └── （结算联系人和最近地址）
│
├── orders（订单表，已部署，当前0条）
│   └── （订单记录、商品快照和状态记录）
│
└── top-banner（轮播图表，已部署）
    └── （首页轮播图配置）
```


## 十二、已部署数据统计

| 一级分类 | 商品数 | SKU 总数 | 实物/服务 |
|----------|--------|----------|-----------|
| 手机相关 | 6 | 13 | 3实物+3服务 |
| 电脑相关 | 8 | 17 | 4实物+4服务 |
| 办公打印及耗材 | 4 | 12 | 1实物+3服务 |
| 各类家电维修 | 2 | 2 | 0实物+2服务 |
| 图文视频 | 2 | 2 | 0实物+2服务 |
| 网络相关 | 5 | 12 | 4实物+1服务 |
| 监控安防 | 3 | 7 | 2实物+1服务 |
| 上门维修 | 2 | 3 | 0实物+2服务 |
| 数码配件 | 5 | 9 | 5实物+0服务 |
| **总计** | **37** | **77** | **实物19 + 服务18** |

---

## 十三、SKU 库存类型说明

| 类型 | 库存值 | 适用商品 |
|------|--------|----------|
| `finite` 实体商品 | 3~120 | 充电器、数据线、键盘、鼠标、耗材等；下单时扣减库存 |
| `unlimited` 服务 | 当前兼容值 `999` | 维修、清灰、装系统、打印、证件照等；下单时不扣减库存 |

SKU 总数会随你进货情况动态变化。
