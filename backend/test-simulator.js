/**
 * test-simulator.js
 * Simulates ESP32 water flow updates
 */

const axios = require("axios");

/* ================= CONFIG ================= */
const SERVER_URL = "http://localhost:3001/api/water-usage"; 
// ⚠️ change to LAN IP if backend is on another machine

const USER_ID = "1";
const BOREWELL_NO = "BW001";

/* ================= SIMULATION SETTINGS ================= */
// liters per update (delta)
const MIN_LITERS = 15;   // very slow flow
const MAX_LITERS = 25;   // fast flow

// interval in milliseconds (same as ESP32: 2s)
const INTERVAL = 2000;

/* ================= STATE ================= */
let running = true;
let counter = 0;

/* ================= SIMULATOR ================= */
async function sendFakeFlow() {
  if (!running) return;

  // random flow delta
  const litersUsed =
    Math.random() * (MAX_LITERS - MIN_LITERS) + MIN_LITERS;

  const payload = {
    userId: USER_ID,
    borewellNo: BOREWELL_NO,
    litersUsed: Number(litersUsed.toFixed(3))
  };

  try {
    const res = await axios.post(SERVER_URL, payload);

    const data = res.data?.data;

    console.log(
      `#${++counter}  Sent: ${payload.litersUsed} L  | ` +
      `Used: ${data.usedToday.toFixed(2)} / ${data.dailyLimit} L  | ` +
      `Status: ${data.status}`
    );

    if (data.status === "exceeded") {
      console.log("🚨 LIMIT EXCEEDED – stopping simulator");
      running = false;
    }

  } catch (err) {
    console.error("❌ Error sending data:", err.message);
  }
}

/* ================= START ================= */
console.log("🚰 Water Flow Simulator Started");
console.log("Press CTRL + C to stop\n");

setInterval(sendFakeFlow, INTERVAL);
