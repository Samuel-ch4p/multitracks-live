import { useEffect, useSyncExternalStore } from "react";
import { PAD_NOTES, chordName, hasChord, hasVariant, type PadEngine } from "./padEngine";

type Props = { engine: PadEngine };

/** Panel "Ambient Pad": notas C–B, ♯ y m, volumen y apagado con fundido. */
export default function Pads({ engine }: Props) {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const current = chordName(state.note, state.sharp, state.minor);
  const canSharp = hasVariant("sharp");
  const canMinor = hasVariant("minor");

  useEffect(() => { engine.preload(); }, [engine]);

  return (
    <div className={`pad-panel ${state.playing ? "is-playing" : ""}`}>
      <div className="pad-title">
        <div>
          <span className="eyebrow">AMBIENT PAD</span>
          <h2>Atmosphere</h2>
        </div>
        <span className={`pad-chip ${state.playing ? "on" : ""}`}><i />{state.loading ? "CARGANDO…" : state.playing ? current : "APAGADO"}</span>
      </div>

      <div className="pad-grid" role="group" aria-label="Nota del pad">
        {PAD_NOTES.map((note) => {
          const active = state.playing && state.note === note;
          return (
            <button
              key={note}
              className={`pad-key ${active ? "active" : ""}`}
              aria-pressed={active}
              disabled={!hasChord(note, state.sharp, state.minor)}
              onClick={() => engine.toggleNote(note)}
            >
              {chordName(note, state.sharp, state.minor)}
            </button>
          );
        })}
        <button className="pad-key pad-off" onClick={() => engine.stop()} disabled={!state.playing} aria-label="Apagar el pad">
          APAGAR
        </button>
      </div>

      <div className="pad-mods" role="group" aria-label="Variación del acorde">
        <button className={`pad-mod ${state.sharp ? "active" : ""}`} aria-pressed={state.sharp} disabled={!canSharp} title={canSharp ? undefined : "Próximamente"} onClick={() => engine.set({ sharp: !state.sharp })}>
          ♯ SOSTENIDO{canSharp ? "" : " · PRONTO"}
        </button>
        <button className={`pad-mod ${state.minor ? "active" : ""}`} aria-pressed={state.minor} disabled={!canMinor} title={canMinor ? undefined : "Próximamente"} onClick={() => engine.set({ minor: !state.minor })}>
          m MENOR{canMinor ? "" : " · PRONTO"}
        </button>
      </div>

      <label className="pad-volume">
        <span className="setting-label">Volumen del pad · {state.volume}%</span>
        <input
          className="bpm-slider"
          type="range"
          min={0}
          max={100}
          value={state.volume}
          aria-label="Volumen del pad"
          onChange={(event) => engine.set({ volume: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}
