require('dotenv').config();

const axios = require('axios');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

/* ================= CONSTANTS ================= */
const COST_PER_LITER = 10;

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

/* ================= LIMITS ================= */
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

function getRemainingTime() {
  const diff = getNextISTMidnightTimestamp() - Date.now();
  const h = Math.floor(diff / (1000 * 60 * 60));
  const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${h}h ${m}m`;
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

/* ================= RESET HELPERS ================= */
function resetUserCompletely(obj) {
  obj.usedToday = 0;
  obj.dailyLimit = obj.baseLimit;
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

  const limit = obj.dailyLimit;
  const used = obj.usedToday;
  const warningLimit = limit * 0.8;

  let status = 'normal';

  if (used >= limit) {
    status = 'exceeded';

    if (obj.lastAlert !== 'exceeded') {
      sendTelegramAlert(
        `🚫 *WATER LIMIT REACHED*\n\nBorewell: ${borewellNo}\nUsed: ${used.toFixed(1)} / ${limit} L`
      );
      obj.lastAlert = 'exceeded';
    }
  } else if (used >= warningLimit) {
    status = 'warning';

    if (obj.lastAlert !== 'warning') {
      sendTelegramAlert(
        `⚠️ *WATER USAGE WARNING*\n\nBorewell: ${borewellNo}\nUsed: ${used.toFixed(1)} / ${limit} L`
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

    // ================= ORIGINAL DATA =================
    dailyLimit: limit,
    usedToday: used,
    remainingLitre: Math.max(0, limit - used),
    remainingTime: getRemainingTime(),
    nextResetAt: getNextISTMidnightTimestamp(),
    status,
    extraLitersPurchased: obj.extraLitersPurchased,
    totalExtraAmountPaid: obj.totalExtraAmountPaid,

    // ================= 🔥 RELAY DATA (ADDED) =================
    totalAllowed: limit,
    relayState: used >= limit ? 'OFF' : 'ON'
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
      ws.send(JSON.stringify({
        type: 'update',
        data: calculateDashboardData(
          getUserData(data.userId, data.borewellNo),
          data.userId,
          data.borewellNo
        )
      }));
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

// ESP32 incremental usage
app.post('/api/water-usage', (req, res) => {
  const { userId, borewellNo, litersUsed } = req.body;

  if (litersUsed === undefined || litersUsed < 0) {
    return res.status(400).json({ error: 'litersUsed required' });
  }

  const obj = getUserData(userId, borewellNo);
  checkAndResetDaily(obj);

  const increment = Number(litersUsed);

  // 🔒 HARD CAP: never exceed limit
  obj.usedToday = Math.min(
    obj.usedToday + increment,
    obj.dailyLimit
  );

  const data = calculateDashboardData(obj, userId, borewellNo);

  broadcastToUser(userId, borewellNo, {
    type: 'update',
    data
  });

  res.json({ success: true, data });
});


// Recharge
app.post('/api/recharge', (req, res) => {
  const { userId, borewellNo, extraLiters } = req.body;

  if (!extraLiters || extraLiters <= 0) {
    return res.status(400).json({ error: 'Invalid liters amount' });
  }

  const obj = getUserData(userId, borewellNo);
  const liters = Number(extraLiters);
  const amount = liters * COST_PER_LITER;

  obj.dailyLimit += liters;
  obj.extraLitersPurchased += liters;
  obj.totalExtraAmountPaid += amount;
  obj.status = 'normal';
  obj.lastAlert = null;

  const data = calculateDashboardData(obj, userId, borewellNo);
  broadcastToUser(userId, borewellNo, { type: 'update', data });

  res.json({ success: true, amountPaid: amount, data });
});

// ✅ SINGLE, CORRECT RESET ENDPOINT
app.post('/api/reset-usage', (req, res) => {
  const { userId, borewellNo } = req.body;

  if (!userId || !borewellNo) {
    return res.status(400).json({ error: 'userId and borewellNo required' });
  }

  const obj = getUserData(userId, borewellNo);
  resetUserCompletely(obj);
  obj.lastReset = getTodayISTMidnightTimestamp();

  const data = calculateDashboardData(obj, userId, borewellNo);
  broadcastToUser(userId, borewellNo, { type: 'update', data });

  console.log(`🔄 Manual reset for ${userId}-${borewellNo}`);
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
