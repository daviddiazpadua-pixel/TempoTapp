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
  // Port of madmom's DBNBeatTrackingProcessor (Krebs, Böck & Widmer, ISMIR 2015), the decoder
  // BeatNet was designed to run with. States = (tempo interval L, position p within the beat),
  // L = 14..55 frames at 50 fps (215..55 BPM). Within a beat the position advances by one frame;
  // at the beat boundary the tempo may change with probability ∝ exp(-λ·|L'/L − 1|), λ = 100.
  // Observation: states in the first 1/16 of the beat emit the beat activation, the rest emit
  // (1 − activation)/15. Viterbi finds the best path; each beat is placed on the activation peak
  // inside its "beat range". Validated against madmom on identical network output.
  function buildBeatHmm(fps = 50, minBpm = 55, maxBpm = 215, transitionLambda = 100, observationLambda = 16) {
    const minL = Math.round(60 * fps / maxBpm), maxL = Math.round(60 * fps / minBpm);
    const intervals = []; for (let L = minL; L <= maxL; L++) intervals.push(L);
    const offset = [], first = [], last = []; let N = 0;
    for (const L of intervals) { offset.push(N); first.push(N); last.push(N + L - 1); N += L; }
    const stateL = new Int32Array(N), stateP = new Int32Array(N), isBeat = new Uint8Array(N);
    intervals.forEach((L, i) => { for (let p = 0; p < L; p++) { const s = offset[i] + p; stateL[s] = L; stateP[s] = p; isBeat[s] = (p / L < 1 / observationLambda) ? 1 : 0; } });
    // tempo-change log-probabilities, normalized per source interval
    const K = intervals.length, logTrans = new Float64Array(K * K);
    for (let i = 0; i < K; i++) {
      let sum = 0; const row = new Float64Array(K);
      for (let j = 0; j < K; j++) { row[j] = Math.exp(-transitionLambda * Math.abs(intervals[j] / intervals[i] - 1)); sum += row[j]; }
      for (let j = 0; j < K; j++) logTrans[i * K + j] = Math.log(row[j] / sum);
    }
    return { fps, intervals, offset, first, last, stateL, stateP, isBeat, logTrans, N, K, observationLambda };
  }
  let beatHmmCache = null;
  function viterbiBeats(act, T, hmm) {                    // act: Float64Array(T) beat activation in (0,1)
    const { intervals, first, last, isBeat, logTrans, N, K, observationLambda, stateL, stateP } = hmm;
    const EPS = 1e-9, logNo = new Float64Array(T), logYes = new Float64Array(T);
    for (let t = 0; t < T; t++) { const a = Math.min(1 - EPS, Math.max(EPS, act[t])); logYes[t] = Math.log(a); logNo[t] = Math.log((1 - a) / (observationLambda - 1)); }
    let prev = new Float64Array(N), cur = new Float64Array(N);
    const back = new Uint16Array(T * N);                    // N = 1449 < 65536
    const init = -Math.log(N);
    for (let s = 0; s < N; s++) prev[s] = init + (isBeat[s] ? logYes[0] : logNo[0]);
    for (let t = 1; t < T; t++) {
      const bo = t * N, ly = logYes[t], ln = logNo[t];
      for (let s = 0; s < N; s++) {
        if (stateP[s] !== 0) { cur[s] = prev[s - 1] + (isBeat[s] ? ly : ln); back[bo + s] = s - 1; continue; }
        // first state of interval j: best over all last states i
        const j = s === 0 ? 0 : hmm.offset.indexOf(s);
        let best = -Infinity, bs = 0;
        for (let i = 0; i < K; i++) { const v = prev[last[i]] + logTrans[i * K + j]; if (v > best) { best = v; bs = last[i]; } }
        cur[s] = best + (isBeat[s] ? ly : ln); back[bo + s] = bs;
      }
      const tmp = prev; prev = cur; cur = tmp;
    }
    let s = 0; for (let k = 1; k < N; k++) if (prev[k] > prev[s]) s = k;
    const path = new Int32Array(T);
    for (let t = T - 1; t >= 0; t--) { path[t] = s; s = back[t * N + s]; }
    // beats = activation peak within each contiguous run of beat-range states
    const beats = []; let t = 0;
    while (t < T) {
      if (!isBeat[path[t]]) { t++; continue; }
      let end = t; while (end < T && isBeat[path[end]]) end++;
      let peak = t; for (let k = t + 1; k < end; k++) if (act[k] > act[peak]) peak = k;
      beats.push(peak); t = end;
    }
    return beats;
  }
  function decode(probs, T, opts = {}) {
    const fps = 50;
    const hmm = beatHmmCache || (beatHmmCache = buildBeatHmm(fps));
    const beatAct = new Float64Array(T), down = new Float64Array(T);
    for (let t = 0; t < T; t++) { beatAct[t] = probs[t * 3] + probs[t * 3 + 1]; down[t] = probs[t * 3 + 1]; }
    const beats = viterbiBeats(beatAct, T, hmm);
    // meter + downbeat phase: beats-per-bar ∈ candidates (or fixed by the user), phase maximizing
    // mean downbeat probability on downbeats minus on the other beats
    const candidates = opts.beatsPerBar ? [opts.beatsPerBar] : [2, 3, 4];
    let bestMeter = candidates[0], bestPhase = 0, bestScore = -Infinity;
    for (const m of candidates) for (let ph = 0; ph < m; ph++) {
      let on = 0, off = 0, nOn = 0, nOff = 0;
      beats.forEach((t, i) => { const v = down[t]; if (i % m === ph) { on += v; nOn++; } else { off += v; nOff++; } });
      const s = (nOn ? on / nOn : 0) - (nOff ? off / nOff : 0);
      if (s > bestScore) { bestScore = s; bestMeter = m; bestPhase = ph; }
    }
    if (Number.isFinite(opts.firstDownbeatSec)) {           // user pinned the first downbeat
      let bi = 0, d = Infinity; beats.forEach((t, i) => { const dd = Math.abs(t / fps - opts.firstDownbeatSec); if (dd < d) { d = dd; bi = i; } });
      bestPhase = bi % bestMeter;
    }
    const ibi = beats.slice(1).map((b, i) => (b - beats[i]) / fps).sort((a, b) => a - b);
    const bpm = ibi.length ? 60 / ibi[ibi.length >> 1] : 0;
    const strengths = beats.map(t => beatAct[t]);
    const confidence = strengths.length ? strengths.reduce((a, b) => a + b, 0) / strengths.length : 0;
    return { beats: beats.map((t, i) => ({ time: t / fps, downbeat: i % bestMeter === bestPhase, strength: beatAct[t], downbeatProb: down[t] })), meter: bestMeter, downbeatPhase: bestPhase, bpm, confidence };
  }

  return { computeFeatures, loadWeights, forward, decode, makeBluestein };
})();
if (typeof module !== 'undefined') module.exports = BeatNet;
