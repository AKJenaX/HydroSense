import React, { useState, useEffect, useRef } from 'react';
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
  const [alert, setAlert] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    fetch(`${API_BASE}/api/dashboard/${userId}/${borewellNo}`)
      .then(res => res.json())
      .then(data => {
        setDashboardData(data);

        // Convert "18h 47m" → seconds
        const [h, m] = data.remainingTime
          .replace('h', '')
          .replace('m', '')
          .split(' ')
          .map(Number);

        setRemainingSeconds(h * 3600 + m * 60);
      })
      .catch(console.error);
  }, [userId, borewellNo]);

  /* ================= WEBSOCKET ================= */
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            userId,
            borewellNo
          })
        );
      };

      ws.onmessage = event => {
        try {
          const res = JSON.parse(event.data);

          if (res.type === 'update' && res.data) {
            setDashboardData(res.data);

            // Update countdown from backend
            const [h, m] = res.data.remainingTime
              .replace('h', '')
              .replace('m', '')
              .split(' ')
              .map(Number);

            setRemainingSeconds(h * 3600 + m * 60);

            setHistory(his =>
              [
                ...his,
                {
                  time: new Date().toLocaleTimeString(),
                  used: res.data.usedToday
                }
              ].slice(-20)
            );

            if (res.data.alert) {
              setAlert(res.data.alert);
              setTimeout(() => setAlert(null), 5000);
            }
          }
        } catch (err) {
          console.error('WS parse error', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [userId, borewellNo]);

  /* ================= AUTO COUNTDOWN ================= */
  useEffect(() => {
  if (remainingSeconds === null) return;

  const interval = setInterval(() => {
    setRemainingSeconds(prev => {
      if (prev === null) return null;
      return Math.max(prev - 60, 0);
    });
  }, 60000);

  return () => clearInterval(interval);
}, [remainingSeconds]);




  /* ================= SET USAGE TYPE ================= */
  const changeUsageType = async (type) => {
    await fetch(`${API_BASE}/api/usage-type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        borewellNo,
        usageType: type
      })
    });
  };

  if (!dashboardData) return <div>Loading...</div>;

  const {
    name,
    usageType,
    dailyLimit,
    usedToday,
    status
  } = dashboardData;

  const usagePercent = Math.min(100, (usedToday / dailyLimit) * 100);
  const isFlowStarted = usedToday > 0;

  const formattedRemaining =
    remainingSeconds !== null
      ? `${Math.floor(remainingSeconds / 3600)}h ${Math.floor(
          (remainingSeconds % 3600) / 60
        )}m`
      : dashboardData.remainingTime;

  /* ================= UI ================= */
  return (
    <div className="dashboard-container">
      <div className="dashboard-card">

        <div className="dashboard-header">
          <h1>Dashboard</h1>
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

            <select
              className="usage-dropdown"
              disabled={isFlowStarted}
              value={usageType}
              onChange={e => changeUsageType(e.target.value)}
            >
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
                  <Line
                    dataKey="used"
                    stroke={
                      status === 'exceeded'
                        ? '#ef4444'
                        : status === 'warning'
                        ? '#facc15'
                        : '#22c55e'
                    }
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="status-section">
            <div className={`status-indicator ${status}`}>
              <div className="status-dot" />
              {status.toUpperCase()}
            </div>
          </div>

        </div>

        <div className={`message ${status}`}>
          {status === 'exceeded'
            ? 'Limit exceeded - Water supply stopped'
            : status === 'warning'
            ? 'Approaching daily limit'
            : 'Water available'}
        </div>
      </div>

      {alert && (
        <div className={`toast toast-${status}`}>
          {alert.message}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
