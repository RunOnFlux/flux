// Per-image docker-pull progress aggregation for the image cache's async download
// job. Sums per-layer downloaded bytes from the raw dockerode progress events. A
// layer is frozen once it reports complete, so a later "Extracting" event — whose
// progressDetail.current counts against the UNCOMPRESSED size — cannot drag the
// byte total back down.

class ImageProgress {
  constructor() {
    this.layers = new Map(); // layerId -> { current, total, done }
  }

  onEvent(event) {
    if (!event || !event.id) return; // overall status lines carry no layer id
    const status = (event.status || '').toLowerCase();
    const layer = this.layers.get(event.id) || { current: 0, total: 0, done: false };
    if (status.includes('already exists') || status.includes('pull complete') || status.includes('download complete')) {
      layer.done = true;
      if (layer.total) layer.current = layer.total;
    } else if (!layer.done && event.progressDetail && typeof event.progressDetail.current === 'number') {
      layer.current = event.progressDetail.current;
      if (typeof event.progressDetail.total === 'number' && event.progressDetail.total > 0) {
        layer.total = event.progressDetail.total;
      }
    }
    this.layers.set(event.id, layer);
  }

  snapshot() {
    const layers = [...this.layers.values()];
    const pulledBytes = layers.reduce((sum, l) => sum + l.current, 0);
    const totalBytes = layers.reduce((sum, l) => sum + l.total, 0);
    const pct = totalBytes > 0 ? Math.min(100, Math.round((pulledBytes / totalBytes) * 100)) : 0;
    return { pulledBytes, totalBytes, pct };
  }
}

module.exports = { ImageProgress };
