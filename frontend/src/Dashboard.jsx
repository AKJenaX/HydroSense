import React, { useState, useEffect, useRef, useMemo } from 'react';
import './Dashboard.css';
import { QRCodeCanvas } from 'qrcode.react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

/* ================= BACKEND CONFIG ================= */
const API_BASE =
  window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://ugms-water-monitor.onrender.com';

const WS_BASE =
  window.location.hostname === 'localhost'
    ? 'ws://localhost:3001'
    : 'https://ugms-water-monitor.onrender.com';


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
        setConnected(true);
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
        setConnected(false);
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

  /* ================= PAYMENT ================= */
  const costPerLiter = 10;

  const amount = useMemo(() => {
    return extraLiters && Number(extraLiters) > 0
      ? Number(extraLiters) * costPerLiter
      : 0;
  }, [extraLiters]);

  const upiUrl = amount > 0
    ? `upi://pay?pa=vritika042@oksbi&pn=Water Authority&am=${amount}&cu=INR`
    : '';

  const handleRecharge = async () => {
    await fetch(`${API_BASE}/api/recharge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        borewellNo,
        extraLiters: Number(extraLiters)
      })
    });

    setExtraLiters('');
  };

  /* ================= RESET ================= */
  const handleReset = async () => {
    const confirmReset = window.confirm('Reset water usage?');
    if (!confirmReset) return;

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

  const usagePercent = Math.min(100, (usedToday / totalAllowed) * 100);

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

        {/* ================= DASHBOARD CARD ================= */}
        <div className="dashboard-card">

          <div className="dashboard-header">
            <h1>Water Monitoring Dashboard</h1>
            <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
              {connected ? '● Connected' : '○ Disconnected'}
            </div>
          </div>

          <div className="dashboard-content">

            {/* USER INFO */}
            <div className="user-info">
              <div className="info-label">Name</div>
              <div className="info-value">{name}</div>

              <div className="info-label">Borewell No</div>
              <div className="info-value">{borewellNo}</div>

              <div className="info-label">Usage Type</div>
              <select
                className="usage-dropdown"
                disabled
                value={usageType}
              >
                <option>{usageType}</option>
              </select>

              <div className="info-label">Daily Limit</div>
              <div className="info-value">{dailyLimit} L</div>
            </div>

            {/* METRICS */}
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

            {/* STATUS MESSAGE */}
            <div className={`message ${status}`}>
              {status === 'exceeded'
                ? 'Limit exceeded - Water supply stopped'
                : status === 'warning'
                ? 'Approaching daily limit'
                : 'Water available'}
            </div>

            {/* RESET */}
            {status === 'exceeded' && (
              <button onClick={handleReset} disabled={resetting}>
                {resetting ? 'Resetting...' : 'RESET WATER USAGE'}
              </button>
            )}

            {/* EXTRA SUMMARY */}
            <div className="extra-summary">
              <h3>Extra Usage Summary</h3>
              <p>Extra Water Purchased: {extraLitersPurchased} L</p>
              <p>Total Extra Paid: ₹{totalExtraAmountPaid}</p>
            </div>

          </div>
        </div>

        {/* ================= RECHARGE CARD ================= */}
        {status === 'exceeded' && (
          <div className="desktop-recharge">
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

                  <div className="qr-wrapper">
                    <QRCodeCanvas value={upiUrl} size={200} />
                  </div>

                  <button onClick={handleRecharge}>
                    I Have Paid
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
