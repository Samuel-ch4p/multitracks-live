import { useState, type ReactNode } from "react";
import { File as MEGAFile } from "megajs";
import { audioExtensions, rarToFiles, sortFiles, zipToFilesAsync } from "./archive";
import { canDecryptNative, decryptMega } from "./megaFast";

type MegaNode = {
  name: string;
  key?: unknown;
  directory?: boolean;
  size?: number;
  children?: MegaNode[];
  download?: (
    options: Record<string, unknown>,
    callback: (error: Error | null, data?: Uint8Array) => void
  ) => { on: (event: "progress", listener: (info: { bytesLoaded: number; bytesTotal: number }) => void) => unknown };
};

type MegaFolder = MegaNode & {
  loadAttributes: () => Promise<unknown>;
  navigate: (path: string[]) => MegaNode | undefined;
};

type Props = {
  onSongLoaded: (name: string, files: File[]) => void;
};

// Carpeta de la Nube Crescendo. No se muestra ni se puede editar en la pantalla.
const MEGA_LINK = "https://mega.nz/folder/Cv51TJoT#aV2WHbuadO2B4OSisot_JA";

// Descarga en paralelo con trozos grandes: mucho más rápido que lo predeterminado (4 conexiones, trozos de 128 KB a 1 MB).
const DOWNLOAD_OPTIONS = {
  maxConnections: 16,
  initialChunkSize: 1024 * 1024,
  chunkSizeIncrement: 1024 * 1024,
  maxChunkSize: 8 * 1024 * 1024,
};

const mb = (bytes: number) => (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1);

function downloadArchive(item: MegaNode, onProgress: (text: string) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (typeof item.download !== "function") {
      reject(new Error("La nube no permitió descargar este archivo."));
      return;
    }
    const started = performance.now();
    let lastShown = 0;
    // Si el teléfono puede descifrar de forma nativa, se baja el archivo cifrado y se descifra después (mucho más rápido).
    const native = canDecryptNative(item.key);
    const stream = item.download({ ...DOWNLOAD_OPTIONS, returnCiphertext: native }, (error, data) => {
      if (error || !data) { reject(error ?? new Error("La descarga llegó vacía.")); return; }
      if (!native) { resolve(data); return; }
      onProgress("Descifrando...");
      decryptMega(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), item.key as Uint8Array).then(resolve, reject);
    });
    stream.on("progress", ({ bytesLoaded, bytesTotal }) => {
      const now = performance.now();
      if (now - lastShown < 250) return;
      lastShown = now;
      const speed = bytesLoaded / 1048576 / Math.max((now - started) / 1000, 0.1);
      const percent = bytesTotal ? Math.round((bytesLoaded / bytesTotal) * 100) : 0;
      onProgress(`Descargando ${percent}% · ${mb(bytesLoaded)} de ${mb(bytesTotal)} MB · ${speed.toFixed(1)} MB/s`);
    });
  });
}

const isArchive = (name: string) => /\.(zip|rar)$/i.test(name);

/** Mensajes en español y sin nombrar el servicio de almacenamiento. */
function friendlyError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  if (/bandwidth|509|rate limit|límite/i.test(message)) {
    return "La nube alcanzó su límite de descarga por ahora. Inténtalo de nuevo en un rato.";
  }
  if (/failed to fetch|network|load failed|timeout|abort/i.test(message)) {
    return "No pudimos conectar con la Nube Crescendo. Comprueba tu conexión.";
  }
  const clean = message.replace(/mega(\.nz|js)?/gi, "la nube").trim();
  return clean || fallback;
}

