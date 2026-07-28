'use strict';
const express = require('express');
const db = require('../db');
const cryptoUtil = require('../utils/crypto');
const logger = require('../utils/logger');
const { requireAuth } = require('../auth/middleware');
const { BinanceClient, buildClient } = require('./binanceService');

const router = express.Router();
const VALID_TYPES = ['spot_testnet', 'spot_real', 'futures_testnet', 'futures_real'];

router.use(requireAuth);

router.get('/accounts', async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT id, account_type, label, is_active, is_verified, last_verified_at, created_at, api_key_enc FROM binance_accounts WHERE user_id = ?',
      [req.user.id]
    );
    const sanitized = rows.map((r) => ({
      ...r,
      api_key_masked: cryptoUtil.mask(cryptoUtil.decrypt(r.api_key_enc)),
      api_key_enc: undefined,
    }));
    res.json({ accounts: sanitized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/accounts/connect', async (req, res) => {
  const { accountType, apiKey, apiSecret, label } = req.body;
  if (!VALID_TYPES.includes(accountType)) return res.status(400).json({ error: 'Invalid account type' });
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'API key and secret are required' });

  try {
    const client = new BinanceClient(accountType, apiKey, apiSecret);
    const validation = await client.validateKeys();
    if (!validation.ok) {
      return res.status(400).json({ error: 'Binance API validation failed', detail: validation.error, hint: validation.hint });
    }

    const apiKeyEnc = cryptoUtil.encrypt(apiKey);
    const apiSecretEnc = cryptoUtil.encrypt(apiSecret);

    const info = await db.run(
      `INSERT INTO binance_accounts (user_id, account_type, api_key_enc, api_secret_enc, label, is_active, is_verified, last_verified_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, strftime('%s','now'))`,
      [req.user.id, accountType, apiKeyEnc, apiSecretEnc, label || accountType]
    );

    logger.info('binance', `User ${req.user.id} connected ${accountType} account #${info.lastInsertRowid}`);
    res.json({ ok: true, accountId: info.lastInsertRowid, message: 'Account connected and verified successfully.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    const account = await db.get('SELECT * FROM binance_accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    await db.run('DELETE FROM binance_accounts WHERE id = ?', [account.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/accounts/:id/revalidate', async (req, res) => {
  try {
    const account = await db.get('SELECT * FROM binance_accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const client = buildClient(account.account_type, account.api_key_enc, account.api_secret_enc);
    const validation = await client.validateKeys();
    await db.run(
      "UPDATE binance_accounts SET is_verified = ?, last_verified_at = strftime('%s','now') WHERE id = ?",
      [validation.ok ? 1 : 0, account.id]
    );
    if (!validation.ok) return res.status(400).json({ error: validation.error, hint: validation.hint });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/accounts/:id/snapshot', async (req, res) => {
  try {
    const account = await db.get('SELECT * FROM binance_accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const client = buildClient(account.account_type, account.api_key_enc, account.api_secret_enc);
    const [accountInfo, openOrders, positions] = await Promise.all([
      client.accountInfo(),
      client.openOrders(),
      client.positionRisk(),
    ]);

    const trades = await db.all(
      'SELECT * FROM trade_history WHERE account_id = ? ORDER BY closed_at DESC LIMIT 100',
      [account.id]
    );
    const wins = trades.filter((t) => t.result === 'win').length;
    const winRate = trades.length ? (wins / trades.length) * 100 : 0;

    res.json({ accountInfo: sanitizeAccountInfo(accountInfo, account.account_type), openOrders, positions, localTradeHistory: trades, winRate });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function sanitizeAccountInfo(info, accountType) {
  if (accountType.startsWith('futures')) {
    return {
      totalWalletBalance: info.totalWalletBalance,
      totalMarginBalance: info.totalMarginBalance,
      availableBalance: info.availableBalance,
      totalUnrealizedProfit: info.totalUnrealizedProfit,
    };
  }
  return { balances: (info.balances || []).filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0) };
}

module.exports = router;
