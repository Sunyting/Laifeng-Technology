const test = require('node:test');
const assert = require('node:assert/strict');
const OrderService = require('../services/orderService');

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const resolveUpdateValue = (value) => {
    if (value && value.__memoryCommand === 'set') return clone(value.value);
    return clone(value);
};

class MemoryDocument {
    constructor(store, collectionName, id) {
        this.store = store;
        this.collectionName = collectionName;
        this.id = id;
    }

    async get() {
        return { data: clone(this.store[this.collectionName].get(this.id) || null) };
    }

    async set({ data }) {
        this.store[this.collectionName].set(this.id, { _id: this.id, ...clone(data) });
        return {};
    }

    async update({ data }) {
        const current = this.store[this.collectionName].get(this.id);
        if (!current) throw new Error(`document not found: ${this.collectionName}/${this.id}`);
        const update = Object.fromEntries(
            Object.entries(data).map(([key, value]) => [key, resolveUpdateValue(value)])
        );
        this.store[this.collectionName].set(this.id, { ...current, ...update });
        return {};
    }
}

class MemoryCollection {
    constructor(store, name) {
        this.store = store;
        this.name = name;
    }

    doc(id) {
        return new MemoryDocument(this.store, this.name, id);
    }
}

class MemoryDatabase {
    constructor(seed) {
        this.command = {
            set: (value) => ({ __memoryCommand: 'set', value: clone(value) })
        };
        this.store = {
            orders: new Map(Object.entries(seed.orders || {})),
            payments: new Map(Object.entries(seed.payments || {}))
        };
    }

    collection(name) {
        return new MemoryCollection(this.store, name);
    }

    async runTransaction(handler) {
        return handler(this);
    }
}

const ORDER_ID = 'LFT202607311200001234';
const NOW = 1785470400000;

const createOrder = (overrides = {}) => ({
    _id: ORDER_ID,
    orderNo: ORDER_ID,
    userId: 'openid-owner',
    items: [{ name: '换屏服务' }],
    onlinePayableAmountCents: 3000,
    paidAmountCents: 0,
    paymentStatus: 'unpaid',
    currentPaymentId: null,
    paymentExpiresAt: null,
    status: 'pending_payment',
    statusHistory: [{ status: 'pending_payment', createdAt: NOW }],
    ...overrides
});

const createService = (order = createOrder()) => {
    const db = new MemoryDatabase({ orders: { [ORDER_ID]: order } });
    return { db, service: new OrderService({ db, now: () => NOW }) };
};

test('不能为其他用户的订单创建支付单', async () => {
    const { db, service } = createService();
    await assert.rejects(
        service.preparePayment(ORDER_ID, 'openid-other'),
        (error) => error.code === 'ORDER_FORBIDDEN'
    );
    assert.equal(db.store.payments.size, 0);
});

test('统一下单金额只来自数据库订单', async () => {
    const { service } = createService();
    const { order, payment } = await service.preparePayment(
        ORDER_ID,
        'openid-owner',
        { amountCents: 1 }
    );
    const params = service.buildUnifiedOrderParams(order, payment);
    assert.deepEqual(params.amount, { total: 3000, currency: 'CNY' });
    assert.equal(params.payer.openid, 'openid-owner');
    assert.equal(params.time_expire, new Date(NOW + 30 * 60 * 1000).toISOString());
});

test('支付参数可以整体替换旧支付单中的 null 字段', async () => {
    const { db, service } = createService();
    const { payment } = await service.preparePayment(ORDER_ID, 'openid-owner');
    const storedPayment = db.store.payments.get(payment._id);
    storedPayment.paymentParams = null;
    const paymentParams = {
        timeStamp: '1785470400',
        nonceStr: 'nonce',
        package: 'prepay_id=wx-prepay-id',
        signType: 'RSA',
        paySign: 'signature'
    };

    await service.savePaymentParams(payment._id, paymentParams, 'request-id');

    assert.deepEqual(db.store.payments.get(payment._id).paymentParams, paymentParams);
    assert.equal(db.store.payments.get(payment._id).requestId, 'request-id');
});

test('支付回调金额不一致时拒绝更新', async () => {
    const { db, service } = createService();
    const { payment } = await service.preparePayment(ORDER_ID, 'openid-owner');

    await assert.rejects(
        service.confirmPaid({
            out_trade_no: payment._id,
            transaction_id: 'wx-transaction-1',
            trade_state: 'SUCCESS',
            amount: { total: 1, currency: 'CNY' },
            payer: { openid: 'openid-owner' }
        }),
        (error) => error.code === 'PAYMENT_AMOUNT_MISMATCH'
    );
    assert.equal(db.store.payments.get(payment._id).status, 'pending');
    assert.equal(db.store.orders.get(ORDER_ID).paymentStatus, 'paying');
});

test('支付回调用户不一致时拒绝更新', async () => {
    const { db, service } = createService();
    const { payment } = await service.preparePayment(ORDER_ID, 'openid-owner');

    await assert.rejects(
        service.confirmPaid({
            out_trade_no: payment._id,
            transaction_id: 'wx-transaction-1',
            trade_state: 'SUCCESS',
            amount: { total: 3000, currency: 'CNY' },
            payer: { openid: 'openid-other' }
        }),
        (error) => error.code === 'PAYMENT_USER_MISMATCH'
    );
    assert.equal(db.store.payments.get(payment._id).status, 'pending');
    assert.equal(db.store.orders.get(ORDER_ID).paymentStatus, 'paying');
});

test('成功回调更新订单和支付单，重复回调保持幂等', async () => {
    const { db, service } = createService();
    const { payment } = await service.preparePayment(ORDER_ID, 'openid-owner');
    const callback = {
        out_trade_no: payment._id,
        transaction_id: 'wx-transaction-1',
        trade_state: 'SUCCESS',
        amount: { total: 3000, currency: 'CNY' },
        payer: { openid: 'openid-owner' }
    };

    assert.equal(await service.confirmPaid(callback), true);
    assert.equal(await service.confirmPaid(callback), true);

    const storedPayment = db.store.payments.get(payment._id);
    const storedOrder = db.store.orders.get(ORDER_ID);
    assert.equal(storedPayment.status, 'paid');
    assert.equal(storedPayment.transactionId, 'wx-transaction-1');
    assert.equal(storedPayment.paidAt, NOW);
    assert.equal(storedOrder.paymentStatus, 'paid');
    assert.equal(storedOrder.status, 'pending_confirmation');
    assert.deepEqual(storedOrder.statusHistory.at(-1), {
        status: 'pending_confirmation',
        createdAt: NOW
    });
    assert.equal(storedOrder.paidAmountCents, 3000);
    assert.equal(storedOrder.paidAt, NOW);
});
