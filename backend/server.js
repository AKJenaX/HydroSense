const axios = require('axios');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

// ================= CONSTANTS =================
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // IST = UTC + 5:30

// ================= TELEGRAM =================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ================= APP SETUP =================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// ================= TELEGRAM FUNCTION =================
async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("⚠️ Telegram ENV variables not set");
    return;
  }

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

// ================= USAGE TYPE LIMITS =================
const USAGE_LIMITS = {
  home: 100,
  apartment: 500,
  commercial: 2000,
  industry: 5000
};

// ================= USER STORE =================
const userData = new Map();

// ================= GET IST MIDNIGHT TIMESTAMP =================
function getISTMidnightTimestamp() {
  const nowUTC = Date.now();
  const nowIST = nowUTC + IST_OFFSET_MS;

  const istDate = new Date(nowIST);

  // Set to 00:00 IST
  istDate.setHours(0, 0, 0, 0);

  // Convert back to UTC timestamp
  return istDate.getTime() - IST_OFFSET_MS;
}

// ================= GET NEXT IST MIDNIGHT =================
function getNextISTMidnightTimestamp() {
  return getISTMidnightTimestamp() + 24 * 60 * 60 * 1000;
}

// ================= USER INIT =================
function getUserData(userId, borewellNo) {
  const key = `${userId}_${borewellNo}`;

  if (!userData.has(key)) {
    userData.set(key, {
      name: `User ${userId}`,
      borewellNo,
      usageType: 'home',
      dailyLimit: USAGE_LIMITS.home,
      usedToday: 0,
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
    obj.status = 'normal';
    obj.lastAlert = null;
    obj.lastReset = todayMidnight;
    console.log('🔄 Daily reset completed (IST)');
  }
}

// ================= TIME LEFT =================
function getRemainingTime() {
  const now = Date.now();
  const nextMidnight = getNextISTMidnightTimestamp();

  const diff = nextMidnight - now;

  const h = Math.floor(diff / (1000 * 60 * 60));
  const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return `${h}h ${m}m`;
}

// ================= DASHBOARD LOGIC =================
function calculateDashboardData(obj, userId, borewellNo) {
  checkAndResetDaily(obj);

  const limit = obj.dailyLimit;
  const used = obj.usedToday;
  const warningLimit = limit * 0.8;

  let status = obj.status;

  if (used >= limit) {
    status = 'exceeded';

    if (obj.lastAlert !== 'exceeded') {
      sendTelegramAlert(
        `🚫 *WATER LIMIT REACHED*\n\n` +
        `Borewell: ${borewellNo}\n` +
        `Usage Type: ${obj.usageType.toUpperCase()}\n` +
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
        `Usage Type: ${obj.usageType.toUpperCase()}\n` +
        `Used: ${used.toFixed(1)} / ${limit} L\n\n` +
        `⚠️ 80% limit crossed`
      );
      obj.lastAlert = 'warning';
    }
  } else {
    status = 'normal';
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
    status
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
      console.error('WebSocket parse error:', err.message);
    }
  });
});

// ================= API ROUTES =================
app.get('/api/dashboard/:userId/:borewellNo', (req, res) => {
  const { userId, borewellNo } = req.params;

  const obj = getUserData(userId, borewellNo);
  const dashboardData = calculateDashboardData(obj, userId, borewellNo);

  res.json(dashboardData);
});

app.post('/api/usage-type', (req, res) => {
  const { userId, borewellNo, usageType } = req.body;

  if (!USAGE_LIMITS[usageType]) {
    return res.status(400).json({ error: 'Invalid usage type' });
  }

  const obj = getUserData(userId, borewellNo);

  obj.usageType = usageType;
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

app.post('/api/water-usage', (req, res) => {
  const { userId, borewellNo, litersUsed } = req.body;

  const obj = getUserData(userId, borewellNo);
  checkAndResetDaily(obj);

  obj.usedToday += Number(litersUsed);
  obj.usedToday = Math.min(obj.usedToday, obj.dailyLimit);

  const dashboardData = calculateDashboardData(obj, userId, borewellNo);

  broadcastToUser(userId, borewellNo, {
    type: 'update',
    data: dashboardData
  });

  res.json({ success: true, data: dashboardData });
});

// ================= SERVE REACT FRONTEND =================
app.use(express.static(path.join(__dirname, '../frontend/build')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
