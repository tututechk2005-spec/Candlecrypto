'use strict';
const db = require('../db');
const logger = require('../utils/logger');
const { buildClient, BinanceClient } = require('../binance/binanceService');
const { analyzeTimeframe, buildConfluence, persistSignal } = require('./signalEngine');

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h'];

function toCandles(klines) {
  return klines.map((k) => ({
    openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
    low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
  }));
}

class AutoTrader {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn || (() => {});
    this.running = false;
    this.timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
    logger.info('autotrader', 'AI auto-trading engine started');
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  _loop() {
    if (!this.running) return;
    db.get('SELECT * FROM ai_settings WHERE id = 1').then((settings) => {
      const interval = settings?.scan_interval_ms || 15000;
      this.scanOnce()
        .catch((e) => logger.error('autotrader', `Scan cycle failed: ${e.message}`))
        .finally(() => {
          this.timer = setTimeout(() => this._loop(), interval);
        });
    }).catch(() => {
      this.timer = setTimeout(() => this._loop(), 15000);
    });
  }

  async scanOnce() {
    const settings = await db.get('SELECT * FROM ai_settings WHERE id = 1');
    if (!settings || !settings.enabled) return;

    const symbols = (settings.symbols || 'BTCUSDT').split(',').map((s) => s.trim()).filter(Boolean);
    const timeframes = (settings.timeframes || TIMEFRAMES.join(',')).split(',').map((s) => s.trim());
    const minConfidence = settings.min_confidence || 95;
    const minRR = settings.min_risk_reward || 2;

    for (const symbol of symbols) {
      await this._analyzeSymbol(symbol, timeframes, minConfidence, minRR);
    }

    const accounts = await db.all(
      `SELECT ba.*, ba.user_id as user_id FROM binance_accounts ba
       JOIN users u ON u.id = ba.user_id
       WHERE ba.is_active = 1 AND ba.is_verified = 1`
    );

    for (const account of accounts) {
      try {
        await this._processAccount(account, symbols, timeframes, minConfidence, minRR);
      } catch (e) {
        logger.error('autotrader', `Account ${account.id} error: ${e.message}`);
      }
    }
  }

  async _analyzeSymbol(symbol, timeframes, minConfidence, minRR) {
    try {
      const client = new BinanceClient('spot_real', null, null);
      const tfResults = {};
      for (const tf of timeframes) {
        const kl = await client.klines(symbol, tf, 200);
        tfResults[tf] = analyzeTimeframe(toCandles(kl));
      }
      const confluence = buildConfluence(tfResults, minRR);
      if (!confluence) return null;
      confluence.qualifies = confluence.confidence >= minConfidence && confluence.riskReward >= minRR;

      const signalId = await persistSignal(symbol, 'multi', confluence);
      this.broadcast({
        type: 'signal', symbol,
        direction: confluence.direction,
        confidence: confluence.confidence,
        riskReward: confluence.riskReward,
        qualifies: confluence.qualifies,
        signalId,
      });
      return confluence;
    } catch (e) {
      logger.error('autotrader', `Analysis failed for ${symbol}: ${e.message}`);
      return null;
    }
  }

  async _processAccount(account, symbols, timeframes, minConfidence, minRR) {
    const risk = await db.get('SELECT * FROM risk_settings WHERE id = 1');
    const client = buildClient(account.account_type, account.api_key_enc, account.api_secret_enc);

    const openPositions = await db.all(
      "SELECT * FROM positions WHERE account_id = ? AND status = 'open'",
      [account.id]
    );

    for (const pos of openPositions) {
      await this._managePosition(client, account, pos, risk);
    }

    const stillOpenRow = await db.get(
      "SELECT COUNT(*) as c FROM positions WHERE account_id = ? AND status = 'open'",
      [account.id]
    );
    if ((stillOpenRow?.c || 0) >= (risk?.max_open_positions || 3)) return;

    for (const symbol of symbols) {
      const alreadyOpen = await db.get(
        "SELECT id FROM positions WHERE account_id = ? AND symbol = ? AND status = 'open'",
        [account.id, symbol]
      );
      if (alreadyOpen) continue;

      const signal = await db.get(
        'SELECT * FROM ai_signals WHERE symbol = ? ORDER BY created_at DESC LIMIT 1',
        [symbol]
      );
      if (!signal) continue;
      if (signal.confidence < minConfidence) continue;
      if (signal.risk_reward < minRR) continue;
      if (!signal.trend_confirmed || !signal.volume_confirmed || !signal.momentum_confirmed) continue;
      if (signal.status === 'executed') continue;

      await this._executeTrade(client, account, signal, risk);
    }
  }

