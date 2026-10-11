import { useState } from "react";
import { File as MEGAFile } from "megajs";
import { audioExtensions, rarToFiles, sortFiles, zipToFiles } from "./archive";

type MegaNode = {
  name: string;
  directory?: boolean;
  size?: number;
  children?: MegaNode[];
  downloadBuffer?: () => Promise<Uint8Array>;
};

type MegaFolder = MegaNode & {
  loadAttributes: () => Promise<unknown>;
  navigate: (path: string[]) => MegaNode | undefined;
};

type Props = {
  onSongLoaded: (name: string, files: File[]) => void;
};

const DEFAULT_LINK =
  "https://mega.nz/folder/Cv51TJoT#aV2WHbuadO2B4OSisot_JA";

const LINK_KEY = "multitracks-mega-link";

function savedLink(): string {
  try {
    return localStorage.getItem(LINK_KEY) || DEFAULT_LINK;
  } catch {
    return DEFAULT_LINK;
  }
}

export default function MegaBrowser({ onSongLoaded }: Props) {
  const [root, setRoot] = useState<MegaFolder | null>(null);
  const [items, setItems] = useState<MegaNode[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [link, setLink] = useState(savedLink);

  async function connect() {
    setLoading(true);
    setError("");
    setStatus("Conectando con MEGA...");

    try {
      const url = link.trim();
      if (!/^https:\/\/mega\.(nz|io)\/folder\//i.test(url)) {
        throw new Error("Pega un enlace de carpeta de MEGA (https://mega.nz/folder/…).");
      }

      const folder = MEGAFile.fromURL(url) as unknown as MegaFolder;

      await folder.loadAttributes();

      if (!folder.children) {
        throw new Error(
          "MEGA no devolvió el contenido de la carpeta."
        );
      }

      try { localStorage.setItem(LINK_KEY, url); } catch { /* sin almacenamiento */ }
      setRoot(folder);
      setItems(folder.children);
      setPath([]);
      setStatus("Biblioteca conectada.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo conectar con MEGA."
      );
      setStatus("");
    } finally {
      setLoading(false);
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
    setError("");
    setStatus("");
  }

  function goBack() {
    if (!root || path.length === 0) return;

    const previousPath = path.slice(0, -1);

    const folder =
      previousPath.length === 0
        ? root
        : root.navigate(previousPath);

    setPath(previousPath);
    setItems(folder?.children ?? []);
    setError("");
    setStatus("");
  }

  async function addArchiveToPlaylist(item: MegaNode) {
    if (typeof onSongLoaded !== "function") {
      setError(
        "El reproductor no recibió la función para añadir canciones."
      );
      return;
    }

    if (typeof item.downloadBuffer !== "function") {
      setError("MEGA no permitió descargar este archivo.");
      return;
    }

    const isZip = item.name.toLowerCase().endsWith(".zip");
    const isRar = item.name.toLowerCase().endsWith(".rar");

    if (!isZip && !isRar) {
      setError("El archivo debe ser ZIP o RAR.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("Descargando desde MEGA...");

    try {
      const downloaded = await item.downloadBuffer();

      let files: File[] = [];

      if (isZip) {
        setStatus("Extrayendo archivos ZIP...");

        files = zipToFiles(new Uint8Array(downloaded));
      } else {
        setStatus("Extrayendo archivos RAR...");

        const buffer = new ArrayBuffer(downloaded.byteLength);
        new Uint8Array(buffer).set(downloaded);

        files = await rarToFiles(new File([buffer], item.name));
      }

      files = sortFiles(
        files.filter((file) => audioExtensions.test(file.name))
      );

      if (files.length === 0) {
        throw new Error(
          "No se encontraron pistas de audio compatibles. " +
          "Si es RAR, tendremos que revisar el formato de salida del extractor."
        );
      }

      const songName = item.name.replace(/\.(zip|rar)$/i, "");

      onSongLoaded(songName, files);

      setStatus(
        `Añadida: ${songName} · ${files.length} pistas.`
      );
    } catch (err) {
      console.error("Error al extraer multitrack:", err);

      setError(
        err instanceof Error
          ? err.message
          : "No se pudo extraer el archivo."
      );

      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mega-browser">
      <div className="section-heading">
        <div>
          <h3>MEGA</h3>
        </div>

        <button
          className="pill-btn"
          onClick={() => void connect()}
          disabled={loading}
        >
          {loading ? "PROCESANDO…" : root ? "ACTUALIZAR" : "CONECTAR"}
        </button>
      </div>

      <input
        className="link-input"
        type="url"
        inputMode="url"
        value={link}
        onChange={(event) => setLink(event.target.value)}
        placeholder="Enlace de carpeta de MEGA"
        aria-label="Enlace de la carpeta de MEGA"
        spellCheck={false}
      />

      {path.length > 0 && (
        <div className="folder-navigation">
          <button
            className="pill-btn"
            onClick={goBack}
            disabled={loading}
          >
            ← Volver
          </button>

          <span>{path.join(" / ")}</span>
        </div>
      )}

      {status && <p className="status-message">{status}</p>}
      {error && <p className="error-message">{error}</p>}

      <div className="mega-list">
        {items.map((item, index) => (
          <article
            className="mega-item"
            key={`${item.name}-${index}`}
          >
            {item.directory ? (
              <button
                className="folder-button"
                onClick={() => openFolder(item)}
                disabled={loading}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                <span>{item.name}</span>
                <span>›</span>
              </button>
            ) : (
              <div className="archive-item">
                <div className="archive-info">
                  <strong>{item.name}</strong>

                  {typeof item.size === "number" && (
                    <span>
                      {(item.size / 1048576).toFixed(1)} MB
                    </span>
                  )}
                </div>

                {/\.(zip|rar)$/i.test(item.name) && (
                  <button
                    className="pill-btn add-song-button"
                    onClick={() =>
                      void addArchiveToPlaylist(item)
                    }
                    disabled={loading}
                  >
                    {loading
                      ? "PROCESANDO…"
                      : "＋ AÑADIR"}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}