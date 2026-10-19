import { useState, useSyncExternalStore } from "react";
import { BPM_MAX, BPM_MIN, type ClickOutput, type ClickSound, type Metronome } from "./metronome";

type Props = {
  metronome: Metronome;
  onClose: () => void;
};

const BEATS = [2, 3, 4, 5, 6, 7, 8];
const SUBDIVISIONS = [
  { value: 1, label: "Ninguna" },
  { value: 2, label: "×2" },
  { value: 3, label: "×3" },
  { value: 4, label: "×4" },
];
const SOUNDS: { value: ClickSound; label: string }[] = [
  { value: "classic", label: "Clásico" },
  { value: "wood", label: "Madera" },
  { value: "hat", label: "Hi-hat" },
];
const OUTPUTS: { value: ClickOutput; label: string }[] = [
  { value: "mix", label: "Mezclado" },
  { value: "left", label: "Solo izquierdo" },
];

type SegmentedProps<T extends string | number> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
};

function Segmented<T extends string | number>({ label, value, options, onChange, hint }: SegmentedProps<T>) {
  return (
    <div className="setting" role="group" aria-label={label}>
      <span className="setting-label">{label}</span>
      <div className="seg">
        {options.map((option) => (
          <button key={option.value} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export default function Click({ metronome, onClose }: Props) {
  const state = useSyncExternalStore(metronome.subscribe, metronome.getState);
  const beat = useSyncExternalStore(metronome.subscribeBeat, metronome.getBeat);
  const [draft, setDraft] = useState<string | null>(null);

  function commitDraft() {
    if (draft !== null) {
      const parsed = parseInt(draft, 10);
      if (Number.isFinite(parsed)) metronome.set({ bpm: parsed });
    }
    setDraft(null);
  }

  const nudge = (delta: number) => metronome.set({ bpm: state.bpm + delta });

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer click-drawer" onClick={(event) => event.stopPropagation()} aria-label="Click">
        <div className="drawer-head">
          <h2>Click</h2>
          <button className="pill-btn" onClick={onClose}>CERRAR</button>
        </div>

        <section className="bpm-box">
          <div className="bpm-row">
            <button className="step-btn" onClick={() => nudge(-5)} disabled={state.bpm <= BPM_MIN} aria-label="Bajar 5 BPM">−5</button>
            <button className="step-btn" onClick={() => nudge(-1)} disabled={state.bpm <= BPM_MIN} aria-label="Bajar 1 BPM">−1</button>
            <label className="bpm-field">
              <input
                type="number"
                inputMode="numeric"
                min={BPM_MIN}
                max={BPM_MAX}
                value={draft ?? String(state.bpm)}
                aria-label="BPM"
                placeholder={String(state.bpm)}
                onFocus={() => setDraft("")}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitDraft}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              />
              <span>BPM</span>
            </label>
            <button className="step-btn" onClick={() => nudge(1)} disabled={state.bpm >= BPM_MAX} aria-label="Subir 1 BPM">+1</button>
            <button className="step-btn" onClick={() => nudge(5)} disabled={state.bpm >= BPM_MAX} aria-label="Subir 5 BPM">+5</button>
          </div>

          <input
            className="bpm-slider"
            type="range"
            min={BPM_MIN}
            max={BPM_MAX}
            value={state.bpm}
            aria-label="Tempo"
            onChange={(event) => metronome.set({ bpm: Number(event.target.value) })}
          />

          <div className="beat-dots" aria-hidden="true">
            {Array.from({ length: state.beats }, (_, index) => (
              <i key={index} className={`beat-dot ${index === 0 ? "first" : ""} ${state.running && beat === index ? "on" : ""}`} />
            ))}
          </div>

          <div className="click-actions">
            <button className="tap-btn" onClick={() => metronome.tap()}>TAP</button>
            <button
              className={`click-start ${state.running ? "is-running" : ""}`}
              onClick={() => (state.running ? metronome.stop() : void metronome.start())}
            >
              {state.running ? "DETENER CLICK" : "INICIAR CLICK"}
            </button>
          </div>
        </section>

        <Segmented
          label="Pulsos por compás"
          value={state.beats}
          options={BEATS.map((value) => ({ value, label: String(value) }))}
          onChange={(beats) => metronome.set({ beats })}
        />
        <Segmented
          label="Subdivisión"
          value={state.subdivision}
          options={SUBDIVISIONS}
          onChange={(subdivision) => metronome.set({ subdivision })}
          hint="×2 corcheas · ×3 tresillos · ×4 semicorcheas"
        />
        <Segmented
          label="Acento en el primer pulso"
          value={state.accent ? "on" : "off"}
          options={[{ value: "on", label: "Sí" }, { value: "off", label: "No" }]}
          onChange={(value) => metronome.set({ accent: value === "on" })}
        />
        <Segmented label="Sonido" value={state.sound} options={SOUNDS} onChange={(sound) => metronome.set({ sound })} />
        <Segmented
          label="Salida"
          value={state.output}
          options={OUTPUTS}
          onChange={(output) => metronome.set({ output })}
          hint="Solo izquierdo manda el click únicamente por el canal izquierdo, para separarlo del resto con tu interfaz o un cable divisor."
        />

        <div className="setting">
          <span className="setting-label">Volumen del click · {state.volume}%</span>
          <input
            className="bpm-slider"
            type="range"
            min={0}
            max={100}
            value={state.volume}
            aria-label="Volumen del click"
            onChange={(event) => metronome.set({ volume: Number(event.target.value) })}
          />
        </div>
      </aside>
    </div>
  );
}
