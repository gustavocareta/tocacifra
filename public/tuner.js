// Afinador: deteccao de altura por autocorrelacao normalizada (McLeod simplificado). Sem dependencias.
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const TUNINGS = {
  cromatico: { label: 'Cromático (qualquer nota)', strings: null },
  violao: { label: 'Violão', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  cavaco: { label: 'Cavaquinho', strings: ['D3', 'G3', 'B3', 'D4'] },
  ukulele: { label: 'Ukulele', strings: ['G4', 'C4', 'E4', 'A4'] },
  baixo: { label: 'Baixo (4 cordas)', strings: ['E1', 'A1', 'D2', 'G2'] },
};

export const noteToFreq = (note) => {
  const m = /^([A-G]#?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`Nota invalida: ${note}`);
  return 440 * 2 ** ((NAMES.indexOf(m[1]) + 12 * (Number(m[2]) + 1) - 69) / 12);
};

/** Nota mais proxima, oitava e desvio em centavos. */
export function freqToNote(freq, a4 = 440) {
  const midi = 69 + 12 * Math.log2(freq / a4);
  const nearest = Math.round(midi);
  return { name: NAMES[((nearest % 12) + 12) % 12], octave: Math.floor(nearest / 12) - 1, cents: Math.round((midi - nearest) * 100), midi: nearest };
}

/** Corda-alvo mais proxima (em centavos) dentro de uma afinacao. */
export function nearestString(freq, strings) {
  let best = null;
  for (const s of strings) {
    const cents = 1200 * Math.log2(freq / noteToFreq(s));
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { note: s, cents: Math.round(cents) };
  }
  return best;
}

/**
 * Frequencia fundamental do buffer (Float32 mono) ou null se nao houver tom claro.
 * Usa a funcao de diferenca normalizada (NSDF) e escolhe o primeiro pico alto.
 */
export function detectPitch(buf, sampleRate, { minFreq = 30, maxFreq = 1400, clarity = 0.9 } = {}) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / n) < 0.01) return null; // silencio
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), n >> 1);
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let acf = 0, m = 0;
    for (let i = 0; i < n - lag; i++) { acf += buf[i] * buf[i + lag]; m += buf[i] * buf[i] + buf[i + lag] * buf[i + lag]; }
    nsdf[lag] = m ? (2 * acf) / m : 0;
  }
  // picos positivos entre cruzamentos por zero; pega o primeiro que chega perto do maximo
  const peaks = [];
  let lag = minLag;
  while (lag < maxLag && nsdf[lag] > 0) lag++; // sai da regiao inicial positiva
  while (lag < maxLag) {
    while (lag < maxLag && nsdf[lag] <= 0) lag++;
    let peak = -1;
    while (lag < maxLag && nsdf[lag] > 0) { if (peak < 0 || nsdf[lag] > nsdf[peak]) peak = lag; lag++; }
    if (peak >= minLag) peaks.push(peak);
  }
  if (!peaks.length) return null;
  const top = Math.max(...peaks.map((p) => nsdf[p]));
  if (top < clarity * 0.8) return null;
  const chosen = peaks.find((p) => nsdf[p] >= 0.9 * top);
  // interpolacao parabolica para precisao sub-amostra
  const a = nsdf[chosen - 1] ?? nsdf[chosen], b = nsdf[chosen], c = nsdf[chosen + 1] ?? nsdf[chosen];
  const denom = a - 2 * b + c;
  const shift = denom ? (0.5 * (a - c)) / denom : 0;
  return sampleRate / (chosen + shift);
}
