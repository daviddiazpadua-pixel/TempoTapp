/* BeatNet in plain JavaScript — prototype for TempoTap's "AI analyzer".
 * Pipeline (matches the Python reference exactly, see test harness):
 *   mono 22050 Hz samples
 *   → frames of 1411 samples, hop 441 (50 fps), centered, zero-padded, Hann window
 *   → 1411-point FFT (Bluestein, since 1411 is not a power of two) → magnitude (705 bins)
 *   → 136-band logarithmic filterbank (24 bands/octave, 30–17000 Hz, normalized)
 *   → log10(1 + x), plus positive first-order difference  → 272 features per frame
 *   → Conv1d(1→2,k10) + ReLU + MaxPool(2) → Linear(262→150) → 2-layer LSTM(150) → Linear(150→3) → softmax
 *   → per-frame probabilities [beat, downbeat, none]
 *   → decoder: tempo-aware dynamic programming over the beat probability, then meter/downbeat phase.
 * Model: BeatNet (Heydari, Fazekas & Duan, ISMIR 2021); weights from the BeatNet PyPI package, licensed CC BY 4.0 (attribution required).
 */
'use strict';

const BeatNet = (() => {
  // ---------- FFT (radix-2) and Bluestein for arbitrary N ----------
  function fftRadix2(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  function makeBluestein(N) {
    let M = 1; while (M < 2 * N - 1) M <<= 1;
    const wr = new Float64Array(N), wi = new Float64Array(N);
    for (let k = 0; k < N; k++) { const a = Math.PI * ((k * k) % (2 * N)) / N; wr[k] = Math.cos(a); wi[k] = -Math.sin(a); } // chirp w_k = e^{-iπk²/N}
    const br = new Float64Array(M), bi = new Float64Array(M);
    br[0] = wr[0]; bi[0] = -wi[0];
    for (let k = 1; k < N; k++) { br[k] = br[M - k] = wr[k]; bi[k] = bi[M - k] = -wi[k]; } // conj chirp, periodic
    fftRadix2(br, bi);
    const ar = new Float64Array(M), ai = new Float64Array(M);
    return function (x, outMag, numBins) {           // x: Float32Array(N) real → magnitudes of bins 0..numBins-1
      ar.fill(0); ai.fill(0);
      for (let k = 0; k < N; k++) { ar[k] = x[k] * wr[k]; ai[k] = x[k] * wi[k]; }
      fftRadix2(ar, ai);
      for (let k = 0; k < M; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
      // inverse FFT via conjugation
      for (let k = 0; k < M; k++) ai[k] = -ai[k];
      fftRadix2(ar, ai);
      for (let k = 0; k < numBins; k++) {
        const r = (ar[k] * wr[k] + ai[k] * wi[k]) / M, i = (-ai[k] * wr[k] + ar[k] * wi[k]) / M; // X_k = w_k · y_k  (with ai negated)
        outMag[k] = Math.hypot(r, i);
      }
    };
  }

  // ---------- Front end ----------
  function computeFeatures(samples, fe) {              // samples: Float32Array @ 22050 Hz
    const N = fe.frameSize, hop = fe.hop, nb = fe.numBins, bands = fe.bands, B = bands.length;
    const T = Math.floor(samples.length / hop);       // madmom: num_frames = floor(len / hop) with origin 0
    const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); // np.hanning
    const fft = makeBluestein(N), frame = new Float32Array(N), mag = new Float64Array(nb);
    const feats = new Float32Array(T * 2 * B), prev = new Float64Array(B), cur = new Float64Array(B);
    for (let t = 0; t < T; t++) {
      const start = t * hop - (N >> 1);               // centered frame, zero-padded at the edges
      for (let i = 0; i < N; i++) { const s = start + i; frame[i] = (s >= 0 && s < samples.length) ? samples[s] * win[i] : 0; }
      fft(frame, mag, nb);
      for (let b = 0; b < B; b++) {
        const band = bands[b], w = band.w; let acc = 0;
        for (let j = 0; j < w.length; j++) acc += mag[band.start + j] * w[j];
        cur[b] = Math.log10(1 + acc);
      }
      const row = t * 2 * B;
      for (let b = 0; b < B; b++) { feats[row + b] = cur[b]; feats[row + B + b] = t === 0 ? 0 : Math.max(0, cur[b] - prev[b]); prev[b] = cur[b]; }
    }
    return { feats, T, dim: 2 * B };
  }

  // ---------- Network ----------
  function loadWeights(buffer, meta) {
    const all = new Float32Array(buffer), W = {};
    for (const k in meta) { const m = meta[k], n = m.shape.reduce((a, b) => a * b, 1); W[k] = { data: all.subarray(m.offset, m.offset + n), shape: m.shape }; }
    return W;
  }
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  function lstmLayer(x, T, H, Wih, Whh, bih, bhh) {   // x: Float32Array(T*H) in, returns Float32Array(T*H); gate order i,f,g,o (PyTorch)
    const out = new Float32Array(T * H), h = new Float32Array(H), c = new Float32Array(H), g = new Float32Array(4 * H);
    for (let t = 0; t < T; t++) {
      const xo = t * H;
      for (let r = 0; r < 4 * H; r++) {
        let acc = bih[r] + bhh[r]; const wi = r * H, wh = r * H;
        for (let k = 0; k < H; k++) acc += Wih[wi + k] * x[xo + k] + Whh[wh + k] * h[k];
        g[r] = acc;
      }
      for (let j = 0; j < H; j++) {
        const i = sigmoid(g[j]), f = sigmoid(g[H + j]), gg = Math.tanh(g[2 * H + j]), o = sigmoid(g[3 * H + j]);
        c[j] = f * c[j] + i * gg; h[j] = o * Math.tanh(c[j]); out[xo + j] = h[j];
      }
    }
    return out;
  }
  function forward(feats, T, W) {
    const D = 272, K = 10, C1 = D - K + 1, P = C1 >> 1, H = 150;
    const cw = W['conv1.weight'].data, cb = W['conv1.bias'].data, l0w = W['linear0.weight'].data, l0b = W['linear0.bias'].data;
    const x1 = new Float32Array(T * H), pooled = new Float32Array(2 * P);
    for (let t = 0; t < T; t++) {
      const fo = t * D;
      for (let ch = 0; ch < 2; ch++) {
        for (let p = 0; p < P; p++) {
          let best = -Infinity;
          for (let q = 0; q < 2; q++) {
            const pos = 2 * p + q; let acc = cb[ch];
            for (let k = 0; k < K; k++) acc += cw[ch * K + k] * feats[fo + pos + k];
            acc = acc > 0 ? acc : 0; if (acc > best) best = acc;
          }
          pooled[ch * P + p] = best;
        }
      }
      for (let r = 0; r < H; r++) { let acc = l0b[r]; const wo = r * 2 * P; for (let k = 0; k < 2 * P; k++) acc += l0w[wo + k] * pooled[k]; x1[t * H + r] = acc; }
    }
    const h1 = lstmLayer(x1, T, H, W['lstm.weight_ih_l0'].data, W['lstm.weight_hh_l0'].data, W['lstm.bias_ih_l0'].data, W['lstm.bias_hh_l0'].data);
    const h2 = lstmLayer(h1, T, H, W['lstm.weight_ih_l1'].data, W['lstm.weight_hh_l1'].data, W['lstm.bias_ih_l1'].data, W['lstm.bias_hh_l1'].data);
    const lw = W['linear.weight'].data, lb = W['linear.bias'].data, probs = new Float32Array(T * 3);
    for (let t = 0; t < T; t++) {
      const z = [0, 0, 0]; for (let r = 0; r < 3; r++) { let acc = lb[r]; for (let k = 0; k < H; k++) acc += lw[r * H + k] * h2[t * H + k]; z[r] = acc; }
      const m = Math.max(z[0], z[1], z[2]), e = z.map(v => Math.exp(v - m)), s = e[0] + e[1] + e[2];
      probs[t * 3] = e[0] / s; probs[t * 3 + 1] = e[1] / s; probs[t * 3 + 2] = e[2] / s;
    }
    return probs; // [beat, downbeat, none] per frame
  }

  // ---------- Decoder: dynamic Bayesian network beat tracker ----------
  // Port of madmom's DBNBeatTrackingProcessor (Krebs, Böck & Widmer, ISMIR 2015), extended for TempoTapp:
  //  * states = (beat interval L frames, position p in the beat); at a beat boundary the tempo may change
  //    with probability ∝ exp(−λ·|L'/L − 1|). λ comes from the "timing style": steady 100, expressive 60,
  //    very free 30 (and 30 whenever the user tapped a few beats, because the taps then hold the tempo).
  //  * memory: only interval *starts* need back-pointers (inside a beat the move is forced), so the
  //    trellis is T×K instead of T×N — long recordings fit easily.
  //  * user taps ("tap training"): the tapped beats are pinned (the path must pass through them, one
  //    beat per tap interval), the tempo range is set around the tapped pulse, and a tempo prior keeps the
  //    whole piece at the user's pulse level — so a few taps steer the entire recording.
  //  * bar positions: a second small Viterbi over the beats (position-in-bar advances by one; rare
  //    skipped/extra beats allowed) driven by the downbeat activation, so accents re-synchronise after a
  //    big ritardando instead of drifting for the rest of the piece. A pinned first downbeat is honoured.
  function buildBeatHmm(fps, minBpm, maxBpm, lambda, obsLambda = 16) {
    const minL = Math.max(4, Math.round(60 * fps / maxBpm)), maxL = Math.max(minL + 1, Math.round(60 * fps / minBpm));
    const intervals = []; for (let L = minL; L <= maxL; L++) intervals.push(L);
    const K = intervals.length, offset = new Int32Array(K), last = new Int32Array(K); let N = 0;
    intervals.forEach((L, i) => { offset[i] = N; last[i] = N + L - 1; N += L; });
    const isBeat = new Uint8Array(N); intervals.forEach((L, i) => { for (let p = 0; p < L; p++) isBeat[offset[i] + p] = (p / L < 1 / obsLambda) ? 1 : 0; });
    const logTrans = new Float64Array(K * K);
    for (let i = 0; i < K; i++) { let sum = 0; const row = new Float64Array(K); for (let j = 0; j < K; j++) { row[j] = Math.exp(-lambda * Math.abs(intervals[j] / intervals[i] - 1)); sum += row[j]; } for (let j = 0; j < K; j++) logTrans[i * K + j] = Math.log(row[j] / sum); }
    return { fps, intervals, offset, last, isBeat, logTrans, N, K, obsLambda };
  }
  function viterbiBeats(act, T, hmm, prior) {
    const { intervals, offset, last, isBeat, logTrans, N, K, obsLambda } = hmm, EPS = 1e-9;
    let prev = new Float64Array(N), cur = new Float64Array(N); const back = new Int32Array(T * K);
    const lg = t => { const a = Math.min(1 - EPS, Math.max(EPS, act[t])); return [Math.log(a), Math.log((1 - a) / (obsLambda - 1))]; };
    { const [ly, ln] = lg(0), init = -Math.log(N); for (let s = 0; s < N; s++) prev[s] = init + (isBeat[s] ? ly : ln); }
    for (let t = 1; t < T; t++) {
      const [ly, ln] = lg(t);
      for (let j = 0; j < K; j++) {
        let best = -Infinity, bi = 0; for (let i = 0; i < K; i++) { const v = prev[last[i]] + logTrans[i * K + j]; if (v > best) { best = v; bi = i; } }
        const s0 = offset[j], L = intervals[j]; cur[s0] = best + (prior ? prior[j] : 0) + (isBeat[s0] ? ly : ln); back[t * K + j] = bi;
        for (let p = 1; p < L; p++) { const s = s0 + p; cur[s] = prev[s - 1] + (isBeat[s] ? ly : ln); }
      }
      const tmp = prev; prev = cur; cur = tmp;
    }
    let s = 0; for (let k = 1; k < N; k++) if (prev[k] > prev[s]) s = k;
    let j = 0; for (let i = 0; i < K; i++) if (offset[i] <= s) j = i; let p = s - offset[j];
    const inBeat = new Uint8Array(T);
    for (let t = T - 1; t >= 0; t--) { inBeat[t] = isBeat[offset[j] + p]; if (t === 0) break; if (p > 0) p--; else { j = back[t * K + j]; p = intervals[j] - 1; } }
    const beats = []; let t = 0;
    while (t < T) { if (!inBeat[t]) { t++; continue; } let e = t; while (e < T && inBeat[e]) e++; let pk = t; for (let k = t + 1; k < e; k++) if (act[k] > act[pk]) pk = k; beats.push(pk); t = e; }
    return beats;
  }
  function barPositions(dprob, m, forced) {
    const n = dprob.length; if (!n) return [];
    const ADV = Math.log(0.97), JUMP = Math.log(0.015);
    let score = new Float64Array(m); const back = new Int8Array(n * m);
    const obs = (i, p) => { const d = Math.min(0.995, Math.max(0.005, dprob[i])); let v = p === 0 ? Math.log(d) : Math.log(1 - d); if (forced && forced[i] !== undefined) v += (p === forced[i] ? 0 : -60); return v; };
    for (let p = 0; p < m; p++) score[p] = obs(0, p);
    for (let i = 1; i < n; i++) {
      const next = new Float64Array(m);
      for (let p = 0; p < m; p++) { let best = -Infinity, bq = 0; for (let q = 0; q < m; q++) { let tr; if ((q + 1) % m === p) tr = ADV; else if (m > 2 && (q + 2) % m === p) tr = JUMP; else if (q === p) tr = JUMP; else continue; const v = score[q] + tr; if (v > best) { best = v; bq = q; } } next[p] = best + obs(i, p); back[i * m + p] = bq; }
      score = next;
    }
    let p = 0; for (let q = 1; q < m; q++) if (score[q] > score[p]) p = q;
    const out = new Array(n); for (let i = n - 1; i >= 0; i--) { out[i] = p; p = back[i * m + p]; } return out;
  }
  function decode(probs, T, opts = {}) {
    const fps = 50, beatAct = new Float64Array(T), down = new Float64Array(T);
    for (let t = 0; t < T; t++) { beatAct[t] = probs[t * 3] + probs[t * 3 + 1]; down[t] = probs[t * 3 + 1]; }
    const taps = (opts.taps || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    let minBpm = 35, maxBpm = 215, prior = null, tapBpm = 0;
    if (taps.length >= 3) {
      const ibi = taps.slice(1).map((v, i) => v - taps[i]).filter(v => v > 0.15 && v < 3).sort((a, b) => a - b);
      if (ibi.length >= 2) { tapBpm = 60 / ibi[ibi.length >> 1]; minBpm = Math.max(18, tapBpm / 2.6); maxBpm = Math.min(320, tapBpm * 1.3); }
    }
    const act = beatAct.slice();
    if (taps.length) {
      const win = Math.round(0.06 * fps), pins = [];
      for (const tp of taps) { const c = Math.round(tp * fps); let pk = Math.min(T - 1, Math.max(0, c)), best = -1; for (let k = Math.max(0, c - win); k <= Math.min(T - 1, c + win); k++) if (act[k] > best) { best = act[k]; pk = k; } if (best < 0.15) pk = Math.min(T - 1, Math.max(0, c)); pins.push(pk); }
      const gaps = pins.slice(1).map((v, i) => v - pins[i]).sort((a, b) => a - b), med = gaps.length ? gaps[gaps.length >> 1] : 0;
      for (let k = 0; k < pins.length; k++) { const pk = pins[k]; for (let d = -1; d <= 1; d++) if (pk + d >= 0 && pk + d < T) act[pk + d] = d === 0 ? 0.995 : Math.max(act[pk + d], 0.3);
        if (k + 1 < pins.length && med && pins[k + 1] - pk < med * 1.6) for (let q = pk + 3; q <= pins[k + 1] - 3; q++) act[q] *= 0.03; }
    }
    const style = opts.timingStyle || 'expressive';
    const lambda = tapBpm ? 30 : style === 'steady' ? 100 : style === 'rubato' ? 30 : 60;
    const hmm = buildBeatHmm(fps, minBpm, maxBpm, lambda);
    if (tapBpm) { const Lu = 60 * fps / tapBpm; prior = new Float64Array(hmm.K); hmm.intervals.forEach((L, j) => { prior[j] = -4 * Math.abs(Math.log(L / Lu)); }); }
    const beats = viterbiBeats(act, T, hmm, prior);
    const dprob = beats.map(t => { let v = 0, bv = 0; for (let k = Math.max(0, t - 2); k <= Math.min(T - 1, t + 2); k++) { v = Math.max(v, down[k]); bv = Math.max(bv, beatAct[k]); } return bv > 0 ? Math.min(1, v / bv) : 0; });
    const forced = {}; if (Number.isFinite(opts.firstDownbeatSec)) { let bi = 0, dd = Infinity; beats.forEach((t, i) => { const d = Math.abs(t / fps - opts.firstDownbeatSec); if (d < dd) { dd = d; bi = i; } }); forced[bi] = 0; }
    const candidates = opts.beatsPerBar ? [opts.beatsPerBar] : [2, 3, 4];
    let bestMeter = candidates[0], pos = null, bestScore = -Infinity;
    for (const m of candidates) { const ps = barPositions(dprob, m, forced); let on = 0, off = 0, nOn = 0, nOff = 0; ps.forEach((p, i) => { if (p === 0) { on += dprob[i]; nOn++; } else { off += dprob[i]; nOff++; } }); const sc = (nOn ? on / nOn : 0) - (nOff ? off / nOff : 0); if (sc > bestScore) { bestScore = sc; bestMeter = m; pos = ps; } }
    const ibi = beats.slice(1).map((b, i) => (b - beats[i]) / fps).sort((a, b) => a - b);
    const bpm = ibi.length ? 60 / ibi[ibi.length >> 1] : 0;
    const strengths = beats.map(t => beatAct[t]);
    const confidence = strengths.length ? strengths.reduce((a, b) => a + b, 0) / strengths.length : 0;
    const firstDown = pos.indexOf(0);
    return { beats: beats.map((t, i) => ({ time: t / fps, downbeat: pos[i] === 0, position: pos[i] + 1, strength: beatAct[t], downbeatProb: dprob[i] })), meter: bestMeter, downbeatPhase: firstDown < 0 ? 0 : firstDown % bestMeter, bpm, confidence, tapBpm };
  }

  return { computeFeatures, loadWeights, forward, decode, barPositions, makeBluestein };
})();
if (typeof module !== 'undefined') module.exports = BeatNet;
