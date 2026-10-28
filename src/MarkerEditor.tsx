import { useState } from "react";
import { MARKER_COLORS, MARKER_NAMES, type Marker } from "./markers";
import { shortTime } from "./clock";

type Props = {
  marker: Marker;
  isNew: boolean;
  duration: number;
  onSave: (marker: Marker) => void;
  onDelete: () => void;
  onClose: () => void;
};

/** Editor de un marcador de sección: nombre, posición y color. */
export default function MarkerEditor({ marker, isNew, duration, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState(marker);
  const name = draft.name.trim() || "Marcador";
  return (
    <div className="load-layer marker-layer" role="dialog" aria-label={isNew ? "Nuevo marcador" : "Editar marcador"}>
      <div className="load-card marker-card">
        <span className="eyebrow">{isNew ? "NUEVO MARCADOR" : "EDITAR MARCADOR"} · {shortTime(draft.position * duration)}</span>
        <div className="marker-names">
          {MARKER_NAMES.map((option) => (
            <button key={option} className={draft.name === option ? "active" : ""} onClick={() => setDraft({ ...draft, name: option })}>{option}</button>
          ))}
        </div>
        <label className="marker-field">
          <span>NOMBRE</span>
          <input value={draft.name} maxLength={14} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="marker-field">
          <span>POSICIÓN · {shortTime(draft.position * duration)}</span>
          <input type="range" min={0} max={1000} value={Math.round(draft.position * 1000)} onChange={(event) => setDraft({ ...draft, position: Number(event.target.value) / 1000 })} />
        </label>
        <div className="marker-colors" role="radiogroup" aria-label="Color">
          {MARKER_COLORS.map((color) => (
            <button key={color} role="radio" aria-checked={draft.color === color} aria-label={`Color ${color}`} className={draft.color === color ? "active" : ""} style={{ background: color }} onClick={() => setDraft({ ...draft, color })} />
          ))}
        </div>
        <div className="load-actions">
          {!isNew && <button className="pill-btn danger" onClick={onDelete}>BORRAR</button>}
          <button className="pill-btn" onClick={onClose}>CANCELAR</button>
          <button className="pill-btn primary" onClick={() => onSave({ ...draft, name })}>GUARDAR</button>
        </div>
      </div>
    </div>
  );
}
