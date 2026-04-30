require('dotenv').config();

const axios = require('axios');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const Razorpay = require('razorpay');
const crypto = require('crypto');

/* ================= CONSTANTS ================= */
const COST_PER_LITER = 10;

/* ================= RAZORPAY ================= */
const razorpay = new Razorpay({
  key_id: process.env.REACT_APP_RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/* ================= TELEGRAM ================= */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/* ================= APP ================= */
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

/* ================= TELEGRAM ALERT ================= */
async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      }
    );
  } catch (err) {
    console.error('Telegram error:', err.message);
  }
}

/* ================= USAGE LIMITS ================= */
const USAGE_LIMITS = {
  home: 100,
  apartment: 500,
  commercial: 2000,
  industry: 5000
};

/* ================= DATA STORE ================= */
const userData = new Map();

/* ================= TIME (IST) ================= */
function getNextISTMidnightTimestamp() {
  const now = new Date();
  const ist = new Date(
    now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  );

  const msToday =
    ist.getHours() * 3600000 +
    ist.getMinutes() * 60000 +
    ist.getSeconds() * 1000 +
    ist.getMilliseconds();

  return Date.now() + (86400000 - msToday);
}

function getTodayISTMidnightTimestamp() {
  return getNextISTMidnightTimestamp() - 86400000;
}

/* ================= USER INIT ================= */
function getUserData(userId, borewellNo) {
  const key = `${userId}_${borewellNo}`;

  if (!userData.has(key)) {
    userData.set(key, {
      name: `User ${userId}`,
      borewellNo,
      usageType: 'home',

      usedToday: 0,
      extraLitersPurchased: 0,
      totalExtraAmountPaid: 0,

      status: 'normal',
      lastAlert: null,
      lastReset: getTodayISTMidnightTimestamp(),

      lastSeen: null
    });
  }

  return userData.get(key);
}

/* ================= RESET HELPERS ================= */
function resetUserCompletely(obj) {
  obj.usedToday = 0;
  obj.extraLitersPurchased = 0;
  obj.totalExtraAmountPaid = 0;
  obj.status = 'normal';
  obj.lastAlert = null;
}

/* ================= DAILY RESET ================= */
function checkAndResetDaily(obj) {
  const todayMidnight = getTodayISTMidnightTimestamp();

  if (obj.lastReset < todayMidnight) {
    resetUserCompletely(obj);
    obj.lastReset = todayMidnight;
  }
}

/* ================= DASHBOARD LOGIC ================= */
function calculateDashboardData(obj, userId, borewellNo) {
  checkAndResetDaily(obj);

  const baseLimit =
    USAGE_LIMITS[obj.usageType] || USAGE_LIMITS.home;

  const totalAllowed =
    baseLimit + obj.extraLitersPurchased;

  const used = obj.usedToday;
  const warningLimit = totalAllowed * 0.8;

  let status = 'normal';

  if (used >= totalAllowed) {
    status = 'exceeded';

    if (obj.lastAlert !== 'exceeded') {
      sendTelegramAlert(
        `🚫 *WATER LIMIT REACHED*\n\nBorewell: ${borewellNo}\nUsed: ${used.toFixed(
          1
        )} / ${totalAllowed} L`
      );
      obj.lastAlert = 'exceeded';
    }
  } else if (used >= warningLimit) {
    status = 'warning';

    if (obj.lastAlert !== 'warning') {
      sendTelegramAlert(
        `⚠️ *WATER USAGE WARNING*\n\nBorewell: ${borewellNo}\nUsed: ${used.toFixed(
          1
        )} / ${totalAllowed} L`
      );
      obj.lastAlert = 'warning';
    }
  } else {
    obj.lastAlert = null;
  }

  obj.status = status;

  return {
    name: obj.name,
    borewellNo,
    usageType: obj.usageType,

    dailyLimit: baseLimit,
    usedToday: used,
    remainingLitre: Math.max(0, totalAllowed - used),
    nextResetAt: getNextISTMidnightTimestamp(),
    status,

    extraLitersPurchased: obj.extraLitersPurchased,
    totalExtraAmountPaid: obj.totalExtraAmountPaid,

    lastSeen: obj.lastSeen,

    totalAllowed,
    relayState: used >= totalAllowed ? 'OFF' : 'ON'
  };
}

/* ================= WEBSOCKET ================= */
function broadcastToUser(userId, borewellNo, payload) {
  const key = `${userId}_${borewellNo}`;

  wss.clients.forEach(client => {
    if (
      client.readyState === WebSocket.OPEN &&
      client.userKey === key
    ) {
      client.send(JSON.stringify(payload));
    }
  });
}

