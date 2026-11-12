import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { setFx, useFx, type FxMode } from "./effects";
import { setRespectSystemMotion, useMotion } from "./motion";
import { fpsSnapshot } from "./fpsMonitor";
import { NORM_MODES, NORM_MODE_LABEL, type NormMode } from "./normConfig.ts";
import { pistas } from "./format";
import { useAccount } from "./AuthGate";
import { CONTACTO_SOPORTE, SOPORTE_ASUNTO, mailtoLink, whatsappLink } from "./cloud/config";
import { CopyEmailButton } from "./CloudParts";
import { LegalText } from "./LegalView";
import { LEGAL_TITLE, type LegalKind } from "./legal";
import { openExternal } from "./externalLink";
import { getPreload, setPreload, subscribePreload } from "./preload";
import { clearTemporaryData, formatDate, getDefaultMaster, loadMembership, setDefaultMaster, statusLabel, type Membership } from "./account";
import "./styles/settings.css";

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
  getDiagnostics: () => DiagnosticsInfo;
};

const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;
const FX_LABEL: Record<FxMode, string> = { full: "Completas", reduced: "Reducidas", off: "Desactivadas" };

type Perf = { phase: string; stage: string; ms: number };

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Row({ title, hint, children, stacked }: { title: string; hint?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <div className={`setting-row ${stacked ? "stacked" : ""}`}>
      <div className="setting-copy"><strong>{title}</strong>{hint && <small>{hint}</small>}</div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

function Fact({ name, value }: { name: string; value: string }) {
  return <div className="setting-fact"><span>{name}</span><strong>{value}</strong></div>;
}

/** Ajustes: pantalla completa con las secciones del diseño. Solo muestra ajustes que existen en la app. */
export default function SettingsScreen({ normMode, onNormMode, getDiagnostics }: Props) {
  const [fx] = useFx();
  const { systemReduce, respect } = useMotion();
  const [view, setView] = useState<"settings" | "diag" | LegalKind>("settings");
  const account = useAccount();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [master, setMaster] = useState(getDefaultMaster);
  const preload = useSyncExternalStore(subscribePreload, getPreload);
  const [cleaned, setCleaned] = useState(false);

  // Membresía: solo si hay sesión. Si la consulta falla, la tarjeta de membresía no se muestra.
  useEffect(() => {
    if (!account) return;
    let alive = true;
    void loadMembership().then((result) => { if (alive) setMembership(result); });
    return () => { alive = false; };
  }, [account]);

  const title = view === "settings" ? "Ajustes" : view === "diag" ? "Diagnóstico" : LEGAL_TITLE[view];
  const expires = formatDate(membership?.expiresAt ?? null);

  return (
    <section className="screen settings-screen" aria-label={title}>
      <div className="lib-head">
        <div><span className="eyebrow">CRESCENDO LIVE</span><h1>{title}</h1></div>
        {view !== "settings" && <button className="pill-btn" onClick={() => setView("settings")}>VOLVER</button>}
      </div>

      <div className="settings-scroll">
        {view === "diag" ? <Diagnostics getDiagnostics={getDiagnostics} /> : view !== "settings" ? <div className="settings-legal"><LegalText kind={view} /></div> : (
          <>
            {account && (
              <Card title="Cuenta y membresía">
                <Fact name="Correo" value={account.email || "—"} />
                {membership && (
                  <>
                    <Fact name="Estado" value={statusLabel(membership.status)} />
                    {membership.plan && <Fact name="Plan" value={membership.plan} />}
                    {expires && <Fact name="Vence" value={expires} />}
                  </>
                )}
                <button className="settings-action danger" onClick={account.signOut}>Cerrar sesión</button>
              </Card>
            )}

            <Card title="Audio">
              <Row title="Volumen maestro predeterminado" hint="Con este volumen arrancan las canciones que abras.">
                <div className="setting-slider">
                  <input
                    type="range" min={0} max={100} step={1} value={master} aria-label="Volumen maestro predeterminado"
                    style={{ "--v": `${master}%` } as React.CSSProperties}
                    onChange={(event) => { const value = Number(event.target.value); setMaster(value); setDefaultMaster(value); }}
                  />
                  <output>{master}%</output>
                </div>
              </Row>
              <Row title="Precargar siguiente canción" hint="Mientras suena la actual, descarga la siguiente del setlist en segundo plano. Si lo apagas, se descarga al elegirla.">
                <button className={`switch ${preload ? "on" : ""}`} role="switch" aria-checked={preload} onClick={() => setPreload(!preload)}>
                  <i /><span>{preload ? "Activado" : "Apagado"}</span>
                </button>
              </Row>
              <Row title="Normalización" hint="Equilibra el volumen entre pistas y canciones." stacked>
                <div className="segmented-setting" role="radiogroup" aria-label="Normalización">
                  {NORM_MODES.map((mode) => (
                    <button key={mode} role="radio" aria-checked={normMode === mode} className={normMode === mode ? "active" : ""} onClick={() => onNormMode(mode)}>{NORM_MODE_LABEL[mode]}</button>
                  ))}
                </div>
              </Row>
            </Card>

            <Card title="Apariencia">
              <Row title="Animaciones" hint="«Reducidas» deja solo cambios breves de color. «Desactivadas» quita todo movimiento y los brillos." stacked>
                <div className="segmented-setting" role="radiogroup" aria-label="Animaciones">
                  {(["full", "reduced", "off"] as const).map((mode) => (
                    <button key={mode} role="radio" aria-checked={fx === mode} className={fx === mode ? "active" : ""} onClick={() => setFx(mode)}>{FX_LABEL[mode]}</button>
                  ))}
                </div>
              </Row>
              {systemReduce && (
                <Row title="El sistema pidió menos animaciones" hint={respect ? "Se están respetando: no hay animaciones de movimiento." : "Las animaciones siguen activas, como elegiste."}>
                  <button className={`switch ${respect ? "on" : ""}`} role="switch" aria-checked={respect} onClick={() => setRespectSystemMotion(!respect)}>
                    <i /><span>{respect ? "Respetar" : "Ignorar"}</span>
                  </button>
                </Row>
              )}
            </Card>

            <Card title="Biblioteca">
              <Row title="Archivos temporales" hint="Borra la copia guardada del catálogo. Las canciones nunca se guardan en el dispositivo: viven solo mientras la app está abierta.">
                <button
                  className="settings-action"
                  onClick={() => void clearTemporaryData().then(() => { setCleaned(true); window.setTimeout(() => setCleaned(false), 2500); })}
                >{cleaned ? "Listo" : "Limpiar"}</button>
              </Row>
            </Card>

            <Card title="Legal y soporte">
              <Row title="Política de privacidad" hint="Cómo tratamos tus datos.">
                <button className="settings-action" onClick={() => setView("privacy")}>Ver</button>
              </Row>
              <Row title="Términos de uso" hint="Reglas de tu cuenta, límites y uso de las pistas.">
                <button className="settings-action" onClick={() => setView("terms")}>Ver</button>
              </Row>
              <Row title="Soporte por WhatsApp" hint={CONTACTO_SOPORTE.whatsappDisplay}>
                <button className="settings-action" onClick={() => void openExternal(whatsappLink(`Hola, necesito ayuda con Crescendo Live.${account?.email ? ` Mi correo es ${account.email}.` : ""}`))}>Escribir</button>
              </Row>
              <Row title="Soporte por correo" hint={<a className="support-link" href={mailtoLink()} onClick={(e) => { e.preventDefault(); void openExternal(mailtoLink()); }}>{CONTACTO_SOPORTE.email}</a>}>
                <button className="settings-action" onClick={() => void openExternal(mailtoLink(SOPORTE_ASUNTO, account?.email ? `Mi correo en la app es ${account.email}.` : ""))}>Escribir</button>
                <CopyEmailButton className="settings-action" />
              </Row>
            </Card>

            <Card title="Avanzado">
              <Row title="Diagnóstico" hint="Rendimiento, memoria y audio del dispositivo.">
                <button className="settings-action" onClick={() => setView("diag")}>Ver</button>
              </Row>
            </Card>
          </>
        )}
      </div>
    </section>
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
    ["Animaciones", FX_LABEL[fx]],
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
      <section className="settings-card">
        <dl className="diag-list">
          {rows.map(([name, value]) => (<div key={name}><dt>{name}</dt><dd>{value}</dd></div>))}
        </dl>
      </section>
      {timings.length > 0 && (
        <section className="settings-card">
          <h2>Últimos tiempos</h2>
          <dl className="diag-list">
            {timings.map((row, index) => (<div key={index}><dt>{row.phase} · {row.stage}</dt><dd>{Math.round(row.ms)} ms</dd></div>))}
          </dl>
        </section>
      )}
      <button className="settings-action" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => undefined)}>
        {copied ? "Copiado" : "Copiar diagnóstico"}
      </button>
    </>
  );
}
