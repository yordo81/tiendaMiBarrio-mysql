// Sonido corto de confirmación al escanear un producto (Web Audio, sin archivos)
let beepCtx: AudioContext | null = null;

export function playScanBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!beepCtx) beepCtx = new Ctx();
    if (beepCtx.state === 'suspended') beepCtx.resume();
    const ctx = beepCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1318.5, now); // E6
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch { /* audio no disponible */ }
}
