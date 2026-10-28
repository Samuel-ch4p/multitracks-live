import { useRef, useState } from "react";
import { PROFILE_LABEL, type ProfileSource } from "./trackProfiles";

type Props = {
  source: ProfileSource;
  hasSong: boolean;
  /** Cada acción devuelve el aviso que se muestra al usuario. */
  onSaveDefault: () => string;
  onSaveSong: () => string;
  onReset: () => string;
  onExport: () => string;
  onImport: (text: string) => string;
  onClose: () => void;
};

/** Cajón "Perfil de pistas": guardar cómo arrancan las pistas (predeterminado o solo esta canción), restablecer, exportar e importar. */
export default function ProfileDrawer({ source, hasSong, onSaveDefault, onSaveSong, onReset, onExport, onImport, onClose }: Props) {
  const [message, setMessage] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [text, setText] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const confirmTimer = useRef<number | null>(null);

  function reset() {
    if (!confirmReset) {
      setConfirmReset(true);
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    setConfirmReset(false);
    setMessage(onReset());
  }

  function exportProfile() {
    const json = onExport();
    setText(json);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(URL.createObjectURL(new Blob([json], { type: "application/json" })));
    // En el celular no siempre hay descarga de archivos: el texto queda a la vista y se copia al portapapeles.
    void navigator.clipboard?.writeText(json).then(
      () => setMessage("Perfil exportado y copiado. Pégalo en un archivo o en otro dispositivo."),
      () => setMessage("Perfil exportado: copia el texto de abajo.")
    );
    setMessage("Perfil exportado: copia el texto de abajo o descarga el archivo.");
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer profile-drawer" onClick={(event) => event.stopPropagation()} aria-label="Perfil de pistas">
        <div className="drawer-head">
          <h2>Perfil de pistas</h2>
          <button className="pill-btn" onClick={onClose}>CERRAR</button>
        </div>

        <p className="profile-active">Perfil activo <strong>{PROFILE_LABEL[source]}</strong></p>
        <p className="hint">Guarda cómo arrancan las pistas al cargar una canción: volumen del fader, paneo, mute/solo y el volumen del master. La normalización es aparte y no se guarda aquí.</p>

        <button className="profile-big" disabled={!hasSong} onClick={() => setMessage(onSaveDefault())}>GUARDAR COMO PREDETERMINADO</button>
        <p className="hint">Se aplica a las pistas de cualquier canción con el mismo nombre (batería, bajo, teclas, coros…). Las demás usan valores de fábrica.</p>
        <button className="profile-big" disabled={!hasSong} onClick={() => setMessage(onSaveSong())}>GUARDAR SOLO PARA ESTA CANCIÓN</button>
        <p className="hint">Tiene prioridad sobre el predeterminado. Orden: canción › predeterminado › fábrica.</p>
        <button className={`profile-big danger ${confirmReset ? "is-armed" : ""}`} onClick={reset}>
          {confirmReset ? "¿SEGURO? TOCA DE NUEVO PARA RESTABLECER" : "RESTABLECER VALORES DE FÁBRICA"}
        </button>

        <div className="profile-io">
          <span className="setting-label">Exportar / importar</span>
          <div className="profile-io-row">
            <button className="profile-small" onClick={exportProfile}>EXPORTAR</button>
            <button className="profile-small" onClick={() => fileRef.current?.click()}>IMPORTAR ARCHIVO</button>
            <button className="profile-small" disabled={!text.trim()} onClick={() => setMessage(onImport(text))}>IMPORTAR TEXTO</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void file.text().then((content) => { setText(content); setMessage(onImport(content)); }, () => setMessage("No se pudo leer el archivo."));
            }}
          />
          <textarea
            className="profile-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Aquí aparece el perfil exportado. Para importar, pega aquí el texto."
            spellCheck={false}
            rows={5}
          />
          {downloadUrl && <a className="profile-download" href={downloadUrl} download="crescendo-perfil.json">Descargar archivo .json</a>}
        </div>

        {message && <p className="profile-message" role="status">{message}</p>}
      </aside>
    </div>
  );
}
