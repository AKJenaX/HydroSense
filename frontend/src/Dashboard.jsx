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

/* ================= BACKEND CONFIG ================= */
const API_BASE = 'http://localhost:3001';
const WS_BASE  = 'ws://localhost:3001';

/* ================= DEVICE TIMEOUT ================= */
const DEVICE_TIMEOUT = 5000;

const Dashboard = ({ userId = '1', borewellNo = 'BW001' }) => {

  const [dashboardData, setDashboardData] = useState(null);
  const [history, setHistory] = useState([]);
  const [connected, setConnected] = useState(false);
  const [extraLiters, setExtraLiters] = useState('');
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [resetting, setResetting] = useState(false);

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  /* ================= CLOCK ================= */
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    fetch(`${API_BASE}/api/dashboard/${userId}/${borewellNo}`)
      .then(res => {
        if (!res.ok) throw new Error('Dashboard API failed');
        return res.json();
      })
      .then(data => setDashboardData(data))
      .catch(err => {
        console.error(err);
        alert('Backend not reachable');
      });
  }, [userId, borewellNo]);

  /* ================= WEBSOCKET ================= */
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          userId,
          borewellNo
        }));
      };

      ws.onmessage = event => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'update') {
          setDashboardData(msg.data);
          setHistory(prev =>
            [
              ...prev,
              {
                time: new Date().toLocaleTimeString(),
                used: msg.data.usedToday
              }
            ].slice(-20)
          );
        }
      };

      ws.onclose = () => {
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [userId, borewellNo]);

  /* ================= DEVICE ONLINE ================= */
  useEffect(() => {
    if (!dashboardData?.lastSeen) {
      setConnected(false);
      return;
    }

    const interval = setInterval(() => {
      setConnected(Date.now() - dashboardData.lastSeen < DEVICE_TIMEOUT);
    }, 1000);

    return () => clearInterval(interval);
  }, [dashboardData]);

  /* ================= CHANGE USAGE TYPE ================= */
  const updateUsageType = async (newType) => {
    try {
      const res = await fetch(`${API_BASE}/api/update-usage-type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          borewellNo,
          usageType: newType
        })
      });

      if (!res.ok) throw new Error('Failed to update usage type');
    } catch (err) {
      console.error(err);
      alert('Failed to update usage type');
    }
  };

  /* ================= PAYMENT (RAZORPAY) ================= */
  const costPerLiter = 10;

  const amount = useMemo(() => {
    return extraLiters && Number(extraLiters) > 0
      ? Number(extraLiters) * costPerLiter
      : 0;
  }, [extraLiters]);

  const handleRecharge = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          borewellNo,
          extraLiters: Number(extraLiters)
        })
      });

      const order = await res.json();

      const options = {
        key: process.env.REACT_APP_RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: 'INR',
        name: 'Water Authority',
        description: 'Extra Water Recharge',
        order_id: order.id,
        handler: async function (response) {
          await fetch(`${API_BASE}/api/verify-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response)
          });
          setExtraLiters('');
        }
      };

      const razorpay = new window.Razorpay(options);
      razorpay.open();

    } catch (err) {
      console.error(err);
      alert('Payment failed');
    }
  };

  /* ================= RESET ================= */
  const handleReset = async () => {
    if (!window.confirm('Reset water usage?')) return;

    setResetting(true);
    try {
      const res = await fetch(`${API_BASE}/api/reset-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, borewellNo })
      });
      if (!res.ok) throw new Error('Reset failed');
      setHistory([]);
    } catch (err) {
      alert('Reset request failed');
      console.error(err);
    } finally {
      setResetting(false);
    }
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
    nextResetAt,
    totalAllowed
  } = dashboardData;

  const usagePercent = Math.min(
    100,
    (usedToday / Math.max(totalAllowed, 1)) * 100
  );

  /* ================= COUNTDOWN ================= */
  const remainingTime = (() => {
    const diff = nextResetAt - currentTime;
    if (diff <= 0) return '0h 0m 0s';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${h}h ${m}m ${s}s`;
  })();

  /* ================= UI ================= */
  return (
    <div className="dashboard-container">
      <div className="dashboard-layout">

        <div className="dashboard-card command-main">

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

              <div className="info-label">Usage Type</div>
              <select
                className="usage-dropdown"
                value={usageType}
                onChange={e => updateUsageType(e.target.value)}
              >
                <option value="home">Apartment</option>
                <option value="commercial">Commercial</option>
                <option value="industry">Industry</option>
              </select>

              <div className="info-label">Daily Limit</div>
              <div className="info-value">{dailyLimit} L</div>
            </div>

            <div className="metrics-section">
              <div className="metric-card">
                <div className="metric-label">Remaining Time</div>
                <div className="metric-value">{remainingTime}</div>

                <div className={`metric-value ${status}`}>
                  {usedToday.toFixed(1)} / {totalAllowed} L
                </div>

                <div className="progress-bar">
                  <div
                    className={`progress-fill ${status}`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>

              <div className="metric-card">
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={history}>
                    <XAxis hide />
                    <YAxis hide />
                    <Tooltip />
                    <Line dataKey="used" dot={false} strokeWidth={2} />
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

            {status === 'exceeded' && (
              <button onClick={handleReset} disabled={resetting}>
                {resetting ? 'Resetting...' : 'RESET WATER USAGE'}
              </button>
            )}

            <div className="extra-summary">
              <h3>Extra Usage Summary</h3>
              <p>Extra Water Purchased: {extraLitersPurchased} L</p>
              <p>Total Extra Paid: ₹{totalExtraAmountPaid}</p>
            </div>

          </div>
        </div>

        {status === 'exceeded' && (
          <div className="desktop-recharge command-recharge">
            <div className="recharge-section">
              <h3>Recharge Water</h3>

              <input
                type="number"
                placeholder="Enter extra liters"
                value={extraLiters}
                onChange={e => setExtraLiters(e.target.value)}
              />

              {amount > 0 && (
                <>
                  <p>Total Amount: ₹{amount}</p>
                  <button onClick={handleRecharge}>
                    Pay via Razorpay
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
