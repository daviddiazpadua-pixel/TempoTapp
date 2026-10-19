/* TempoTap — AI beat tracker worker. Loads BeatNet (see beatnet.js) and its weights from this
 * folder, analyzes 22.05 kHz mono samples sent from the page, and replies with the beat map.
 * Runs entirely on the device; nothing is transmitted. */
'use strict';
importScripts('beatnet.js');
let ready = null;
function load() {
  if (!ready) ready = Promise.all([
    fetch('beatnet_frontend.json').then(r => { if (!r.ok) throw new Error('front-end parameters missing'); return r.json(); }),
    fetch('beatnet_weights.json').then(r => { if (!r.ok) throw new Error('weight manifest missing'); return r.json(); }),
    // Weights: raw float32 file first; some hosts cannot serve binary files, so fall back to the base64 JSON copy.
    fetch('beatnet_weights.f32').then(r => { if (!r.ok) throw new Error('raw'); return r.arrayBuffer(); })
      .catch(() => fetch('beatnet_weights.b64.json').then(r => { if (!r.ok) throw new Error('weights missing'); return r.json(); })
        .then(j => { const bin = atob(j.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }))
  ]).then(([fe, meta, buf]) => ({ fe, W: BeatNet.loadWeights(buf, meta) })).catch(err => { ready = null; throw err; });
  return ready;
}
self.onmessage = async e => {
  const { requestId, samples, options } = e.data || {};
  try {
    const { fe, W } = await load();
    const x = new Float32Array(samples);
    if (x.length < 22050) throw new Error('recording is too short (under one second)');
    const { feats, T } = BeatNet.computeFeatures(x, fe);
    postMessage({ requestId, progress: 0.45 });
    const probs = BeatNet.forward(feats, T, W);
    postMessage({ requestId, progress: 0.92 });
    const result = BeatNet.decode(probs, T, options || {});
    postMessage({ requestId, ok: true, result });
  } catch (err) {
    postMessage({ requestId, ok: false, error: String((err && err.message) || err) });
  }
};