wss.on('connection', ws => {
  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'subscribe') {
        ws.userKey = `${data.userId}_${data.borewellNo}`;
        ws.send(
          JSON.stringify({
            type: 'update',
            data: calculateDashboardData(
              getUserData(data.userId, data.borewellNo),
              data.userId,
              data.borewellNo
            )
          })
        );
      }
    } catch (e) {
      console.error('Invalid WebSocket message');
    }
  });
});

/* ================= API ================= */

// Dashboard
app.get('/api/dashboard/:userId/:borewellNo', (req, res) => {
  res.json(
    calculateDashboardData(
      getUserData(req.params.userId, req.params.borewellNo),
      req.params.userId,
      req.params.borewellNo
    )
  );
});

// Update usage type
app.post('/api/update-usage-type', (req, res) => {
  const { userId, borewellNo, usageType } = req.body;

  if (!USAGE_LIMITS[usageType]) {
    return res.status(400).json({ error: 'Invalid usage type' });
  }

  const obj = getUserData(userId, borewellNo);

  if (obj.usedToday > 0) {
    return res.status(403).json({
      error: 'Usage type locked once water usage has started'
    });
  }

  obj.usageType = usageType;
  obj.lastAlert = null;

  const data = calculateDashboardData(obj, userId, borewellNo);
  broadcastToUser(userId, borewellNo, { type: 'update', data });

  res.json({ success: true, data });
});

// ESP32 usage
app.post('/api/water-usage', (req, res) => {
  const { userId, borewellNo, litersUsed } = req.body;

  if (litersUsed === undefined || litersUsed < 0) {
    return res.status(400).json({ error: 'litersUsed required' });
  }

  const obj = getUserData(userId, borewellNo);

  obj.lastSeen = Date.now();
  checkAndResetDaily(obj);

  const increment = Number(litersUsed);

  const baseLimit =
    USAGE_LIMITS[obj.usageType] || USAGE_LIMITS.home;

  const totalAllowed =
    baseLimit + obj.extraLitersPurchased;

  obj.usedToday = Math.min(
    obj.usedToday + increment,
    totalAllowed
  );

  const data = calculateDashboardData(obj, userId, borewellNo);
  broadcastToUser(userId, borewellNo, { type: 'update', data });

  res.json({ success: true, data });
});

/* ================= RAZORPAY ================= */

// Create order
app.post('/api/create-order', async (req, res) => {
  const { userId, borewellNo, extraLiters } = req.body;

  if (!extraLiters || extraLiters <= 0) {
    return res.status(400).json({ error: 'Invalid liters amount' });
  }

  const liters = Number(extraLiters);
  const amount = liters * COST_PER_LITER * 100;

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: `water_${userId}_${borewellNo}_${Date.now()}`,
      notes: { userId, borewellNo, liters }
    });

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Order creation failed' });
  }
});

// Verify payment
app.post('/api/verify-payment', async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body;

  try {
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const order = await razorpay.orders.fetch(razorpay_order_id);
    const { userId, borewellNo, liters } = order.notes;

    const obj = getUserData(userId, borewellNo);
    const amount = Number(liters) * COST_PER_LITER;

    obj.extraLitersPurchased += Number(liters);
    obj.totalExtraAmountPaid += amount;
    obj.lastAlert = null;

    const data = calculateDashboardData(obj, userId, borewellNo);
    broadcastToUser(userId, borewellNo, { type: 'update', data });

    res.json({ success: true, amountPaid: amount, data });
  } catch (err) {
    console.error('Payment verification error:', err.message);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// Manual reset
app.post('/api/reset-usage', (req, res) => {
  const { userId, borewellNo } = req.body;

  if (!userId || !borewellNo) {
    return res
      .status(400)
      .json({ error: 'userId and borewellNo required' });
  }

  const obj = getUserData(userId, borewellNo);
  resetUserCompletely(obj);
  obj.lastReset = getTodayISTMidnightTimestamp();

  const data = calculateDashboardData(obj, userId, borewellNo);
  broadcastToUser(userId, borewellNo, { type: 'update', data });

  res.json({ success: true, data });
});

/* ================= FRONTEND ================= */
app.use(express.static(path.join(__dirname, '../frontend/build')));
app.get('*', (_, res) =>
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'))
);

/* ================= START ================= */
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
