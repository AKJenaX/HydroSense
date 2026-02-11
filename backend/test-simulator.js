const axios = require("axios");

const API_BASE = "http://localhost:3001"; // local testing

const userId = 1;
const borewellNo = "BW001";

let currentUsage = 0;
let interval;

console.log("🚰 Water Usage Simulator Started...\n");

async function startFlow() {

  interval = setInterval(async () => {
    try {

      currentUsage += 15;

      console.log(`➡ Sending usage: ${currentUsage} L`);

      await axios.post(`${API_BASE}/api/water-usage`, {
        userId,
        borewellNo,
        totalLiters: currentUsage   // 🔥 THIS MUST BE totalLiters
      });

    } catch (err) {
      console.log("❌ Error:", err.response?.data || err.message);
    }

  }, 3000); // every 3 seconds
}

startFlow();