function CloudIcon({ name }: { name: "cloud" | "folder" | "archive" | "back" | "refresh" }) {
  const paths: Record<typeof name, ReactNode> = {
    cloud: <path d="M7 18h11a4 4 0 0 0 .5-8A6.5 6.5 0 0 0 6 8.2 4.9 4.9 0 0 0 7 18Z" />,
    folder: <path d="M3 7.5h7l2-2h9v13H3v-11Z" />,
    archive: <><path d="M5 3h14v5H5V3Z" /><path d="M6 8v13h12V8M10 12h4" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M18.5 16a8 8 0 1 1 1.1-8.1L20 12" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function MegaBrowser({ onSongLoaded }: Props) {
  const [root, setRoot] = useState<MegaFolder | null>(null);
  const [items, setItems] = useState<MegaNode[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const busy = connecting || adding;

  async function connect() {
    setConnecting(true);
    setError("");
    setStatus("");
    setSelected(null);

    try {
      const folder = MEGAFile.fromURL(MEGA_LINK) as unknown as MegaFolder;
      await folder.loadAttributes();

      if (!folder.children) {
        throw new Error("La nube no devolvió el contenido de la biblioteca.");
      }

      setRoot(folder);
      setItems(folder.children);
      setPath([]);
    } catch (err) {
      setError(friendlyError(err, "No se pudo conectar con la Nube Crescendo."));
    } finally {
      setConnecting(false);
    }
  }

  function openFolder(item: MegaNode) {
    if (!item.directory || !root) return;

    const nextPath = [...path, item.name];
    const folder = root.navigate(nextPath);

    if (!folder?.children) {
      setError("No se pudo abrir esta carpeta.");
      return;
    }

    setPath(nextPath);
    setItems(folder.children);
    setSelected(null);
    setError("");
    setStatus("");
  }

  function goBack() {
    if (!root || path.length === 0) return;

    const previousPath = path.slice(0, -1);
    const folder = previousPath.length === 0 ? root : root.navigate(previousPath);

    setPath(previousPath);
    setItems(folder?.children ?? []);
    setSelected(null);
    setError("");
    setStatus("");
  }

  async function addArchiveToPlaylist(item: MegaNode) {
    if (typeof onSongLoaded !== "function") {
      setError("El reproductor no recibió la función para añadir canciones.");
      return;
    }

    const isZip = item.name.toLowerCase().endsWith(".zip");
    const isRar = item.name.toLowerCase().endsWith(".rar");

    if (!isZip && !isRar) {
      setError("El archivo debe ser ZIP o RAR.");
      return;
    }

    setAdding(true);
    setError("");

    try {
      // Nada se guarda en el teléfono: la canción vive solo en memoria mientras la app está abierta.
      setStatus("Conectando para descargar...");
      const downloaded = await downloadArchive(item, setStatus);

      let files: File[] = [];

      if (isZip) {
        setStatus("Extrayendo archivos ZIP...");
        files = await zipToFilesAsync(downloaded);
      } else {
        setStatus("Extrayendo archivos RAR...");

        const buffer = new ArrayBuffer(downloaded.byteLength);
        new Uint8Array(buffer).set(downloaded);

        files = await rarToFiles(new File([buffer], item.name));
      }

      files = sortFiles(files.filter((file) => audioExtensions.test(file.name)));

      if (files.length === 0) {
        throw new Error("No se encontraron pistas de audio compatibles en este archivo.");
      }

      const songName = item.name.replace(/\.(zip|rar)$/i, "");

      onSongLoaded(songName, files);
      setSelected(null);
      setStatus(`Añadida: ${songName} · ${files.length} pistas.`);
    } catch (err) {
      console.error("Error al extraer multitrack:", err);
      setError(friendlyError(err, "No se pudo extraer el archivo."));
      setStatus("");
    } finally {
      setAdding(false);
    }
  }

  const visible = items
    .filter((item) => item.directory || isArchive(item.name))
    .sort((a, b) =>
      Number(!!b.directory) - Number(!!a.directory) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );

  const connectionLabel = connecting
    ? "Consultando biblioteca…"
    : error && !root
      ? "Error de conexión"
      : root
        ? "Biblioteca conectada"
        : "Sin conectar";
  const connectionClass = connecting ? "loading" : error && !root ? "error" : root ? "connected" : "idle";
  const refreshLabel = connecting ? "CONECTANDO…" : error && !root ? "REINTENTAR" : root ? "ACTUALIZAR" : "CONECTAR";

  return (
    <>
      <div className="library-subbar">
        <div className="cloud-status">
          <div>
            <span className="cloud-label">NUBE</span>
            <span className={`connection-state ${connectionClass}`}>
              <i />
              {connectionLabel}
            </span>
          </div>
          <button className="refresh-library" disabled={busy} onClick={() => void connect()}>
            <CloudIcon name="refresh" />
            <span>{refreshLabel}</span>
          </button>
        </div>

        {root && (
          <div className="library-location">
            <button aria-label="Volver a la carpeta anterior" disabled={path.length === 0 || busy} onClick={goBack}>
              <CloudIcon name="back" />
            </button>
            <div>
              <span>UBICACIÓN ACTUAL</span>
              <strong>{path.length ? path.join(" / ") : "Mi biblioteca"}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="library-scroll">
        {(status || error) && root && (
          <div className="library-notes">
            {status && <p className="status-message">{status}</p>}
            {error && <p className="error-message">{error}</p>}
          </div>
        )}

        {!root && !connecting && (
          <div className={`library-state ${error ? "error" : "empty"}`}>
            <span className="state-icon"><CloudIcon name="cloud" /></span>
            <strong>{error ? "No pudimos conectar con la Nube Crescendo" : "Biblioteca Crescendo"}</strong>
            <span>{error || "Conéctate para ver las canciones disponibles."}</span>
            <button onClick={() => void connect()}>{error ? "REINTENTAR CONEXIÓN" : "CONECTAR"}</button>
          </div>
        )}

        {connecting && (
          <div className="library-loading" aria-label="Cargando contenido">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="library-skeleton" key={index}>
                <span />
                <div><i /><i /></div>
              </div>
            ))}
          </div>
        )}

        {root && !connecting && visible.length === 0 && (
          <div className="library-state empty">
            <span className="state-icon"><CloudIcon name="folder" /></span>
            <strong>Esta carpeta está vacía</strong>
            <span>No se encontraron canciones ni multitracks.</span>
          </div>
        )}

        {root && !connecting && visible.length > 0 && (
          <div className="library-items">
            {visible.map((item, index) => {
              const isFolder = !!item.directory;
              const isSelected = !isFolder && selected === item.name;
              return (
                <div className={`library-item ${isFolder ? "folder" : "archive"} ${isSelected ? "selected" : ""}`} key={`${item.name}-${index}`}>
                  <button
                    className="library-item-main"
                    disabled={busy}
                    onClick={() => (isFolder ? openFolder(item) : setSelected(isSelected ? null : item.name))}
                  >
                    <span className="item-icon"><CloudIcon name={isFolder ? "folder" : "archive"} /></span>
                    <span className="item-copy">
                      <strong>{item.name.replace(/\.(zip|rar)$/i, "")}</strong>
                      <small>
                        {isFolder
                          ? `${item.children?.length ?? 0} elementos`
                          : typeof item.size === "number" ? `${(item.size / 1048576).toFixed(0)} MB` : "Multitrack"}
                      </small>
                    </span>
                    {isFolder ? <span className="item-chevron">›</span> : !isSelected && <span className="file-kind">{/\.rar$/i.test(item.name) ? "RAR" : "ZIP"}</span>}
                  </button>
                  {isSelected && (
                    <button className="add-song-button" disabled={busy} onClick={() => void addArchiveToPlaylist(item)}>
                      {adding ? "PROCESANDO…" : "＋ AÑADIR"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
