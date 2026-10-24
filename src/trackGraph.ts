import { panTaps, type Layout } from "./panLaw.ts";

/**
 * Cadena de cada pista (todas iguales, ninguna se salta el paneo):
 *   fuente → entrada (siempre 2 canales) → separador → matriz de paneo (4 ganancias) → unión → normalización → fader → destino
 * "normalización" y "fader" son ganancias separadas: el fader del usuario no se toca al normalizar.
 */
export type TrackGraph = {
  input: GainNode;
  taps: [GainNode, GainNode, GainNode, GainNode];
  norm: GainNode;
  fader: GainNode;
  /** Solo observa el nivel (post-fader) para el medidor; no altera el audio. */
  meter: AnalyserNode;
  nodes: AudioNode[];
};

export function buildTrackGraph(ctx: BaseAudioContext, source: AudioNode, destination: AudioNode): TrackGraph {
  const input = ctx.createGain();
  // Mono se abre a L=R; estéreo pasa igual; más de 2 canales se mezcla a estéreo.
  input.channelCount = 2;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const taps = [ctx.createGain(), ctx.createGain(), ctx.createGain(), ctx.createGain()] as TrackGraph["taps"];
  const norm = ctx.createGain();
  const fader = ctx.createGain();
  const meter = ctx.createAnalyser();
  meter.fftSize = 512;
  meter.smoothingTimeConstant = 0;

  source.connect(input);
  input.connect(splitter);
  // taps: 0 = L→L, 1 = L→R, 2 = R→L, 3 = R→R
  splitter.connect(taps[0], 0);
  splitter.connect(taps[1], 0);
  splitter.connect(taps[2], 1);
  splitter.connect(taps[3], 1);
  taps[0].connect(merger, 0, 0);
  taps[1].connect(merger, 0, 1);
  taps[2].connect(merger, 0, 0);
  taps[3].connect(merger, 0, 1);
  merger.connect(norm);
  norm.connect(fader);
  fader.connect(destination);
  fader.connect(meter);

  const values = panTaps(0, "stereo");
  taps.forEach((tap, i) => { tap.gain.value = values[i]; });
  return { input, taps, norm, fader, meter, nodes: [input, splitter, merger, ...taps, norm, fader, meter] };
}

/** Aplica el paneo. Con `ramp` (segundos) lo hace suave; sin él, de inmediato (pruebas fuera de línea). */
export function applyPan(graph: TrackGraph, pan: number, layout: Layout, now?: number, ramp = 0.015) {
  const values = panTaps(pan, layout);
  graph.taps.forEach((tap, i) => {
    if (now === undefined) tap.gain.value = values[i];
    else tap.gain.setTargetAtTime(values[i], now, ramp);
  });
}

export function disposeTrackGraph(graph: TrackGraph) {
  for (const node of graph.nodes) node.disconnect();
}
