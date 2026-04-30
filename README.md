# HydroSense: Smart Underground Water Monitoring System

## 🌊 Project Overview

HydroSense is an **IoT-based water monitoring and management system** designed for smart underground water distribution. It combines **ESP32 hardware, Node.js backend, React frontend, payment integration (Razorpay), and real-time notifications (Telegram Bot)** to provide comprehensive water usage tracking and enforcement.

### Key Features
- 🔍 **Real-time Water Usage Monitoring** via ESP32 IoT sensors
- 📊 **Live Dashboard** with usage trends and statistics
- 🚫 **Daily Water Limits** enforcement based on usage type (home, apartment, commercial, industry)
- 💳 **Payment Integration** (Razorpay) for purchasing extra water
- 📱 **Telegram Notifications** for usage warnings and limit breaches
- 🌍 **Timezone-aware Reset** (Asia/Kolkata) for daily limits
- 📡 **WebSocket Real-time Updates** between ESP32 and dashboard
- 🔐 **Secure Environment-based Configuration** (no hardcoded secrets)

---

## 📁 Project Structure

```
SIC_PROJECT/
├── backend/                    # Node.js Express server
│   ├── server.js              # Main application (WebSocket, API endpoints)
│   ├── test-simulator.js      # ESP32 flow simulator for testing
│   ├── package.json           # Backend dependencies
│   ├── .env.example           # Environment variables template
│   └── node_modules/          # Dependencies (git-ignored)
│
├── frontend/                   # React.js web dashboard
│   ├── public/
│   │   └── index.html         # HTML entry point
│   ├── src/
│   │   ├── App.js             # Main React component
│   │   ├── Dashboard.jsx      # Water dashboard UI
│   │   ├── App.css            # App styles
│   │   ├── Dashboard.css      # Dashboard styles
│   │   └── index.js           # React DOM render
│   ├── build/                 # Production build (git-ignored)
│   ├── package.json           # Frontend dependencies
│   ├── .env.example           # Frontend environment template
│   └── node_modules/          # Dependencies (git-ignored)
│
├── package.json               # Root workspace configuration
├── .gitignore                 # Git ignore rules
└── .env                       # (NEVER COMMIT) Local environment variables
```

---

## 🚀 Installation & Setup

### Prerequisites
- **Node.js** (v14+) and npm
- **Razorpay Account** (for payment testing)
- **Telegram Bot Token** (from BotFather)
- **Git**

### Step 1: Clone and Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd SIC_PROJECT

# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### Step 2: Configure Environment Variables

#### Backend Configuration

1. Copy the template:
```bash
cp backend/.env.example backend/.env
```

2. Edit `backend/.env` and fill in your values:
```env
# Server
PORT=3001
NODE_ENV=development

# Razorpay (get from https://dashboard.razorpay.com)
REACT_APP_RAZORPAY_KEY_ID=your_razorpay_public_key
RAZORPAY_KEY_SECRET=your_razorpay_secret_key

# Telegram Bot (get from @BotFather on Telegram)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Reset Configuration
RESET_HOUR=0
RESET_MINUTE=0

# Daily Limit
DEFAULT_DAILY_LIMIT=100
```

#### Frontend Configuration

1. Copy the template:
```bash
cp frontend/.env.example frontend/.env.local
```

2. Edit `frontend/.env.local`:
```env
# For local development
REACT_APP_API_BASE_URL=http://localhost:3001
REACT_APP_WS_BASE_URL=ws://localhost:3001

# For production (e.g., Render, Heroku)
# REACT_APP_API_BASE_URL=https://your-backend-url
# REACT_APP_WS_BASE_URL=wss://your-backend-url

# Razorpay Public Key (SAFE to expose - this is the public key)
REACT_APP_RAZORPAY_KEY_ID=your_razorpay_public_key
```

---

## 🏃 Running the Project

### Development Mode

**Terminal 1 - Backend Server:**
```bash
cd backend
npm run dev  # Starts server with nodemon auto-reload on port 3001
```

**Terminal 2 - Frontend Development:**
```bash
cd frontend
npm start   # Starts React on http://localhost:3000
```

**Terminal 3 - Test Water Flow Simulator (Optional):**
```bash
cd backend
node test-simulator.js  # Simulates ESP32 sending water usage data
```

### Production Build

```bash
# Build everything
npm run build

# Start production server
npm start
```

---

## 🔗 API Endpoints

### Dashboard
- **GET** `/api/dashboard/:userId/:borewellNo` - Get current water usage status

### Water Usage (ESP32)
- **POST** `/api/water-usage` - Record water usage from ESP32
  ```json
  {
    "userId": "1",
    "borewellNo": "BW001",
    "litersUsed": 25.5
  }
  ```

