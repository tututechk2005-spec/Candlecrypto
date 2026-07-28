'use strict';
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');

// DB must be imported first so schema initialises before routes run
const db = require('./src/db');

const logger = require('./src/utils/logger');
const authRoutes = require('./src/auth/authRoutes');
const binanceRoutes = require('./src/binance/binanceRoutes');
const dashboardRoutes = require('./src/routes/dashboard');
const marketsRoutes = require('./src/routes/markets');
const tradingRoutes = require('./src/routes/trading');
const signalsRoutes = require('./src/routes/signals');
const analyticsRoutes = require('./src/routes/analytics');
const historyRoutes = require('./src/routes/history');
const walletRoutes = require('./src/routes/wallet');
const referralRoutes = require('./src/routes/referral');
const settingsRoutes = require('./src/routes/settings');
const notificationsRoutes = require('./src/routes/notifications');
const supportRoutes = require('./src/routes/support');
const profileRoutes = require('./src/routes/profile');
const adminRoutes = require('./src/routes/admin');

const { MarketFeed } = require('./src/binance/wsService');
const AutoTrader = require('./src/ai/autoTrader');

const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Copy .env.example to .env and fill in real values.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1); // needed on Railway (behind a reverse proxy)

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie-secret'));

// Rate limiting
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/admin/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/binance', binanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/signals', signalsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler
app.use((err, req, res, _next) => {
  console.error(err.stack || err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// WebSocket – broadcasts live prices and signals to browser clients
// ---------------------------------------------------------------------------
const wss = new WebSocket.Server({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcastToClients(payload) {
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------------
// Start: wait for DB to be fully initialised before accepting connections
// ---------------------------------------------------------------------------
db.ready.then(() => {
  // Background services
  const marketFeed = new MarketFeed(broadcastToClients);
  marketFeed.start('spot_real', ['btcusdt', 'ethusdt', 'bnbusdt', 'solusdt', 'xrpusdt']);

  const autoTrader = new AutoTrader(broadcastToClients);
  autoTrader.start();

  server.listen(PORT, () => {
    console.log(`\n  ✅ Server running: http://localhost:${PORT}`);
    console.log(`  📊 Admin:          http://localhost:${PORT}/admin-login.html`);
    console.log(`  🔑 Default admin:  ${process.env.ADMIN_USERNAME || 'admin'} / ${process.env.ADMIN_PASSWORD || 'admin123'}\n`);
  });
}).catch((err) => {
  console.error('Fatal: DB init failed', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => console.error('[uncaughtException]', err.stack || err.message));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

module.exports = { app, server };