  async _executeTrade(client, account, signal, risk) {
    try {
      const side = signal.direction === 'long' ? 'BUY' : 'SELL';
      const indicators = JSON.parse(signal.indicators_json || '{}');
      const price = indicators.vwap || indicators.ema20 || null;
      if (!price) return;

      const balances = await client.balances().catch(() => []);
      const usdt = Array.isArray(balances) ? balances.find((b) => b.asset === 'USDT') : null;
      const availableUsdt = usdt ? parseFloat(usdt.availableBalance || usdt.free || 0) : 0;
      const riskAmount = availableUsdt * ((risk?.max_risk_per_trade_pct || 1) / 100);
      const stopDistance = indicators.atr || price * 0.01;
      let quantity = stopDistance > 0 ? riskAmount / stopDistance : 0;
      if (!quantity || !isFinite(quantity)) return;

      const stopLossPct = (risk?.stop_loss_pct || 1.5) / 100;
      const takeProfitPct = (risk?.take_profit_pct || 3) / 100;
      const stopLoss = side === 'BUY' ? price * (1 - stopLossPct) : price * (1 + stopLossPct);
      const takeProfit = side === 'BUY' ? price * (1 + takeProfitPct) : price * (1 - takeProfitPct);

      const order = await client.placeOrder({ symbol: signal.symbol, side, type: 'MARKET', quantity: quantity.toFixed(6) });

      await db.run(
        `INSERT INTO orders (user_id, account_id, binance_order_id, symbol, side, type, price, quantity, status, source)
         VALUES (?, ?, ?, ?, ?, 'MARKET', ?, ?, 'filled', 'auto')`,
        [account.user_id, account.id, order.orderId?.toString(), signal.symbol, side, price, quantity]
      );

      await db.run(
        `INSERT INTO positions (user_id, account_id, symbol, side, entry_price, quantity, leverage, stop_loss, take_profit, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        [account.user_id, account.id, signal.symbol, signal.direction, price, quantity, risk?.default_leverage || 1, stopLoss, takeProfit]
      );

      await db.run("UPDATE ai_signals SET status = 'executed' WHERE id = ?", [signal.id]);

      await db.run(
        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'trade')`,
        [account.user_id, 'Auto trade executed', `${side} ${signal.symbol} by AI at confidence ${signal.confidence}%`]
      );

      logger.info('autotrader', `Executed ${side} ${signal.symbol} account ${account.id} confidence ${signal.confidence}%`);
    } catch (e) {
      logger.error('autotrader', `Trade execution failed for ${signal.symbol}: ${e.message}`);
    }
  }

  async _managePosition(client, account, pos, risk) {
    try {
      const publicClient = new BinanceClient('spot_real', null, null);
      const ticker = await publicClient.ticker24hr(pos.symbol).catch(() => null);
      const currentPrice = ticker ? parseFloat(ticker.lastPrice) : null;
      if (!currentPrice) return;

      const isLong = pos.side === 'long';
      let shouldClose = false;
      if (isLong && pos.stop_loss && currentPrice <= pos.stop_loss) shouldClose = true;
      if (!isLong && pos.stop_loss && currentPrice >= pos.stop_loss) shouldClose = true;
      if (isLong && pos.take_profit && currentPrice >= pos.take_profit) shouldClose = true;
      if (!isLong && pos.take_profit && currentPrice <= pos.take_profit) shouldClose = true;

      const breakEvenTrigger = (risk?.break_even_trigger_pct || 1) / 100;
      const movedPct = isLong
        ? (currentPrice - pos.entry_price) / pos.entry_price
        : (pos.entry_price - currentPrice) / pos.entry_price;

      if (movedPct >= breakEvenTrigger && pos.stop_loss !== pos.entry_price) {
        await db.run('UPDATE positions SET stop_loss = ? WHERE id = ?', [pos.entry_price, pos.id]);
      }

      const trailPct = (risk?.trailing_stop_pct || 1) / 100;
      if (movedPct > trailPct) {
        const newStop = isLong ? currentPrice * (1 - trailPct) : currentPrice * (1 + trailPct);
        if ((isLong && newStop > pos.stop_loss) || (!isLong && newStop < pos.stop_loss)) {
          await db.run('UPDATE positions SET stop_loss = ? WHERE id = ?', [newStop, pos.id]);
        }
      }

      if (shouldClose) {
        const side = isLong ? 'SELL' : 'BUY';
        await client.placeOrder({ symbol: pos.symbol, side, type: 'MARKET', quantity: pos.quantity.toFixed(6) });
        const pnl = isLong
          ? (currentPrice - pos.entry_price) * pos.quantity
          : (pos.entry_price - currentPrice) * pos.quantity;

        await db.run(
          "UPDATE positions SET status = 'closed', pnl = ?, closed_at = strftime('%s','now') WHERE id = ?",
          [pnl, pos.id]
        );

        await db.run(
          `INSERT INTO trade_history (user_id, account_id, symbol, side, entry_price, exit_price, quantity, pnl, result, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto')`,
          [account.user_id, account.id, pos.symbol, pos.side, pos.entry_price, currentPrice, pos.quantity, pnl, pnl >= 0 ? 'win' : 'loss']
        );

        await db.run(
          `INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'trade')`,
          [account.user_id, 'Position closed', `${pos.symbol} closed PNL ${pnl.toFixed(2)}`]
        );

        logger.info('autotrader', `Closed position ${pos.id} (${pos.symbol}) PNL=${pnl.toFixed(2)}`);
      }
    } catch (e) {
      logger.error('autotrader', `managePosition failed pos ${pos.id}: ${e.message}`);
    }
  }
}

module.exports = AutoTrader;
