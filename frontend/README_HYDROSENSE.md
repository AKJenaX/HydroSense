# HydroSense Frontend

React-based dashboard for the HydroSense Smart Underground Water Monitoring System.

## Quick Start

### Setup
```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local with your backend URLs and API keys
# REACT_APP_API_BASE_URL=http://localhost:3001
# REACT_APP_WS_BASE_URL=ws://localhost:3001

# Install dependencies
npm install

# Start development server
npm start
```

### Build for Production
```bash
npm run build
```

## Features

- 🌊 Real-time water usage visualization
- 📊 Usage trends and statistics
- 💳 In-app water recharge via Razorpay
- 🔌 WebSocket live updates
- 📱 Responsive design
- 🎨 Status indicators (normal, warning, exceeded)

## Environment Variables

Create `.env.local` from `.env.example`:

```env
# Backend Configuration (update for your deployment)
REACT_APP_API_BASE_URL=http://localhost:3001
REACT_APP_WS_BASE_URL=ws://localhost:3001

# Razorpay Public Key (safe to expose - this is the public key)
REACT_APP_RAZORPAY_KEY_ID=your_key_here
```

⚠️ **Important:** The `REACT_APP_RAZORPAY_KEY_ID` is the **public key** and is safe to include in the frontend. The **secret key** must never be exposed and should only exist in the backend.

## Components

- **Dashboard.jsx** - Main dashboard showing water usage, status, and controls
- **App.js** - Root component

## Testing

```bash
npm test
```

## Troubleshooting

### WebSocket connection fails
- Check `REACT_APP_WS_BASE_URL` in `.env.local`
- Ensure backend server is running

### Razorpay button doesn't work
- Verify `REACT_APP_RAZORPAY_KEY_ID` is set
- Check browser console for errors
- Ensure Razorpay script is loaded in `public/index.html`

### Backend API returns 404
- Verify `REACT_APP_API_BASE_URL` points to correct backend
- Check backend server is running on specified port

## More Information

See [../README.md](../README.md) for full project documentation.
