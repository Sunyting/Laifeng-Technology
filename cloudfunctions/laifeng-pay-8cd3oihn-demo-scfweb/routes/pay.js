const express = require('express');
const payController = require('../controllers/payController');

const router = express.Router();

router.post('/order', payController.payMiddleware, payController.businessOrder);
router.post('/query', payController.payMiddleware, payController.businessQuery);
router.post('/unifiedOrderTrigger', payController.unifiedOrderTrigger);
router.post('/refundTrigger', payController.refundTrigger);

module.exports = router;
