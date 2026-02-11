const axios = require('axios');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

// ================= CONSTANTS =================
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const COST_PER_LITER = 10;

// ================= TELEGRAM =================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ================= APP SETUP =================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// ================= TELEGRAM ALERT =================
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
    console.log('📨 Telegram alert sent');
  } catch (err) {
    console.error('❌ Telegram error:', err.message);
  }
}

// ================= LIMITS =================
const USAGE_LIMITS = {
  home: 100,
  apartment: 500,
  commercial: 2000,
  industry: 5000
};

// ================= USER STORE =================
const userData = new Map();

// ================= TIME HELPERS =================
function getISTMidnightTimestamp() {
  const nowUTC = Date.now();
  const nowIST = nowUTC + IST_OFFSET_MS;
  const istDate = new Date(nowIST);
  istDate.setHours(0, 0, 0, 0);
  return istDate.getTime() - IST_OFFSET_MS;
}

function getNextISTMidnightTimestamp() {
  return getISTMidnightTimestamp() + 24 * 60 * 60 * 1000;
}

function getRemainingTime() {
  const diff = getNextISTMidnightTimestamp() - Date.now();
  const h = Math.floor(diff / (1000 * 60 * 60));
  const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${h}h ${m}m`;
}

// ================= USER INIT =================
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
      lastReset: getISTMidnightTimestamp()
    });
  }

  return userData.get(key);
}

// ================= DAILY RESET =================
function checkAndResetDaily(obj) {
  const todayMidnight = getISTMidnightTimestamp();

  if (obj.lastReset < todayMidnight) {
    obj.usedToday = 0;
    obj.dailyLimit = obj.baseLimit;
    obj.extraLitersPurchased = 0;
    obj.totalExtraAmountPaid = 0;
    obj.status = 'normal';
    obj.lastAlert = null;
    obj.lastReset = todayMidnight;
    console.log('🔄 Daily reset completed (IST)');
  }
}

// ================= DASHBOARD LOGIC =================
function calculateDashboardData(obj, userId, borewellNo) {
  checkAndResetDaily(obj);

  const limit = obj.dailyLimit;
  const used = obj.usedToday;
  const warningLimit = limit * 0.8;

  let status = 'normal';

  if (used >= limit) {
    status = 'exceeded';

    if (obj.lastAlert !== 'exceeded') {
      sendTelegramAlert(
        `🚫 *WATER LIMIT REACHED*\n\n` +
        `Borewell: ${borewellNo}\n` +
        `Used: ${limit} / ${limit} L\n\n` +
        `❌ Supply stopped`
      );
      obj.lastAlert = 'exceeded';
    }

  } else if (used >= warningLimit) {
    status = 'warning';

    if (obj.lastAlert !== 'warning') {
      sendTelegramAlert(
        `⚠️ *WATER USAGE WARNING*\n\n` +
        `Borewell: ${borewellNo}\n` +
        `Used: ${used.toFixed(1)} / ${limit} L\n\n` +
        `⚠️ 80% limit crossed`
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
    dailyLimit: limit,
    usedToday: used,
    remainingLitre: Math.max(0, limit - used),
    remainingTime: getRemainingTime(),
    status,
    extraLitersPurchased: obj.extraLitersPurchased,
    totalExtraAmountPaid: obj.totalExtraAmountPaid
  };
}

// ================= WEBSOCKET =================
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
    try {
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
    } catch (err) {
      console.error('WebSocket error:', err.message);
    }
  });
});

// ================= API ROUTES =================

// Dashboard
app.get('/api/dashboard/:userId/:borewellNo', (req, res) => {
  const { userId, borewellNo } = req.params;
  const obj = getUserData(userId, borewellNo);
  res.json(calculateDashboardData(obj, userId, borewellNo));
});

// Change usage type
app.post('/api/usage-type', (req, res) => {
  const { userId, borewellNo, usageType } = req.body;

  if (!USAGE_LIMITS[usageType])
    return res.status(400).json({ error: 'Invalid usage type' });

  const obj = getUserData(userId, borewellNo);

  obj.usageType = usageType;
  obj.baseLimit = USAGE_LIMITS[usageType];
  obj.dailyLimit = USAGE_LIMITS[usageType];
  obj.usedToday = 0;
  obj.status = 'normal';
  obj.lastAlert = null;

  const dashboardData = calculateDashboardData(obj, userId, borewellNo);

  broadcastToUser(userId, borewellNo, {
    type: 'update',
    data: dashboardData
  });

  res.json({ success: true, data: dashboardData });
});

// Water Usage Update (ESP32 sync)
app.post('/api/water-usage', (req, res) => {
  const { userId, borewellNo, totalLiters } = req.body;

  if (totalLiters === undefined)
    return res.status(400).json({ error: 'totalLiters required' });

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

// Recharge Extra Liters
app.post('/api/recharge', (req, res) => {
  const { userId, borewellNo, extraLiters } = req.body;

  if (!extraLiters || extraLiters <= 0)
    return res.status(400).json({ error: "Invalid liters amount" });

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

  res.json({ success: true, amountPaid: amount, data: dashboardData });
});

// ================= FRONTEND =================
app.use(express.static(path.join(__dirname, '../frontend/build')));
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'))
);

// ================= START =================
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
