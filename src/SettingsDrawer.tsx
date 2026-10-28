import { useEffect, useState } from "react";
import { setFx, useFx } from "./effects";
import { setRespectSystemMotion, useMotion } from "./motion";
import { fpsSnapshot } from "./fpsMonitor";
import { NORM_MODES, NORM_MODE_LABEL, type NormMode } from "./normConfig.ts";
import { pistas } from "./format";

export type DiagnosticsInfo = {
  audio: { state: string; sampleRate: number; baseLatency: number; outputLatency: number } | null;
  songs: number;
  tracks: number;
  memoryUsedBytes: number;
  memoryBudgetBytes: number;
  playing: boolean;
};

type Props = {
  normMode: NormMode;
  onNormMode: (mode: NormMode) => void;
  onOpenProfiles: () => void;
  getDiagnostics: () => DiagnosticsInfo;
  onClose: () => void;
};

const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

type Perf = { phase: string; stage: string; ms: number };

/** Ajustes: normalización, efectos visuales, movimiento del sistema y Diagnóstico. */
export default function SettingsDrawer({ normMode, onNormMode, onOpenProfiles, getDiagnostics, onClose }: Props) {
  const [fx] = useFx();
  const { systemReduce, respect } = useMotion();
  const [view, setView] = useState<"settings" | "diag">("settings");
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer settings-drawer" onClick={(event) => event.stopPropagation()} aria-label={view === "settings" ? "Ajustes" : "Diagnóstico"}>
        <div className="drawer-head">
          <h2>{view === "settings" ? "Ajustes" : "Diagnóstico"}</h2>
          <button className="pill-btn" onClick={view === "settings" ? onClose : () => setView("settings")}>{view === "settings" ? "CERRAR" : "VOLVER"}</button>
        </div>

        {view === "settings" ? (
          <>
            <section className="setting-block">
              <div><strong>Normalización</strong><small>Equilibra el volumen entre pistas y canciones.</small></div>
              <div className="segmented-setting" role="radiogroup" aria-label="Normalización">
                {NORM_MODES.map((mode) => (
                  <button key={mode} role="radio" aria-checked={normMode === mode} className={normMode === mode ? "active" : ""} onClick={() => onNormMode(mode)}>{NORM_MODE_LABEL[mode]}</button>
                ))}
              </div>
            </section>

            <section className="setting-block">
              <div><strong>Efectos visuales</strong><small>«Reducidos» apaga los brillos y partículas más pesados y mantiene un aspecto limpio.</small></div>
              <div className="segmented-setting" role="radiogroup" aria-label="Efectos visuales">
                {(["full", "reduced"] as const).map((mode) => (
                  <button key={mode} role="radio" aria-checked={fx === mode} className={fx === mode ? "active" : ""} onClick={() => setFx(mode)}>{mode === "full" ? "Completos" : "Reducidos"}</button>
                ))}
              </div>
            </section>

            {systemReduce && (
              <section className="setting-block">
                <div><strong>El sistema pidió menos animaciones</strong><small>{respect ? "Se están respetando: no hay animaciones de movimiento." : "Las animaciones siguen activas, como elegiste."}</small></div>
                <button className={`switch ${respect ? "on" : ""}`} role="switch" aria-checked={respect} onClick={() => setRespectSystemMotion(!respect)}>
                  <i /><span>{respect ? "Respetar al sistema" : "Ignorar al sistema"}</span>
                </button>
              </section>
            )}

            <button className="settings-link" onClick={onOpenProfiles}>Administrar perfiles de pistas</button>
            <button className="settings-link" onClick={() => setView("diag")}>Diagnóstico</button>
          </>
        ) : (
          <Diagnostics getDiagnostics={getDiagnostics} />
        )}
      </aside>
    </div>
  );
}

function Diagnostics({ getDiagnostics }: { getDiagnostics: () => DiagnosticsInfo }) {
  const [info, setInfo] = useState(getDiagnostics);
  const [fps, setFps] = useState(fpsSnapshot);
  const [copied, setCopied] = useState(false);
  const [fx] = useFx();
  const { systemReduce, respect } = useMotion();

  useEffect(() => {
    const timer = window.setInterval(() => { setInfo(getDiagnostics()); setFps(fpsSnapshot()); }, 1000);
    return () => window.clearInterval(timer);
  }, [getDiagnostics]);

  const nav = navigator as Navigator & { deviceMemory?: number };
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  const timings = ((window.__perf ?? []) as Perf[]).filter((row) => row.stage === "TOTAL" || row.phase === "carga").slice(-6);
  const rows: [string, string][] = [
    ["Efectos visuales", fx === "full" ? "Completos" : "Reducidos"],
    ["Movimiento del sistema", systemReduce ? (respect ? "Menos animaciones (respetado)" : "Menos animaciones (ignorado)") : "Normal"],
    ["Fotogramas por segundo", fps ? `${fps.fps} fps (mínimo ${fps.min5s} en 5 s)` : "Se mide mientras suena una canción"],
    ["Audio", info.audio ? `${info.audio.state} · ${Math.round(info.audio.sampleRate / 100) / 10} kHz` : "Aún sin iniciar"],
    ["Latencia de audio", info.audio ? `${Math.round((info.audio.baseLatency + info.audio.outputLatency) * 1000)} ms` : "—"],
    ["Repertorio", `${info.songs} ${info.songs === 1 ? "canción" : "canciones"} · ${pistas(info.tracks)} activas`],
    ["Memoria de canciones", `${mb(info.memoryUsedBytes)} de ${mb(info.memoryBudgetBytes)}`],
    ["Memoria del dispositivo", nav.deviceMemory ? `${nav.deviceMemory} GB (aprox.)` : "No disponible"],
    ["Memoria de la app", heap ? mb(heap) : "No disponible"],
    ["Procesador", `${navigator.hardwareConcurrency ?? "?"} núcleos`],
    ["Pantalla", `${window.innerWidth}×${window.innerHeight} · ×${window.devicePixelRatio}`],
  ];
  const text = [...rows.map(([name, value]) => `${name}: ${value}`), ...timings.map((row) => `${row.phase} · ${row.stage}: ${Math.round(row.ms)} ms`)].join("\n");

  return (
    <>
      <dl className="diag-list">
        {rows.map(([name, value]) => (<div key={name}><dt>{name}</dt><dd>{value}</dd></div>))}
      </dl>
      {timings.length > 0 && (
        <>
          <h3 className="diag-title">ÚLTIMOS TIEMPOS</h3>
          <dl className="diag-list">
            {timings.map((row, index) => (<div key={index}><dt>{row.phase} · {row.stage}</dt><dd>{Math.round(row.ms)} ms</dd></div>))}
          </dl>
        </>
      )}
      <button className="settings-link" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => undefined)}>
        {copied ? "Copiado" : "Copiar diagnóstico"}
      </button>
    </>
  );
}
