'use strict';
const ind = require('./indicators');
const db = require('../db');
const logger = require('../utils/logger');

const TIMEFRAME_WEIGHT = { '1m': 0.5, '3m': 0.6, '5m': 0.8, '15m': 1, '30m': 1.1, '1h': 1.3, '4h': 1.5 };

function analyzeTimeframe(candles) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const n = closes.length;
  if (n < 50) return null;

  const ema20 = ind.ema(closes, 20);
  const ema50 = ind.ema(closes, 50);
  const rsi14 = ind.rsi(closes, 14);
  const { macdLine, signalLine, histogram } = ind.macd(closes);
  const atr14 = ind.atr(highs, lows, closes, 14);
  const adx14 = ind.adx(highs, lows, closes, 14);
  const vwapArr = ind.vwap(highs, lows, closes, volumes);
  const bb = ind.bollingerBands(closes, 20, 2);
  const sr = ind.supportResistance(highs, lows, 30);
  const structure = ind.detectStructure(highs, lows, closes);

  const last = n - 1;
  const price = closes[last];
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeConfirmed = volumes[last] > avgVolume * 1.1;

  let trendScore = 0;
  if (ema20[last] != null && ema50[last] != null) trendScore += ema20[last] > ema50[last] ? 0.5 : -0.5;
  if (price != null && vwapArr[last] != null) trendScore += price > vwapArr[last] ? 0.25 : -0.25;
  if (structure.bos === 'bullish') trendScore += 0.25;
  if (structure.bos === 'bearish') trendScore -= 0.25;

  let momentumScore = 0;
  if (rsi14[last] != null) {
    if (rsi14[last] > 55) momentumScore += 0.4;
    else if (rsi14[last] < 45) momentumScore -= 0.4;
  }
  if (histogram[last] != null) momentumScore += histogram[last] > 0 ? 0.4 : -0.4;
  if (macdLine[last] != null && signalLine[last] != null)
    momentumScore += macdLine[last] > signalLine[last] ? 0.2 : -0.2;

  const trendConfirmed = Math.abs(trendScore) >= 0.5;
  const momentumConfirmed = Math.abs(momentumScore) >= 0.4 && Math.sign(momentumScore) === Math.sign(trendScore || 1);

  const direction = trendScore + momentumScore >= 0 ? 'long' : 'short';
  const combined = (trendScore + momentumScore) / 2;

  return {
    direction, combinedScore: combined, trendConfirmed, momentumConfirmed, volumeConfirmed,
    price, atr: atr14[last], support: sr.support, resistance: sr.resistance, structure,
    indicators: {
      ema20: ema20[last], ema50: ema50[last], rsi: rsi14[last],
      macd: macdLine[last], signal: signalLine[last], histogram: histogram[last],
      atr: atr14[last], adx: adx14[last], vwap: vwapArr[last],
      bbUpper: bb.upper[last], bbLower: bb.lower[last],
    },
  };
}

function buildConfluence(timeframeResults, minRiskReward) {
  const entries = Object.entries(timeframeResults).filter(([, v]) => v);
  if (!entries.length) return null;

  let longWeight = 0, shortWeight = 0, totalWeight = 0;
  let volumeVotes = 0, trendVotes = 0, momentumVotes = 0;

  for (const [tf, res] of entries) {
    const w = TIMEFRAME_WEIGHT[tf] || 1;
    totalWeight += w;
    if (res.direction === 'long') longWeight += w * (0.5 + Math.abs(res.combinedScore) / 2);
    else shortWeight += w * (0.5 + Math.abs(res.combinedScore) / 2);
    if (res.volumeConfirmed) volumeVotes += w;
    if (res.trendConfirmed) trendVotes += w;
    if (res.momentumConfirmed) momentumVotes += w;
  }

  const direction = longWeight >= shortWeight ? 'long' : 'short';
  const alignment = Math.max(longWeight, shortWeight) / totalWeight;
  const volumeConfirmed = volumeVotes / totalWeight >= 0.5;
  const trendConfirmed = trendVotes / totalWeight >= 0.5;
  const momentumConfirmed = momentumVotes / totalWeight >= 0.5;
  const confirmationsPassed = [volumeConfirmed, trendConfirmed, momentumConfirmed].filter(Boolean).length;
  let confidence = alignment * 70 + (confirmationsPassed / 3) * 30;
  confidence = Math.round(Math.min(100, Math.max(0, confidence)));

  const primary = entries.reduce((best, cur) =>
    (TIMEFRAME_WEIGHT[cur[0]] > TIMEFRAME_WEIGHT[best[0]] ? cur : best)
  )[1];
  const risk = primary.atr || primary.price * 0.005;
  const reward = risk * 2;
  const riskReward = reward / risk;

  return { direction, confidence, trendConfirmed, volumeConfirmed, momentumConfirmed, riskReward, primary };
}

async function persistSignal(symbol, timeframe, conf) {
  const info = await db.run(
    `INSERT INTO ai_signals
     (symbol, timeframe, direction, confidence, trend_confirmed, volume_confirmed, momentum_confirmed, risk_reward, indicators_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    [
      symbol, timeframe, conf.direction, conf.confidence,
      conf.trendConfirmed ? 1 : 0, conf.volumeConfirmed ? 1 : 0, conf.momentumConfirmed ? 1 : 0,
      conf.riskReward, JSON.stringify(conf.primary.indicators),
    ]
  );
  return info.lastInsertRowid;
}

module.exports = { analyzeTimeframe, buildConfluence, persistSignal, TIMEFRAME_WEIGHT };
