/**
 * 1 BOT 2 STRATEGI - FUTURES - 61 COIN (60 Binance + SOXL Bitget via 104.18.14.166 bypass Komdigi)
 * Strategi 1: SNIPER SMC (20+20+15+15+15+15=100, RR 1:2.5, 1.5x ATR 15M, Trigger 15M)
 * Strategi 2: SESSION VWAP (25+20+15+15+15+10=100, RR 1:2, 1.2x ATR 5M, VWAP Daily + Sweep Session + Jam 19-02)
 * Engine: Claude Opus 5.5 by Anthropic | SOXLUSDT dari api.bitget.com/api/v2/mix via bypass
 */
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SCAN_LIMIT = parseInt(process.env.SCAN_LIMIT || '60', 10);
const CACHE_FILE = '.cache/last_alerts.json';

const STRATEGY_SMC = { name: 'SNIPER SMC', cooldownH: 4 };
const STRATEGY_VWAP = { name: 'SESSION VWAP', cooldownH: 4 };

// ===== Helpers =====
function ema(values, period) {
  const k = 2 / (period + 1);
  let arr = [];
  let sma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  arr[period - 1] = sma;
  for (let i = period; i < values.length; i++) arr[i] = values[i] * k + arr[i - 1] * (1 - k);
  return arr;
}
function atr(candles, period = 14) {
  let tr = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) tr.push(candles[i].high - candles[i].low);
    else tr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  }
  let a = [];
  let s = tr.slice(0, period).reduce((x, y) => x + y, 0) / period;
  a[period - 1] = s;
  for (let i = period; i < tr.length; i++) a[i] = (a[i - 1] * (period - 1) + tr[i]) / period;
  return a;
}
function adx(candles, period = 14) {
  let tr = [], pdm = [], mdm = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, ph = candles[i - 1].high, pl = candles[i - 1].low;
    tr.push(Math.max(h - l, Math.abs(h - candles[i - 1].close), Math.abs(l - candles[i - 1].close)));
    const up = h - ph, down = pl - l;
    let p = 0, m = 0;
    if (up > down && up > 0) p = up;
    if (down > up && down > 0) m = down;
    pdm.push(p); mdm.push(m);
  }
  let sTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let sP = pdm.slice(0, period).reduce((a, b) => a + b, 0);
  let sM = mdm.slice(0, period).reduce((a, b) => a + b, 0);
  let dx = [], pA = [], mA = [];
  for (let i = period - 1; i < tr.length; i++) {
    if (i > period - 1) { sTR = sTR - sTR / period + tr[i]; sP = sP - sP / period + pdm[i]; sM = sM - sM / period + mdm[i]; }
    const pDi = sTR === 0 ? 0 : 100 * sP / sTR;
    const mDi = sTR === 0 ? 0 : 100 * sM / sTR;
    pA.push(pDi); mA.push(mDi);
    const sum = pDi + mDi;
    dx.push(sum === 0 ? 0 : 100 * Math.abs(pDi - mDi) / sum);
  }
  let adxA = []; let f = dx.slice(0, period).reduce((a, b) => a + b, 0) / period; adxA.push(f);
  for (let i = period; i < dx.length; i++) adxA.push((adxA[adxA.length - 1] * (period - 1) + dx[i]) / period);
  return { adx: adxA[adxA.length - 1], plusDI: pA[pA.length - 1], minusDI: mA[mA.length - 1] };
}
function findStructure(candles) {
  let highs = [], lows = [];
  for (let i = 2; i < candles.length - 2; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high && candles[i].high > candles[i - 2].high && candles[i].high > candles[i + 2].high) highs.push({ idx: i, price: candles[i].high });
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low && candles[i].low < candles[i - 2].low && candles[i].low < candles[i + 2].low) lows.push({ idx: i, price: candles[i].low });
  }
  return { highs: highs.slice(-3), lows: lows.slice(-3) };
}
function scanFVG(candles) {
  let out = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2], c3 = candles[i];
    if (c1.high < c3.low) {
      const gap = c3.low - c1.high; const pct = gap / c3.close * 100;
      if (pct >= 0.3) { const mid = c1.high + gap / 2; let mit = false; for (let j = i + 1; j < candles.length; j++) if (candles[j].low < mid) { mit = true; break; } if (!mit) out.push({ type: 'BULL', idx: i, gap, pct, high: c1.high, low: c3.low, mid }); }
    }
    if (c1.low > c3.high) {
      const gap = c1.low - c3.high; const pct = gap / c3.close * 100;
      if (pct >= 0.3) { const mid = c3.high + gap / 2; let mit = false; for (let j = i + 1; j < candles.length; j++) if (candles[j].high > mid) { mit = true; break; } if (!mit) out.push({ type: 'BEAR', idx: i, gap, pct, high: c1.low, low: c3.high, mid }); }
    }
  }
  return out;
}
function scanFVGIntraday(candles, minPct = 0.2) {
  let out = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2], c3 = candles[i];
    if (c1.high < c3.low) { const gap = c3.low - c1.high; const pct = gap / c3.close * 100; if (pct >= minPct) { const mid = c1.high + gap / 2; let mit = false; for (let j = i + 1; j < candles.length; j++) if (candles[j].low < mid) { mit = true; break; } if (!mit) out.push({ type: 'BULL', idx: i, gap, pct, high: c1.high, low: c3.low, mid }); } }
    if (c1.low > c3.high) { const gap = c1.low - c3.high; const pct = gap / c3.close * 100; if (pct >= minPct) { const mid = c3.high + gap / 2; let mit = false; for (let j = i + 1; j < candles.length; j++) if (candles[j].high > mid) { mit = true; break; } if (!mit) out.push({ type: 'BEAR', idx: i, gap, pct, high: c1.low, low: c3.high, mid }); } }
  }
  return out;
}
function detectSweep(candles) {
  if (candles.length < 30) return { has: false };
  const ref = candles.slice(-30, -3);
  const refHigh = Math.max(...ref.map(c => c.high)); const refLow = Math.min(...ref.map(c => c.low));
  for (let k = 0; k < 3; k++) {
    const idx = candles.length - 1 - k, c = candles[idx];
    const eH = (c.high - refHigh) / refHigh * 100;
    if (eH >= 0.2) { let b = false; for (let j = idx; j < Math.min(candles.length, idx + 3); j++) if (candles[j].close < refHigh) b = true; if (b) return { has: true, type: 'HIGH', refHigh, sweepHigh: c.high, pct: eH, idx }; }
    const eL = (refLow - c.low) / refLow * 100;
    if (eL >= 0.2) { let b = false; for (let j = idx; j < Math.min(candles.length, idx + 3); j++) if (candles[j].close > refLow) b = true; if (b) return { has: true, type: 'LOW', refLow, sweepLow: c.low, pct: eL, idx }; }
  }
  return { has: false };
}
function detectSessionSweep(candles15m, pdh, pdl, asiaH, asiaL, midnightOpen) {
  const levels = [];
  if (pdh) levels.push({ name: 'PDH', price: pdh, type: 'HIGH' });
  if (pdl) levels.push({ name: 'PDL', price: pdl, type: 'LOW' });
  if (asiaH) levels.push({ name: 'Asia High', price: asiaH, type: 'HIGH' });
  if (asiaL) levels.push({ name: 'Asia Low', price: asiaL, type: 'LOW' });
  if (midnightOpen) levels.push({ name: 'Midnight Open', price: midnightOpen, type: 'MID' });
  for (let k = 0; k < 3; k++) {
    const idx = candles15m.length - 1 - k, c = candles15m[idx];
    for (const lv of levels) {
      if (lv.type === 'HIGH') {
        const pct = (c.high - lv.price) / lv.price * 100;
        if (pct >= 0.15) { let back = false; for (let j = idx; j < Math.min(candles15m.length, idx + 3); j++) if (candles15m[j].close < lv.price) back = true; if (back) return { has: true, type: 'HIGH', levelName: lv.name, refPrice: lv.price, sweepPrice: c.high, pct, idx }; }
      }
      if (lv.type === 'LOW') {
        const pct = (lv.price - c.low) / lv.price * 100;
        if (pct >= 0.15) { let back = false; for (let j = idx; j < Math.min(candles15m.length, idx + 3); j++) if (candles15m[j].close > lv.price) back = true; if (back) return { has: true, type: 'LOW', levelName: lv.name, refPrice: lv.price, sweepPrice: c.low, pct, idx }; }
      }
    }
  }
  return { has: false };
}
function detectTrigger(c1h, c15m) {
  const s1 = findStructure(c1h); const last = c1h[c1h.length - 1];
  let t = false, dir = null, lvl = null;
  if (s1.highs.length && last.close > s1.highs[s1.highs.length - 1].price) { t = true; dir = 'BULL_BOS'; lvl = s1.highs[s1.highs.length - 1].price; }
  if (s1.lows.length && last.close < s1.lows[s1.lows.length - 1].price) { t = true; dir = 'BEAR_CHoCH'; lvl = s1.lows[s1.lows.length - 1].price; }
  if (!t) { const s15 = findStructure(c15m); const last15 = c15m[c15m.length - 1]; if (s15.highs.length && last15.close > s15.highs[s15.highs.length - 1].price) { t = true; dir = 'BULL_BOS_15M'; lvl = s15.highs[s15.highs.length - 1].price; } if (s15.lows.length && last15.close < s15.lows[s15.lows.length - 1].price) { t = true; dir = 'BEAR_CHoCH_15M'; lvl = s15.lows[s15.lows.length - 1].price; } }
  return { trigger: t, dir, level: lvl };
}
function detectTrigger5m(c5m, c15m) {
  const s15 = findStructure(c15m); const last5 = c5m[c5m.length - 1];
  let t = false, dir = null, lvl = null;
  if (s15.highs.length && last5.close > s15.highs[s15.highs.length - 1].price) { t = true; dir = 'BULL_BOS_5M'; lvl = s15.highs[s15.highs.length - 1].price; }
  if (s15.lows.length && last5.close < s15.lows[s15.lows.length - 1].price) { t = true; dir = 'BEAR_CHoCH_5M'; lvl = s15.lows[s15.lows.length - 1].price; }
  if (!t) { const s5 = findStructure(c5m); if (s5.highs.length && last5.close > s5.highs[s5.highs.length - 1].price) { t = true; dir = 'BULL_BOS_5M_in'; lvl = s5.highs[s5.highs.length - 1].price; } if (s5.lows.length && last5.close < s5.lows[s5.lows.length - 1].price) { t = true; dir = 'BEAR_CHoCH_5M_in'; lvl = s5.lows[s5.lows.length - 1].price; } }
  return { trigger: t, dir, level: lvl };
}
function calcVWAPDaily(c5m) {
  // VWAP Daily Futures: dari kline 5M sejak 00:00 UTC hari ini
  const now = Date.now();
  const utcMidnight = Math.floor(now / 86400000) * 86400000;
  let pv = 0, v = 0;
  for (const c of c5m) {
    // Ganti: gunakan candle openTime jika ada, fallback pakai semua jika tidak tau waktu -> pakai 288 candle terakhir (24h * 12)
    // ambil 288 candle 5M terakhir = 24 jam
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    v += c.volume;
  }
  // Filter hanya hari ini jika ada time
  if (c5m.length > 0 && c5m[0].openTime) {
    pv = 0; v = 0;
    for (const c of c5m) if (c.openTime >= utcMidnight) { pv += ((c.high + c.low + c.close) / 3) * c.volume; v += c.volume; }
  } else {
    // fallback: pakai 288 terakhir yang sudah 24 jam
  }
  return v > 0 ? pv / v : c5m[c5m.length - 1]?.close || 0;
}
function getWIBHour() {
  return (new Date().getUTCHours() + 7) % 24;
}
function getSessionJamScore() {
  const h = getWIBHour();
  // A+ 19.00-02.00 WIB
  if (h >= 19 || h < 2) return 10;
  if (h >= 14 && h < 19) return 0; // hati-hati tapi 0 poin
  return 0; // jam sampah 02-14
}
function getSessionLabel() {
  const h = getWIBHour();
  if (h >= 19 || h < 2) return `A+ 19.00-02.00 WIB (h=${h}) +10`;
  if (h >= 14 && h < 19) return `B 14.00-19.00 WIB (h=${h}) 0`;
  return `SAMPAH 02.00-14.00 WIB (h=${h}) 0 - DILARANG ENTRY 5M`;
}