### Water Type Configuration
- **POST** `/api/update-usage-type` - Change usage category
  ```json
  {
    "userId": "1",
    "borewellNo": "BW001",
    "usageType": "home"  // home, apartment, commercial, industry
  }
  ```

### Razorpay Payment
- **POST** `/api/create-order` - Create Razorpay order
- **POST** `/api/verify-payment` - Verify payment and add extra liters

### Manual Reset
- **POST** `/api/reset-usage` - Reset daily usage counter
  ```json
  {
    "userId": "1",
    "borewellNo": "BW001"
  }
  ```

---

## 📱 WebSocket Events

The system uses WebSocket (WS) for real-time updates:

### Client → Server
```json
{
  "type": "subscribe",
  "userId": "1",
  "borewellNo": "BW001"
}
```

### Server → Client
```json
{
  "type": "update",
  "data": {
    "name": "User 1",
    "borewellNo": "BW001",
    "usageType": "home",
    "dailyLimit": 100,
    "usedToday": 45.5,
    "remainingLitre": 54.5,
    "status": "normal",
    "nextResetAt": 1704067200000,
    "extraLitersPurchased": 20,
    "totalExtraAmountPaid": 200,
    "relayState": "ON"
  }
}
```

---

## 🔐 Security Best Practices

✅ **Implemented:**
- All API keys and tokens loaded from environment variables
- `.env` file in `.gitignore` - never committed
- Razorpay signature verification on payment
- CORS enabled for cross-origin requests
- Frontend Razorpay key is public (safe to expose)
- Backend Razorpay secret is never sent to frontend

⚠️ **Important:**
- **NEVER** commit `.env` file to git
- **NEVER** hardcode API keys, tokens, or passwords
- Use `.env.example` as template for required variables
- Keep `RAZORPAY_KEY_SECRET` secure (backend only)
- Telegram bot token should be kept private

---

## 📊 Water Limits by Usage Type

| Type | Daily Limit | Cost per Liter |
|------|------------|----------------|
| Home | 100 L | ₹10 |
| Apartment | 500 L | ₹10 |
| Commercial | 2000 L | ₹10 |
| Industry | 5000 L | ₹10 |

---

## 🤖 Telegram Notifications

The system sends alerts when:
- **Warning (80% of limit)** - `⚠️ WATER USAGE WARNING`
- **Exceeded** - `🚫 WATER LIMIT REACHED`

Example:
```
⚠️ WATER USAGE WARNING

Borewell: BW001
Used: 80 / 100 L
```

---

## 🧪 Testing

### Test Water Flow Simulator
```bash
cd backend
node test-simulator.js
```

This simulates ESP32 sending random water flow data every 2 seconds.

### Manual API Testing
```bash
# Get dashboard data
curl http://localhost:3001/api/dashboard/1/BW001

# Simulate water usage
curl -X POST http://localhost:3001/api/water-usage \
  -H "Content-Type: application/json" \
  -d '{"userId":"1","borewellNo":"BW001","litersUsed":25}'
```

---

## 📦 Dependencies

### Backend
- **express** - Web framework
- **ws** - WebSocket server
- **cors** - Cross-origin requests
- **dotenv** - Environment variables
- **razorpay** - Payment processing
- **axios** - HTTP client
- **nodemon** (dev) - Auto-reload

### Frontend
- **react** - UI framework
- **react-dom** - React rendering
- **recharts** - Charts/graphs
- **qrcode.react** - QR code generation
- **@testing-library/react** - Testing

---

## 🛠️ Troubleshooting

### Backend won't connect to frontend
- Check `REACT_APP_API_BASE_URL` and `REACT_APP_WS_BASE_URL` in frontend `.env.local`
- Ensure backend is running on the correct port

### WebSocket connection fails
- Verify WebSocket URL (should be `wss://` for HTTPS, `ws://` for HTTP)
- Check browser console for connection errors

### Razorpay payment fails
- Verify keys are set in backend `.env`
- Ensure Razorpay account is active and in test mode

### Telegram notifications not working
- Check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are correct
- Ensure bot has message permissions in the chat

### Daily reset not happening
- Verify `RESET_HOUR` and `RESET_MINUTE` are set (default: 0,0 = midnight IST)
- Check server time is synced correctly

---

## 🌐 Deployment

### Deploy to Render.com (Recommended)
1. Create Render account
2. Connect GitHub repository
3. Set environment variables in Render dashboard
4. Deploy backend service
5. Update frontend `.env.local` with production URLs
6. Deploy frontend service

### Deploy to Other Platforms
Follow similar steps, ensuring:
- Backend runs on a publicly accessible URL
- Frontend environment variables point to backend
- All `.env` variables are configured in the platform's settings

---

## 📄 License

This project is proprietary and confidential.

---

## 👥 Contributors

- **Team HydroSense**

---

## 📞 Support

For issues or questions, contact the development team.

---

**Last Updated:** May 2026
