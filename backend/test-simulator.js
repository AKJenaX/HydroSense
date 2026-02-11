// Test script to simulate ESP32 sending water usage data
// This feeds the backend so the React dashboard updates

const axios = require('axios');

const SERVER_URL = 'http://localhost:3001/api/water-usage';

// Configuration
const config = {
  userId: '1',
  borewellNo: 'BW001',
  simulationInterval: 3000, // every 3 seconds
  flowRate: 2.5 // liters per interval
};

let totalSent = 0;
let interval = null;

async function sendWaterUsage() {
  try {
    const data = {
      userId: config.userId,
      borewellNo: config.borewellNo,
      litersUsed: config.flowRate
    };

    console.log(`\n📊 Sending ${config.flowRate}L to server...`);

    const response = await axios.post(SERVER_URL, data);

    totalSent += config.flowRate;

    console.log('✅ Server response:');
    console.log(`   Status: ${response.data.status}`);
    console.log(`   Remaining: ${response.data.remaining}L`);
    console.log(`   Message: ${response.data.message}`);
    console.log(`   Total sent: ${totalSent.toFixed(1)}L`);

    // 🔴 STOP simulation when limit exceeded
    if (response.data.status === 'exceeded') {
      console.log('\n🛑 LIMIT EXCEEDED');
      console.log('🚫 Water supply should now be OFF');
      console.log('⏹️  Stopping simulator');

      clearInterval(interval);
    }

  } catch (error) {
    console.error('❌ Error sending data:', error.message);
    if (error.response) {
      console.error('   Server says:', error.response.data);
    }
  }
}

// Startup logs
console.log('🚀 Starting water usage simulation');
console.log(`👤 User ID: ${config.userId}`);
console.log(`🚰 Borewell: ${config.borewellNo}`);
console.log(`💧 Flow rate: ${config.flowRate}L / ${config.simulationInterval / 1000}s`);
console.log('⏳ Press Ctrl+C to stop manually\n');

// Start simulation
sendWaterUsage();
interval = setInterval(sendWaterUsage, config.simulationInterval);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Simulation stopped manually');
  console.log(`📊 Total water sent: ${totalSent.toFixed(1)}L`);
  clearInterval(interval);
  process.exit(0);
});