async function fetchKlinesFutures(symbol, interval, limit) {
  const isBitget = symbol.endsWith("SOXLUSDT") || symbol.includes("SOXL");
  if (isBitget) {
    const granMap = { "1d":"1D", "4h":"4H", "1h":"1H", "15m":"15m", "5m":"5m" };
    const gran = granMap[interval] || interval;
    const url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=SOXLUSDT&productType=USDT-FUTURES&granularity=${gran}&limit=${limit}`;
    let r;
    try { r = await fetch(url, { headers: { "Host":"api.bitget.com", "User-Agent":"Mozilla/5.0" } }); }
    catch { // fallback via IP bypass Komdigi
      const ipUrl = `https://104.18.14.166/api/v2/mix/market/candles?symbol=SOXLUSDT&productType=USDT-FUTURES&granularity=${gran}&limit=${limit}`;
      r = await fetch(ipUrl, { headers: { "Host":"api.bitget.com", "User-Agent":"Mozilla/5.0" } });
    }
    if (!r.ok) {
      // last fallback IP
      const ipUrl2 = `https://104.18.14.166/api/v2/mix/market/candles?symbol=SOXLUSDT&productType=USDT-FUTURES&granularity=${gran}&limit=${limit}`;
      r = await fetch(ipUrl2, { headers: { "Host":"api.bitget.com", "User-Agent":"Mozilla/5.0" } });
    }
    if (!r.ok) throw new Error(`BITGET FUTURES SOXLUSDT ${interval} ${r.status} - ${await r.text().then(t=>t.slice(0,150))}`);
    const j = await r.json();
    if (j.code !== "00000") throw new Error(`BITGET SOXLUSDT ${interval} code ${j.code} msg ${j.msg}`);
    const data = j.data.map(x => ({ openTime: +x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[6], closeTime: +x[0] }));
    data.sort((a,b)=>a.openTime-b.openTime);
    return data;
  }
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`BINANCE FUTURES ${symbol} ${interval} ${r.status} - ${await r.text().then(t=>t.slice(0,150))}`);
  const d = await r.json();
  return d.map(x => ({ openTime: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5], closeTime: x[6] }));
}
async function fetchFunding(symbol) {
  if (symbol.includes("SOXL")) {
    try { const r = await fetch(`https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol=SOXLUSDT&productType=USDT-FUTURES&limit=1`, { headers: { "Host":"api.bitget.com" } }).catch(()=>fetch(`https://104.18.14.166/api/v2/mix/market/history-fund-rate?symbol=SOXLUSDT&productType=USDT-FUTURES&limit=1`, { headers: { "Host":"api.bitget.com" } })); if(!r||!r.ok) return null; const j=await r.json(); return j.data?.[0]?+j.data[0].fundingRate:null; } catch { return null; }
  }
  try { const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`); if (!r.ok) return null; const j = await r.json(); return j[0] ? +j[0].fundingRate : null; } catch { return null; }
}
async function fetchOI(symbol) {
  if (symbol.includes("SOXL")) {
    try { const r = await fetch(`https://api.bitget.com/api/v2/mix/market/open-interest?symbol=SOXLUSDT&productType=USDT-FUTURES`, { headers: { "Host":"api.bitget.com" } }).catch(()=>fetch(`https://104.18.14.166/api/v2/mix/market/open-interest?symbol=SOXLUSDT&productType=USDT-FUTURES`, { headers: { "Host":"api.bitget.com" } })); if(!r||!r.ok) return null; const j=await r.json(); return j.data?.openInterestList?.[0]?.size ? +j.data.openInterestList[0].size : (j.data?.openInterest ? +j.data.openInterest : null); } catch { return null; }
  }
  try { const r = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`); if (!r.ok) return null; const j = await r.json(); return j.openInterest ? +j.openInterest : null; } catch { return null; }
}

// ===== SCORING SNIPER SMC =====
function scoreSniperSMC(ctx) {
  const { bull1d, bear1d, bull4h, bear4h, sweep, fBear, fBull, trig, volConfirm, rrS, rrL } = ctx;
  function calc(dir) {
    let s = 0, det = {};
    if (dir === 'SHORT') { det.htf = bear1d && bear4h ? 20 : 0; s += det.htf; det.sweep = sweep.has && sweep.type === 'HIGH' ? 20 : 0; s += det.sweep; det.smc = fBear.length > 0 ? 15 : 0; s += det.smc; det.vol = volConfirm && sweep.type === 'HIGH' ? 15 : 0; s += det.vol; det.trigger = trig.trigger && trig.dir && trig.dir.includes('BEAR') ? 15 : 0; s += det.trigger; det.rr = rrS >= 2.5 ? 15 : 0; s += det.rr; det.rrVal = rrS; }
    else { det.htf = bull1d && bull4h ? 20 : 0; s += det.htf; det.sweep = sweep.has && sweep.type === 'LOW' ? 20 : 0; s += det.sweep; det.smc = fBull.length > 0 ? 15 : 0; s += det.smc; det.vol = volConfirm && sweep.type === 'LOW' ? 15 : 0; s += det.vol; det.trigger = trig.trigger && trig.dir && trig.dir.includes('BULL') ? 15 : 0; s += det.trigger; det.rr = rrL >= 2.5 ? 15 : 0; s += det.rr; det.rrVal = rrL; }
    return { score: s, det, rr: dir === 'SHORT' ? rrS : rrL };
  }
  const scS = calc('SHORT'), scL = calc('LONG');
  const best = scS.score >= scL.score ? { dir: 'SHORT', ...scS } : { dir: 'LONG', ...scL };
  return { sniperShort: scS.score, sniperLong: scL.score, bestDir: best.dir, bestScore: best.score, bestRR: best.rr, bestDet: best.det, scSDet: scS.det, scLDet: scL.det, rrS, rrL };
}

// ===== SCORING SESSION VWAP =====
function scoreSessionVWAP(ctx) {
  const { dailyBias, vwap, price, sweepSession, reclaim, trig5m, fvg5m, fvg15m, volConfirmVwap, fundingOk, oiOk, rrVwapShort, rrVwapLong, adx1h, isChoppy } = ctx;
  // dailyBias: 'Bullish' | 'Bearish' | 'Sideways'
  // reclaim: { has: bool, type: 'LONG'/'SHORT', pct? }
  const hasFVG = (fvg5m.length > 0 || fvg15m.length > 0);
  function calc(dir) {
    let s = 0, det = {};
    const biasOk = (dir === 'LONG' && dailyBias === 'Bullish') || (dir === 'SHORT' && dailyBias === 'Bearish');
    det.bias = biasOk ? 25 : 0; if (isChoppy) det.bias = 0; s += det.bias;
    det.sweep = (sweepSession.has && ((dir === 'LONG' && sweepSession.type === 'LOW') || (dir === 'SHORT' && sweepSession.type === 'HIGH'))) ? 20 : 0; s += det.sweep;
    det.reclaim = (reclaim.has && reclaim.type === dir) ? 15 : 0; s += det.reclaim;
    const trigOk = trig5m.trigger && trig5m.dir && ((dir === 'LONG' && trig5m.dir.includes('BULL')) || (dir === 'SHORT' && trig5m.dir.includes('BEAR')));
    det.trigger = (trigOk && hasFVG) ? 15 : 0; s += det.trigger;
    det.flow = (volConfirmVwap && ((dir === 'LONG' && reclaim.type === 'LONG') || (dir === 'SHORT' && reclaim.type === 'SHORT'))) || fundingOk || oiOk ? 15 : 0; // simplified
    // stricter: vol must searah reclaim
    if (volConfirmVwap) {
      const volOk = (dir === 'LONG' && reclaim.type === 'LONG') || (dir === 'SHORT' && reclaim.type === 'SHORT');
      det.flow = volOk ? 15 : 0;
    } else if (fundingOk || oiOk) det.flow = 15; else det.flow = 0;
    s = det.bias + det.sweep + det.reclaim + det.trigger + det.flow;
    det.jam = getSessionJamScore(); s += det.jam;
    det.rr = (dir === 'SHORT' ? rrVwapShort : rrVwapLong) >= 2 ? 10 : 0; // RR 1:2 minimal, tapi skor RR tidak masuk 100? Prompt RR masuk LAYER 5 tapi scoring 100 sudah 25+20+15+15+15+10=100 jadi RR masuk invalid jika <2 (tidak + poin, tapi wajib 1:2)
    // Untuk tetap 100, RR tidak nambah poin, tapi jika RR <2, kurangi? Prompt RR di LAYER 5, tapi scoring 100: bikin RR sebagai gate, bukan poin. Kita pakai poin Jam. Jika RR <2, set score = 0? Sesuai aturan keras RR 1:2 jika tidak tercapai = SKIP.
    const rr = dir === 'SHORT' ? rrVwapShort : rrVwapLong;
    det.rrVal = rr;
    if (rr < 2) { /* tetap score tapi nanti KEPUTUSAN jadi NO TRADE karena RR gate */ }
    return { score: s, det, rr };
  }
  const scS = calc('SHORT'), scL = calc('LONG');
  // ADX gate: if adx1h <20 => force 0
  if (adx1h < 20) { scS.score = 0; scL.score = 0; }
  const best = scS.score >= scL.score ? { dir: 'SHORT', ...scS } : { dir: 'LONG', ...scL };
  // RR gate: if RR <2, bestScore = 0 (SKIP)
  if (best.rr < 2) best.score = 0;
  if (isChoppy) { scS.score = 0; scL.score = 0; best.score = 0; }
  return { vwapShort: scS.score, vwapLong: scL.score, bestDir: best.dir, bestScore: best.score, bestRR: best.rr, bestDet: best.det, scSDet: scS.det, scLDet: scL.det };
}

async function buildContext(symbol) {
  const [d1, h4, h1, m15, m5] = await Promise.all([
    fetchKlinesFutures(symbol, '1d', 10),
    fetchKlinesFutures(symbol, '4h', 250),
    fetchKlinesFutures(symbol, '1h', 100),
    fetchKlinesFutures(symbol, '15m', 200),
    fetchKlinesFutures(symbol, '5m', 300)
  ]);
  const c1d = d1.map(c => c.close);
  const c4h = h4.map(c => c.close);
  const e50d = ema(c1d, 50), e200d = ema(c1d, 200), e50h = ema(c4h, 50), e200h = ema(c4h, 200);
  const lastD = d1[d1.length - 1], last4 = h4[h4.length - 1], last15 = m15[m15.length - 1], last5 = m5[m5.length - 1];
  const price = last4.close; // Futures Last Price dari 4H (sama dengan 5M close)
  const price5m = last5.close;
  const dailyOpen = d1[d1.length - 1].open; // Midnight Open Futures 07.00 WIB = 00:00 UTC
  const vwap = calcVWAPDaily(m5);
  // PDH/PDSL Asia
  const pdh = d1.length >= 2 ? d1[d1.length - 2].high : null;
  const pdl = d1.length >= 2 ? d1[d1.length - 2].low : null;
  // Asia High/Low: 00.00-14.00 WIB = 17.00-07.00 UTC -> filter m15 where WIB 0-14
  let asiaHigh = null, asiaLow = null;
  for (const c of m15) {
    const t = c.openTime; const hWIB = (new Date(t).getUTCHours() + 7) % 24;
    if (hWIB >= 0 && hWIB < 14) { asiaHigh = asiaHigh === null ? c.high : Math.max(asiaHigh, c.high); asiaLow = asiaLow === null ? c.low : Math.min(asiaLow, c.low); }
  }
  // Daily Bias
  let dailyBias = 'Sideways';
  let isChoppy = false;
  const distVWAP = Math.abs(price - vwap) / vwap * 100;
  if (price > dailyOpen && price > vwap) dailyBias = 'Bullish';
  else if (price < dailyOpen && price < vwap) dailyBias = 'Bearish';
  else { dailyBias = 'Sideways'; if (distVWAP < 0.15) isChoppy = true; }

  const adx1h = adx(h1, 14).adx;
  const atr15 = atr(m15, 14), atr5 = atr(m5, 14);
  const atrSL_Sniper = atr(m15, 14)[atr(m15, 14).length - 1] || atr5[atr5.length - 1];
  const atrSL_VWAP = atr5[atr5.length - 1];

  const sweep = detectSweep(h4);
  const sweepSession = detectSessionSweep(m15, pdh, pdl, asiaHigh, asiaLow, dailyOpen);

  const fBull = scanFVG(h4).filter(x=>x.type==='BULL'), fBear = scanFVG(h4).filter(x=>x.type==='BEAR');
  const fvg5m = scanFVGIntraday(m5, 0.2), fvg15m = scanFVGIntraday(m15, 0.2);
  const trig = detectTrigger(h1, m15);
  const trig5m = detectTrigger5m(m5, m15);

  const volMA20_H4 = h4.slice(-21, -1).reduce((a,c)=>a+c.volume,0)/20;
  const volMA20_15 = m15.slice(-21, -1).reduce((a,c)=>a+c.volume,0)/20;
  let volConfirm = false; if (sweep.has) { const sv = h4[sweep.idx].volume; if (sv > volMA20_H4*1.2) volConfirm = true; }
  let volConfirmVwap = false;
  // reclaim detection: LONG = sweep low + close back above VWAP, SHORT = sweep high + close back below VWAP
  let reclaim = { has: false, type: null };
  if (sweepSession.has) {
    if (sweepSession.type === 'LOW' && price5m > vwap && m5[m5.length - 2]?.close < vwap) reclaim = { has: true, type: 'LONG' };
    if (sweepSession.type === 'HIGH' && price5m < vwap && m5[m5.length - 2]?.close > vwap) reclaim = { has: true, type: 'SHORT' };
    // fallback: jika tidak ada cross, tapi sweepSession ada + price di sisi VWAP benar = reclaim dianggap ada
    if (!reclaim.has) {
      if (sweepSession.type === 'LOW' && price5m > vwap) reclaim = { has: true, type: 'LONG' };
      if (sweepSession.type === 'HIGH' && price5m < vwap) reclaim = { has: true, type: 'SHORT' };
    }
  }
  // volume spike searah reclaim di 5M
  const last5Vol = m5[m5.length - 1].volume; const volMA20_5 = m5.slice(-21,-1).reduce((a,c)=>a+c.volume,0)/20;
  if (reclaim.has) {
    if (reclaim.type === 'LONG' && last5Vol > volMA20_5*1.2 && price5m > m5[m5.length - 2].close) volConfirmVwap = true;
    if (reclaim.type === 'SHORT' && last5Vol > volMA20_5*1.2 && price5m < m5[m5.length - 2].close) volConfirmVwap = true;
  }

  const s4 = findStructure(h4);
  const nextHigh = s4.highs.length ? s4.highs[s4.highs.length - 1].price : Math.max(...h4.slice(-20).map(c=>c.high));
  const nextLow = s4.lows.length ? s4.lows[s4.lows.length - 1].price : Math.min(...h4.slice(-20).map(c=>c.low));
  const rrS = (()=>{ if(sweep.has&&sweep.type==='HIGH'){ const sl=sweep.sweepHigh+1.5*atrSL_Sniper+price*0.001; return Math.abs(price-nextLow)/Math.abs(sl-price);} const sl=nextHigh+1.5*atrSL_Sniper; return Math.abs(price-nextLow)/Math.abs(sl-price);})();
  const rrL = (()=>{ if(sweep.has&&sweep.type==='LOW'){ const sl=sweep.sweepLow-1.5*atrSL_Sniper-price*0.001; return Math.abs(nextHigh-price)/Math.abs(price-sl);} const sl=nextLow-1.5*atrSL_Sniper; return Math.abs(nextHigh-price)/Math.abs(price-sl);})();
  // VWAP RR ke Asia/PDH/PDL
  const tpVwapLong = pdh || nextHigh, tpVwapShort = pdl || nextLow;
  const rrVwapLong = (()=>{ const sl = sweepSession.has&&sweepSession.type==='LOW'? sweepSession.sweepPrice -1.2*atrSL_VWAP - price*0.001 : nextLow -1.2*atrSL_VWAP; return Math.abs(tpVwapLong-price)/Math.abs(price-sl);})();
  const rrVwapShort = (()=>{ const sl = sweepSession.has&&sweepSession.type==='HIGH'? sweepSession.sweepPrice +1.2*atrSL_VWAP + price*0.001 : nextHigh +1.2*atrSL_VWAP; return Math.abs(price-tpVwapShort)/Math.abs(sl-price);})();

  const funding = await fetchFunding(symbol);
  const oi = await fetchOI(symbol);
  let fundingOk = false, oiOk = false;
  if (funding !== null) { if (reclaim.type==='LONG' && funding < 0) fundingOk = true; if (reclaim.type==='SHORT' && funding > 0.0005) fundingOk = false; }
  // OI naik tinggi saat sweep high = fake pump jangan LONG - simplified

  return {
    symbol, price, price5m, dailyOpen, vwap, pdh, pdl, asiaHigh, asiaLow,
    dailyBias, isChoppy, adx1h, adx1hVal: adx(h1,14),
    atrSL_Sniper, atrSL_VWAP, nextHigh, nextLow, tpVwapLong, tpVwapShort,
    sweep, sweepSession, fBull, fBear, fvg5m, fvg15m, trig, trig5m,
    volConfirm, volConfirmVwap, volMA20_H4, rrS, rrL, rrVwapLong, rrVwapShort,
    funding, oi, fundingOk, oiOk,
    e50d: e50d[e50d.length-1], e200d: e200d[e200d.length-1], e50h: e50h[e50h.length-1], e200h: e200h[e200h.length-1],
    lastDClose: lastD.close, last4Close: last4.close, h4, m15, m5, d1, h1
  };
}

function loadCache(){ try{ if(fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE,'utf8')); }catch{} return {}; }
function saveCache(o){ try{ const d=path.dirname(CACHE_FILE); if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(CACHE_FILE, JSON.stringify(o,null,2)); }catch(e){ console.warn(e.message); } }
function canAlert(cache, key, hours){ const last=cache[key]; if(!last) return true; return (Date.now()-last)/3600000 >= hours; }

async function sendText(text){
  if(!TOKEN||!CHAT_ID){ console.log(`[DRY]\n${text}`); return; }
  const r=await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,text,disable_web_page_preview:true})});
  const j=await r.json(); if(!j.ok) throw new Error(JSON.stringify(j));
}

function fmtFutures(v){ return v.toFixed(v>10?2:4); }

function formatSniperSMC(ctx, sc){
  const d=sc.bestDet; const rrOk=sc.bestRR>=2.5; const risk=Math.abs(ctx.price - (sc.bestDir==='SHORT'? ctx.sweep.has&&ctx.sweep.type==='HIGH'?ctx.sweep.sweepHigh+1.5*ctx.atrSL_Sniper+ctx.price*0.001:ctx.nextHigh+1.5*ctx.atrSL_Sniper : ctx.sweep.has&&ctx.sweep.type==='LOW'?ctx.sweep.sweepLow-1.5*ctx.atrSL_Sniper-ctx.price*0.001:ctx.nextLow-1.5*ctx.atrSL_Sniper));
  let entry=ctx.price, sl=0, tp1=0, tp2=0;
  if(sc.bestDir==='SHORT'){ sl=ctx.sweep.has&&ctx.sweep.type==='HIGH'?ctx.sweep.sweepHigh+1.5*ctx.atrSL_Sniper+ctx.price*0.001:ctx.nextHigh+1.5*ctx.atrSL_Sniper; tp1=ctx.nextLow; tp2=ctx.nextLow-(ctx.nextHigh-ctx.nextLow)*0.5; }
  else { sl=ctx.sweep.has&&ctx.sweep.type==='LOW'?ctx.sweep.sweepLow-1.5*ctx.atrSL_Sniper-ctx.price*0.001:ctx.nextLow-1.5*ctx.atrSL_Sniper; tp1=ctx.nextHigh; tp2=ctx.nextHigh+(ctx.nextHigh-ctx.nextLow)*0.5; }
  if(sc.bestScore<85) return `🚨 [${STRATEGY_SMC.name}] ${ctx.symbol} ${sc.bestDir} Skor ${sc.bestScore}/100 NO TRADE\nSource: Binance Futures USDT-M - ${ctx.symbol}\nADX 4H ${ctx.adx1hVal.adx.toFixed(1)} | HTF ${d.htf} Sweep ${d.sweep} SMC ${d.smc} Vol ${d.vol} Trigger ${d.trigger} RR ${d.rr} | RR ${sc.bestRR.toFixed(2)}\nTIDAK ADA ENTRY PLAN - SKOR TIDAK MEMENUHI SYARAT A+ - MENUNGGU SWEEP & RECLAIM BERIKUTNYA`;
  return `🚨 [${STRATEGY_SMC.name}] A+ ${ctx.symbol} ${sc.bestDir} Skor ${sc.bestScore}/100\nSource: Binance Futures USDT-M - ${ctx.symbol}\nHTF ${d.htf} Sweep ${d.sweep} SMC ${d.smc} Vol ${d.vol} Trigger ${d.trigger} RR ${d.rr} = ${sc.bestScore}/100 A+ BOLEH ENTRY ✅\n💰 Entry ${fmtFutures(entry)} SL ${fmtFutures(sl)} (1.5x ATR ${fmtFutures(ctx.atrSL_Sniper)}) TP1 ${fmtFutures(tp1)} TP2 ${fmtFutures(tp2)} RR 1:${sc.bestRR.toFixed(2)} ${rrOk?'MEMENUHI':'GAGAL'}\nPos Size: (Modal x 1%) / ${risk.toFixed(4)} | Price ${fmtFutures(ctx.price)} | ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC`;
}

function formatSessionVWAP(ctx, sc){
  const d=sc.bestDet; const hWIB=getWIBHour(); const jamLabel=getSessionLabel();
  const entry = sc.bestDir==='SHORT'? ctx.price5m : ctx.price5m;
  let sl=0, tp1=0, tp2=0;
  if(sc.bestDir==='SHORT'){ sl = ctx.sweepSession.has && ctx.sweepSession.type==='HIGH' ? ctx.sweepSession.sweepPrice +1.2*ctx.atrSL_VWAP + ctx.price*0.001 : ctx.nextHigh +1.2*ctx.atrSL_VWAP; tp1 = ctx.pdl || ctx.nextLow; tp2 = ctx.asiaLow || ctx.pdl || ctx.nextLow; }
  else { sl = ctx.sweepSession.has && ctx.sweepSession.type==='LOW' ? ctx.sweepSession.sweepPrice -1.2*ctx.atrSL_VWAP - ctx.price*0.001 : ctx.nextLow -1.2*ctx.atrSL_VWAP; tp1 = ctx.pdh || ctx.nextHigh; tp2 = ctx.asiaHigh || ctx.pdh || ctx.nextHigh; }
  const risk=Math.abs(entry-sl); const rr=sc.bestRR;
  const fundingStr = ctx.funding!==null ? (ctx.funding*100).toFixed(4)+'%' : 'DATA TIDAK TERLIHAT';
  const oiStr = ctx.oi!==null ? fmtFutures(ctx.oi) : 'DATA TIDAK TERLIHAT';
  const exchLabel = ctx.symbol.includes("SOXL") ? "Bitget" : "Binance";
  const biasStr = `${ctx.dailyBias} | ${ctx.price > ctx.vwap ? 'di atas VWAP':'di bawah VWAP'} | VWAP ${fmtFutures(ctx.vwap)} | DailyOpen ${fmtFutures(ctx.dailyOpen)} ${ctx.isChoppy?'(CHOPPY)':''}`;
  const sweepStr = ctx.sweepSession.has ? `${ctx.sweepSession.type} Sweep ${ctx.sweepSession.levelName} ${fmtFutures(ctx.sweepSession.refPrice)} -> ${fmtFutures(ctx.sweepSession.sweepPrice)} (${ctx.sweepSession.pct.toFixed(2)}%) VALID` : 'TIDAK ADA Sweep Session Futures VALID';
  const reclaimStr = ctx.reclaim ? (ctx.reclaim.has? `${ctx.reclaim.type} Reclaim VWAP VALID | Close 5M ${fmtFutures(ctx.price5m)} ${ctx.reclaim.type==='LONG'?'di atas VWAP':'di bawah VWAP'}` : 'TIDAK ADA Reclaim VWAP Futures') : 'DATA TIDAK TERLIHAT';
  const trigStr = ctx.trig5m.trigger ? `${ctx.trig5m.dir} 5M Futures Close ${fmtFutures(ctx.trig5m.level)} VALID | FVG 5M ${ctx.fvg5m.length} 15M ${ctx.fvg15m.length} ${ctx.fvg5m.length+ctx.fvg15m.length>0?'VALID':'TIDAK'}` : 'TIDAK ADA BOS/CHoCH 5M Futures VALID | FVG Futures tidak valid';
  const flowStr = d.flow ? `Mendukung +15 | Vol Spike ${ctx.volConfirmVwap?'VALID':'TIDAK'} | Funding ${fundingStr} | OI ${oiStr}` : `Tidak Mendukung 0 | Funding ${fundingStr} | OI ${oiStr}`;
  const jamStr = `${jamLabel}`;
  const kategori = sc.bestScore>=85?'A+ BOLEH ENTRY': sc.bestScore>=70?'A WATCHLIST':'NO TRADE';

  if(sc.bestScore<85){
    return `1. KEPUTUSAN: NO TRADE | SKOR: ${sc.bestScore}/100 | KATEGORI: ${kategori} | JAM: ${hWIB.toString().padStart(2,'0')}.00 WIB | SOURCE: ${exchLabel} Futures USDT-M - ${ctx.symbol}\n2. LAYER 0 - DAILY BIAS FUTURES: ${biasStr} | ADX 1H ${ctx.adx1h.toFixed(1)} ${ctx.adx1h<20?'GAGAL (<20)':'LULUS'} | Funding ${fundingStr} | OI ${oiStr} -> ${ctx.isChoppy||ctx.adx1h<20?'GAGAL':'LULUS'}\n3. LAYER 1 - SESSION LIQUIDITY FUTURES: ${sweepStr} | PDH ${ctx.pdh?fmtFutures(ctx.pdh):'-'} PDL ${ctx.pdl?fmtFutures(ctx.pdl):'-'} Asia H ${ctx.asiaHigh?fmtFutures(ctx.asiaHigh):'-'} L ${ctx.asiaLow?fmtFutures(ctx.asiaLow):'-'} Midnight ${fmtFutures(ctx.dailyOpen)}\n4. LAYER 2 - VWAP RECLAIM FUTURES: ${reclaimStr}\n5. LAYER 3 - TRIGGER INTRADAY FUTURES: ${trigStr}\n6. LAYER 4 - VOLUME/FLOW FUTURES: ${flowStr}\n7. SCORING RINCI: Bias/VWAP ${d.bias}/25 + Sweep ${d.sweep}/20 + Reclaim ${d.reclaim}/15 + Trigger ${d.trigger}/15 + Flow ${d.flow}/15 + Jam ${d.jam}/10 = ${sc.bestScore}/100\n8. ENTRY PLAN FUTURES: TIDAK ADA ENTRY PLAN - SKOR TIDAK MEMENUHI SYARAT A+ - MENUNGGU SWEEP & RECLAIM FUTURES BERIKUTNYA\n9. INVALIDATION FUTURES: WAJIB close sebelum 07.00 WIB | CUT jika 15M CLOSE kembali ke sisi VWAP salah\n10. KESIMPULAN TEGAS: MENUNGGU SWEEP & RECLAIM VWAP FUTURES DI SESI NY 19.00-02.00 WIB | Source: ${exchLabel} Futures USDT-M - ${ctx.symbol}`;
  }
  return `1. KEPUTUSAN: ${sc.bestDir} | SKOR: ${sc.bestScore}/100 | KATEGORI: ${kategori} | JAM: ${hWIB.toString().padStart(2,'0')}.00 WIB | SOURCE: ${exchLabel} Futures USDT-M - ${ctx.symbol}\n2. LAYER 0 - DAILY BIAS FUTURES: ${biasStr} | ADX 1H ${ctx.adx1h.toFixed(1)} LULUS | Funding ${fundingStr} | OI ${oiStr} -> LULUS\n3. LAYER 1 - SESSION LIQUIDITY FUTURES: ${sweepStr}\n4. LAYER 2 - VWAP RECLAIM FUTURES: ${reclaimStr}\n5. LAYER 3 - TRIGGER INTRADAY FUTURES: ${trigStr}\n6. LAYER 4 - VOLUME/FLOW FUTURES: ${flowStr}\n7. SCORING RINCI: Bias/VWAP ${d.bias}/25 + Sweep ${d.sweep}/20 + Reclaim ${d.reclaim}/15 + Trigger ${d.trigger}/15 + Flow ${d.flow}/15 + Jam ${d.jam}/10 = ${sc.bestScore}/100\n8. ENTRY PLAN FUTURES:\n   Entry: $${fmtFutures(entry)} (${exchLabel} Futures Last Price)\n   Stop Loss: $${fmtFutures(sl)} (1.2x ATR 5M ${fmtFutures(ctx.atrSL_VWAP)} + buffer FVG Futures)\n   TP1: $${fmtFutures(tp1)} (RR 1:1 - Tutup 50%)\n   TP2: $${fmtFutures(tp2)} (RR 1:${rr.toFixed(1)} ke ${sc.bestDir==='LONG'?'PDH':'PDL'} Futures)\n   RR Ratio: 1:${rr.toFixed(2)}\n   Estimasi Hold: 2-6 Jam (Wajib close sebelum 07.00 WIB)\n9. INVALIDATION FUTURES: Jika CLOSE 15M Futures kembali ke sisi VWAP salah di $${fmtFutures(ctx.vwap)} = CUT MANUAL -0.5R\n10. KESIMPULAN TEGAS: ENTRY ${sc.bestDir} menunggu reclaim VWAP Futures sukses di sesi NY | Source: ${exchLabel} Futures USDT-M - ${ctx.symbol}`;
}

async function main(){
  console.log(`[1 BOT 2 STRATEGI] Start ${new Date().toISOString()} WIB ${getWIBHour().toString().padStart(2,'0')}:00 SCAN ${SCAN_LIMIT} FUTURES`);
  if(!TOKEN||!CHAT_ID) console.log('[WARN] DRY RUN');
  const tickRes=await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
  if(!tickRes.ok) throw new Error(`FAPI ticker failed ${tickRes.status}`);
  const tickData=await tickRes.json();
  const usdt=tickData.filter(d=>d.symbol.endsWith('USDT')&&!d.symbol.includes('UP')&&!d.symbol.includes('DOWN')).filter(d=>!['USDCUSDT','FDUSDUSDT'].includes(d.symbol)).sort((a,b)=>parseFloat(b.quoteVolume)-parseFloat(a.quoteVolume));
  let scanList=usdt.slice(0,SCAN_LIMIT).map(d=>d.symbol);
  // SOXLUSDT Bitget Futures: tambah manual karena tidak ada di Binance Futures 60 (leveraged ETF 3x)
  if(!scanList.includes("SOXLUSDT")) scanList.push("SOXLUSDT");
  // Optional: batasi tetap 61 (60 Binance + SOXL Bitget)
  console.log(`[SCAN] ${scanList.join(', ')} (Binance Futures + SOXL Bitget via 104.18.14.166)`);
  const cache=loadCache();
  let alertedSniper=0, alertedVwap=0, scanned=0;
  let topSniper=[], topVwap=[];
  for(let i=0;i<scanList.length;i+=5){
    const batch=scanList.slice(i,i+5);
    const results=await Promise.all(batch.map(async sym=>{
      try{
        const ctx=await buildContext(sym);
        // Score both
        const adx1hVal=ctx.adx1h;
        const sweepForSniper=ctx.sweep;
        // Sniper SMC scoring reuses same ctx but needs rrS/rrL
        const sniperCtx={ bull1d: ctx.price>ctx.e50d&&ctx.e50d>ctx.e200d, bear1d: ctx.price<ctx.e50d&&ctx.e50d<ctx.e200d, bull4h: ctx.price>ctx.e50h&&ctx.e50h>ctx.e200h, bear4h: ctx.price<ctx.e50h&&ctx.e50h<ctx.e200h, sweep: ctx.sweep, fBear: ctx.fBear, fBull: ctx.fBull, trig: ctx.trig, volConfirm: ctx.volConfirm, rrS: (()=>{ const sl=ctx.sweep.has&&ctx.sweep.type==='HIGH'?ctx.sweep.sweepHigh+1.5*ctx.atrSL_Sniper+ctx.price*0.001:ctx.nextHigh+1.5*ctx.atrSL_Sniper; return Math.abs(ctx.price-ctx.nextLow)/Math.abs(sl-ctx.price);})(), rrL: (()=>{ const sl=ctx.sweep.has&&ctx.sweep.type==='LOW'?ctx.sweep.sweepLow-1.5*ctx.atrSL_Sniper-ctx.price*0.001:ctx.nextLow-1.5*ctx.atrSL_Sniper; return Math.abs(ctx.nextHigh-ctx.price)/Math.abs(ctx.price-sl);})() };
        const sniperScore=scoreSniperSMC(sniperCtx);
        const vwapScore=scoreSessionVWAP({ dailyBias: ctx.dailyBias, vwap: ctx.vwap, price: ctx.price, sweepSession: ctx.sweepSession, reclaim: ctx.reclaim, trig5m: ctx.trig5m, fvg5m: ctx.fvg5m, fvg15m: ctx.fvg15m, volConfirmVwap: ctx.volConfirmVwap, fundingOk: ctx.funding!==null&&ctx.funding<0, oiOk: false, rrVwapShort: (()=>{ const sl=ctx.sweepSession.has&&ctx.sweepSession.type==='HIGH'?ctx.sweepSession.sweepPrice+1.2*ctx.atrSL_VWAP+ctx.price*0.001:ctx.nextHigh+1.2*ctx.atrSL_VWAP; return Math.abs(ctx.price-(ctx.pdl||ctx.nextLow))/Math.abs(sl-ctx.price);})(), rrVwapLong: (()=>{ const sl=ctx.sweepSession.has&&ctx.sweepSession.type==='LOW'?ctx.sweepSession.sweepPrice-1.2*ctx.atrSL_VWAP-ctx.price*0.001:ctx.nextLow-1.2*ctx.atrSL_VWAP; return Math.abs((ctx.pdh||ctx.nextHigh)-ctx.price)/Math.abs(ctx.price-sl);})(), adx1h: ctx.adx1h, isChoppy: ctx.isChoppy });
        return { symbol: sym, ctx, sniperScore, vwapScore };
      }catch(e){ return { symbol: sym, error: e.message }; }
    }));
    for(const r of results){
      scanned++;
      if(r.error){ console.log(`[ERR] ${r.symbol} ${r.error}`); continue; }
      const snip=r.sniperScore, vwap=r.vwapScore;
      topSniper.push({ s: r.symbol, sc: snip.bestScore, dir: snip.bestDir, rr: snip.bestRR.toFixed(1) });
      topVwap.push({ s: r.symbol, sc: vwap.bestScore, dir: vwap.bestDir, rr: vwap.bestRR.toFixed(1) });
      console.log(`[SCORE] ${r.symbol} [SNIPER SMC] ${snip.bestDir} ${snip.bestScore}/100 RR ${snip.bestRR.toFixed(1)} | [SESSION VWAP] ${vwap.bestDir} ${vwap.bestScore}/100 RR ${vwap.bestRR.toFixed(1)} SweepSess ${r.ctx.sweepSession.has?r.ctx.sweepSession.levelName:'-'} VWAP ${r.ctx.vwap.toFixed(2)} Jam ${getWIBHour()}`);
      // Send SNIPER SMC
      if(snip.bestScore>=85){
        const key=`${r.symbol}:${STRATEGY_SMC.name}`;
        if(canAlert(cache,key,STRATEGY_SMC.cooldownH)){
          const txt=formatSniperSMC(r.ctx, snip);
          try{ await sendText(txt); cache[key]=Date.now(); saveCache(cache); alertedSniper++; }catch(e){ console.error(`[TELE SNIPER] ${r.symbol}`,e.message); }
        } else console.log(`[COOLDOWN SMC] ${r.symbol}`);
      }
      // Send SESSION VWAP (format 1-10 wajib)
      if(vwap.bestScore>=85){
        const key=`${r.symbol}:${STRATEGY_VWAP.name}`;
        if(canAlert(cache,key,STRATEGY_VWAP.cooldownH)){
          const txt=`🚨 [${STRATEGY_VWAP.name}] A+ ${r.symbol} ${vwap.bestDir} ${vwap.bestScore}/100\n`+formatSessionVWAP(r.ctx, vwap);
          try{ await sendText(txt); cache[key]=Date.now(); saveCache(cache); alertedVwap++; }catch(e){ console.error(`[TELE VWAP] ${r.symbol}`,e.message); }
        } else console.log(`[COOLDOWN VWAP] ${r.symbol}`);
      }
    }
  }
  topSniper.sort((a,b)=>b.sc-a.sc); topVwap.sort((a,b)=>b.sc-a.sc);
  console.log(`[TOP SNIPER SMC] ${topSniper.slice(0,5).map(t=>`${t.s}:${t.sc} ${t.dir} RR${t.rr}`).join(' | ')}`);
  console.log(`[TOP SESSION VWAP] ${topVwap.slice(0,5).map(t=>`${t.s}:${t.sc} ${t.dir} RR${t.rr}`).join(' | ')}`);
  console.log(`[DONE] Scanned ${scanned} x2 strategi | SNIPER A+ ${alertedSniper} | VWAP A+ ${alertedVwap}`);
  if(alertedSniper===0&&alertedVwap===0) console.log(`[SNIPER] No A+ -> DIAM. Sniper max ${topSniper[0]?.sc||0} VWAP max ${topVwap[0]?.sc||0}`);
}
main().catch(e=>{ console.error('[FATAL]',e.message,e.stack); process.exit(1); });
