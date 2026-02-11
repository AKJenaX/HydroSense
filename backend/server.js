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

/* ================= RAZORPAY INIT ================= */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/* ================= TELEGRAM ================= */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/* ================= APP SETUP ================= */
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

/* ================= LIMITS ================= */
const USAGE_LIMITS = {
  home: 100,
  apartment: 500,
  commercial: 2000,
  industry: 5000
};

/* ================= USER STORE ================= */
const userData = new Map();

/* ================= TIME HELPERS ================= */

function getNextISTMidnightTimestamp() {
  const now = new Date();
  const istNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );

  const msToday =
    istNow.getHours() * 3600000 +
    istNow.getMinutes() * 60000 +
    istNow.getSeconds() * 1000 +
    istNow.getMilliseconds();

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
      baseLimit: USAGE_LIMITS.home,
      dailyLimit: USAGE_LIMITS.home,
      usedToday: 0,
      extraLitersPurchased: 0,
      totalExtraAmountPaid: 0,
      status: 'normal',
      lastAlert: null,
      lastReset: getTodayISTMidnightTimestamp()
    });
  }

  return userData.get(key);
}

/* ================= DAILY RESET ================= */

function checkAndResetDaily(obj) {
  const todayMidnight = getTodayISTMidnightTimestamp();

  if (obj.lastReset < todayMidnight) {
    obj.usedToday = 0;
    obj.dailyLimit = obj.baseLimit;
    obj.extraLitersPurchased = 0;
    obj.totalExtraAmountPaid = 0;
    obj.status = 'normal';
    obj.lastAlert = null;
    obj.lastReset = todayMidnight;
  }
}

/* ================= DASHBOARD LOGIC ================= */

function calculateDashboardData(obj, userId, borewellNo) {
  checkAndResetDaily(obj);

  const limit = obj.dailyLimit;
  const used = obj.usedToday;
  const warningLimit = limit * 0.8;

  let status = 'normal';

  if (used >= limit) {
    status = 'exceeded';
  } else if (used >= warningLimit) {
    status = 'warning';
  }

  obj.status = status;

  return {
    name: obj.name,
    borewellNo,
    usageType: obj.usageType,
    dailyLimit: limit,
    usedToday: used,
    remainingLitre: Math.max(0, limit - used),
    nextResetAt: getNextISTMidnightTimestamp(),
    status,
    extraLitersPurchased: obj.extraLitersPurchased,
    totalExtraAmountPaid: obj.totalExtraAmountPaid
  };
}

/* ================= WEBSOCKET ================= */

function broadcastToUser(userId, borewellNo, payload) {
  const key = `${userId}_${borewellNo}`;

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.userKey === key) {
      client.send(JSON.stringify(payload));
    }
  });
}

wss.on('connection', ws => {
  ws.on('message', msg => {
    const data = JSON.parse(msg);

    if (data.type === 'subscribe') {
      ws.userKey = `${data.userId}_${data.borewellNo}`;

      const dashboardData = calculateDashboardData(
        getUserData(data.userId, data.borewellNo),
        data.userId,
        data.borewellNo
      );

      ws.send(JSON.stringify({ type: 'update', data: dashboardData }));
    }
  });
});

/* ================= API ROUTES ================= */

// Dashboard
app.get('/api/dashboard/:userId/:borewellNo', (req, res) => {
  const { userId, borewellNo } = req.params;
  const obj = getUserData(userId, borewellNo);
  res.json(calculateDashboardData(obj, userId, borewellNo));
});

/* ================= CREATE ORDER ================= */

app.post('/api/create-order', async (req, res) => {
  try {
    const { userId, borewellNo, extraLiters } = req.body;

    if (!extraLiters || extraLiters <= 0)
      return res.status(400).json({ error: "Invalid liters" });

    const amount = extraLiters * COST_PER_LITER * 100;

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `${userId}_${borewellNo}_${Date.now()}`
    });

    res.json({
      orderId: order.id,
      amount
    });

  } catch (err) {
    res.status(500).json({ error: "Order creation failed" });
  }
});

/* ================= VERIFY PAYMENT ================= */

app.post('/api/verify-payment', (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    userId,
    borewellNo,
    extraLiters
  } = req.body;

  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    return res.status(400).json({ error: "Payment verification failed" });
  }

  // VERIFIED — Add liters
  const obj = getUserData(userId, borewellNo);

  const liters = Number(extraLiters);
  const amount = liters * COST_PER_LITER;

  obj.dailyLimit += liters;
  obj.extraLitersPurchased += liters;
  obj.totalExtraAmountPaid += amount;

  const dashboardData = calculateDashboardData(obj, userId, borewellNo);

  broadcastToUser(userId, borewellNo, {
    type: 'update',
    data: dashboardData
  });

  res.json({ success: true });
});

// Water Usage Update (ESP32 / Simulator)
app.post('/api/water-usage', (req, res) => {
  const { userId, borewellNo, totalLiters } = req.body;

  if (totalLiters === undefined) {
    return res.status(400).json({ error: 'totalLiters required' });
  }

  const obj = getUserData(userId, borewellNo);
  checkAndResetDaily(obj);

  let value = Number(totalLiters);
  if (isNaN(value) || value < 0) value = 0;

  obj.usedToday = value;

  const dashboardData = calculateDashboardData(obj, userId, borewellNo);

  broadcastToUser(userId, borewellNo, {
    type: 'update',
    data: dashboardData
  });

  res.json({ success: true, data: dashboardData });
});


/* ================= FRONTEND ================= */

app.use(express.static(path.join(__dirname, '../frontend/build')));
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'))
);

/* ================= START ================= */

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
