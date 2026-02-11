import React, { useState, useEffect, useRef, useMemo } from 'react';
import './Dashboard.css';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

/* ================= BASE URL CONFIG ================= */
const API_BASE =
  window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://ugms-water-monitor.onrender.com';

const WS_BASE =
  window.location.hostname === 'localhost'
    ? 'ws://localhost:3001'
    : 'wss://ugms-water-monitor.onrender.com';

const Dashboard = ({ userId = '1', borewellNo = 'BW001' }) => {

  const [dashboardData, setDashboardData] = useState(null);
  const [history, setHistory] = useState([]);
  const [connected, setConnected] = useState(false);
  const [extraLiters, setExtraLiters] = useState('');
  const [currentTime, setCurrentTime] = useState(Date.now());

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  /* ================= REAL-TIME CLOCK ================= */
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    fetch(`${API_BASE}/api/dashboard/${userId}/${borewellNo}`)
      .then(res => res.json())
      .then(data => setDashboardData(data))
      .catch(console.error);
  }, [userId, borewellNo]);

  /* ================= WEBSOCKET ================= */
  useEffect(() => {

    const connectWebSocket = () => {
      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({
          type: 'subscribe',
          userId,
          borewellNo
        }));
      };

      ws.onmessage = event => {
        try {
          const res = JSON.parse(event.data);
          if (res.type === 'update' && res.data) {
            setDashboardData(res.data);

            setHistory(prev =>
              [
                ...prev,
                {
                  time: new Date().toLocaleTimeString(),
                  used: res.data.usedToday
                }
              ].slice(-20)
            );
          }
        } catch (err) {
          console.error('WS parse error', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectRef.current = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connectWebSocket();

    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };

  }, [userId, borewellNo]);

  /* ================= RAZORPAY PAYMENT ================= */

  const costPerLiter = 10;

  const amount = useMemo(() => {
    return extraLiters && Number(extraLiters) > 0
      ? Number(extraLiters) * costPerLiter
      : 0;
  }, [extraLiters]);

  const handlePayment = async () => {

    if (!extraLiters || Number(extraLiters) <= 0) {
      alert("Enter valid liters");
      return;
    }

    const res = await fetch(`${API_BASE}/api/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        borewellNo,
        extraLiters: Number(extraLiters)
      })
    });

    const data = await res.json();

    const options = {
      key: "rzp_test_SEvjF0tlhc2EsE",  // 🔥 PUT YOUR TEST KEY ID HERE
      amount: data.amount,
      currency: "INR",
      name: "Water Authority",
      description: "Water Recharge",
      order_id: data.orderId,

      handler: async function (response) {

        const verifyRes = await fetch(`${API_BASE}/api/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...response,
            userId,
            borewellNo,
            extraLiters: Number(extraLiters)
          })
        });

        const verifyData = await verifyRes.json();

        if (verifyData.success) {
          alert("Payment Successful ✅");
          setExtraLiters('');
        } else {
          alert("Payment verification failed");
        }
      },

      theme: {
        color: "#22c55e"
      }
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  if (!dashboardData) return <div>Loading...</div>;

  const {
    name,
    usageType,
    dailyLimit,
    usedToday,
    status,
    extraLitersPurchased,
    totalExtraAmountPaid,
    nextResetAt
  } = dashboardData;

  const usagePercent = Math.min(100, (usedToday / dailyLimit) * 100);
  const isFlowStarted = usedToday > 0;

  const formattedRemaining = (() => {
    if (!nextResetAt) return '';
    const diff = nextResetAt - currentTime;
    if (diff <= 0) return "0h 0m 0s";

    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);

    return `${h}h ${m}m ${s}s`;
  })();

  return (
    <div className="dashboard-container">
      <div className="dashboard-layout">

        <div className="dashboard-card">

          <div className="dashboard-header">
            <h1>Water Monitoring Dashboard</h1>
            <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
              {connected ? '● Connected' : '○ Disconnected'}
            </div>
          </div>

          <div className="dashboard-content">

            <div className="user-info">
              <div className="info-label">Name</div>
              <div className="info-value">{name}</div>

              <div className="info-label">Borewell No</div>
              <div className="info-value">{borewellNo}</div>

              <div className="info-label">
                Usage Type {isFlowStarted && '(locked)'}
              </div>

              <select disabled={isFlowStarted} value={usageType}>
                <option value="home">Home</option>
                <option value="apartment">Apartment</option>
                <option value="commercial">Commercial</option>
                <option value="industry">Industry</option>
              </select>

              <div className="info-label">Daily Limit</div>
              <div className="info-value">{dailyLimit} L</div>
            </div>

            <div className="metrics-section">

              <div className="metric-card">
                <div className="metric-label">Remaining Time</div>
                <div className="metric-value">{formattedRemaining}</div>

                <div className="metric-label">Water Used</div>
                <div className={`metric-value ${status}`}>
                  {usedToday.toFixed(1)} L / {dailyLimit} L
                </div>

                <div className="progress-bar">
                  <div
                    className={`progress-fill ${status}`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Usage Trend</div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={history}>
                    <XAxis hide />
                    <YAxis hide />
                    <Tooltip />
                    <Line dataKey="used" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

            </div>

            <div className={`message ${status}`}>
              {status === 'exceeded'
                ? 'Limit exceeded - Water supply stopped'
                : status === 'warning'
                ? 'Approaching daily limit'
                : 'Water available'}
            </div>

            <div className="extra-summary">
              <h3>Extra Usage Summary</h3>
              <p>Extra Water Purchased: {extraLitersPurchased} L</p>
              <p>Total Extra Paid: ₹{totalExtraAmountPaid}</p>
            </div>

          </div>
        </div>

        {status === 'exceeded' && (
          <div className="desktop-recharge">
            <div className="recharge-section">
              <h3>Buy Extra Water</h3>

              <input
                type="number"
                placeholder="Enter extra liters"
                value={extraLiters}
                onChange={(e) => setExtraLiters(e.target.value)}
              />

              {amount > 0 && (
                <>
                  <p>Total Amount: ₹{amount}</p>
                  <button onClick={handlePayment}>
                    Pay with Razorpay
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Dashboard;
