import { memo, useEffect, useRef, useState } from "react";
import { CloudIcon } from "./CloudParts";
import { setSearchMode } from "./searchMode";

type Props = {
  /** Recibe el texto ya asentado (con retraso al escribir, de inmediato al terminar una composición del teclado). */
  onSearch: (text: string) => void;
  /** Cambia para vaciar el cuadro desde fuera (por ejemplo, al abrir un artista). */
  resetSignal: number;
  placeholder: string;
  label: string;
  /** Pausa (ms) entre la última tecla y el filtrado. */
  delay?: number;
};

/**
 * Cuadro de búsqueda NO CONTROLADO: el texto vive solo en el <input> (defaultValue, sin `value`), así React nunca reescribe lo que
 * el teclado del celular (Gboard: predicción, composición) está componiendo; antes, un valor atrasado por un render lento hacía
 * saltar el cursor y desordenaba las letras. `input.value` solo se asigna al pulsar la X o al vaciar desde fuera.
 *  · El filtrado recibe una COPIA del texto (onSearch), con pausa de ~150 ms; la normalización (minúsculas, sin tildes) ocurre allá.
 *  · No se filtra entre compositionstart y compositionend; al terminar la composición se filtra de inmediato.
 *  · Mientras tiene el foco activa el "modo búsqueda" (la lista de resultados gana la pantalla).
 * Este componente está declarado a nivel de módulo y con memo: su identidad no cambia en cada render de la Biblioteca.
 */
const SearchBox = memo(function SearchBox({ onSearch, resetSignal, placeholder, label, delay = 150 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false); // solo para mostrar/ocultar la X; no es el valor del campo
  const composing = useRef(false);
  const timer = useRef(0);
  const exitTimer = useRef(0);
  const lastSent = useRef("");
  const lastReset = useRef(resetSignal);
  const onSearchRef = useRef(onSearch);
  useEffect(() => { onSearchRef.current = onSearch; });

  const flush = (value: string) => {
    window.clearTimeout(timer.current);
    if (value === lastSent.current) return;
    lastSent.current = value;
    onSearchRef.current(value);
  };
  const schedule = (value: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(value), value ? delay : 0);
  };

  // Vaciado externo (p. ej. al abrir un artista): el padre ya limpió su filtro; aquí solo se vacía el campo.
  useEffect(() => {
    if (lastReset.current === resetSignal) return;
    lastReset.current = resetSignal;
    window.clearTimeout(timer.current);
    lastSent.current = "";
    if (inputRef.current) inputRef.current.value = "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasText(false);
  }, [resetSignal]);

  // El teclado se cerró con "atrás" pero el campo conserva el foco: se suelta para salir del modo búsqueda.
  useEffect(() => {
    const viewport = window.visualViewport;
    const input = inputRef.current;
    if (!viewport || !input) return;
    let baseline = viewport.height;
    let focusedAt = 0;
    const onFocus = () => { focusedAt = Date.now(); };
    input.addEventListener("focus", onFocus);
    const onResize = () => {
      if (document.activeElement !== input) { baseline = Math.max(baseline, viewport.height); return; }
      if (Date.now() - focusedAt > 600 && viewport.height >= baseline - 60) input.blur();
    };
    viewport.addEventListener("resize", onResize);
    return () => { viewport.removeEventListener("resize", onResize); input.removeEventListener("focus", onFocus); };
  }, []);

  useEffect(() => () => { window.clearTimeout(timer.current); window.clearTimeout(exitTimer.current); setSearchMode(false); }, []);

  return (
    <label className="lib-search" role="search">
      <CloudIcon name="search" />
      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={placeholder}
        aria-label={label}
        defaultValue=""
        onInput={(event) => {
          const value = event.currentTarget.value;
          setHasText(value.length > 0);
          if (!composing.current) schedule(value);
        }}
        onCompositionStart={() => { composing.current = true; window.clearTimeout(timer.current); }}
        onCompositionEnd={(event) => { composing.current = false; flush(event.currentTarget.value); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onFocus={(event) => {
          window.clearTimeout(exitTimer.current);
          setSearchMode(true);
          const field = event.currentTarget;
          window.requestAnimationFrame(() => { field.closest(".library-body")?.scrollTo({ top: 0 }); }); // el campo queda fijo arriba y visible
        }}
        // La salida espera un instante: el toque en un resultado llega antes de que la pantalla vuelva a su tamaño normal.
        onBlur={(event) => { flush(event.currentTarget.value); exitTimer.current = window.setTimeout(() => setSearchMode(false), 250); }}
      />
      {hasText && (
        <button
          type="button"
          className="lib-clear"
          aria-label="Limpiar búsqueda"
          onMouseDown={(event) => event.preventDefault()} // el campo conserva el foco y el teclado
          onClick={() => {
            if (inputRef.current) { inputRef.current.value = ""; inputRef.current.focus(); }
            setHasText(false);
            flush("");
          }}
        >×</button>
      )}
    </label>
  );
});

export default SearchBox;
