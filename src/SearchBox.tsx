import { memo, useEffect, useRef, useState } from "react";
import { CloudIcon } from "./CloudParts";

type Props = {
  /** Recibe el texto ya asentado (con retraso al escribir, de inmediato al terminar una composición del teclado). */
  onSearch: (text: string) => void;
  /** Cambia para vaciar el cuadro desde fuera (por ejemplo, al abrir un artista). */
  resetSignal: number;
  placeholder: string;
  label: string;
  delay?: number;
};

/**
 * Cuadro de búsqueda. El texto que se ve vive SOLO aquí (estado crudo, sin recortar ni normalizar): nadie lo reescribe desde fuera,
 * así el teclado del celular (predicción, composición) no recibe valores atrasados. El resto de la pantalla solo recibe el filtro
 * (`onSearch`), con retraso para no recalcular en cada tecla y sin tocar el filtro mientras el teclado está componiendo una palabra.
 * Escribir repinta solo este componente, no toda la Biblioteca.
 */
const SearchBox = memo(function SearchBox({ onSearch, resetSignal, placeholder, label, delay = 200 }: Props) {
  const [text, setText] = useState("");
  const composing = useRef(false);
  const lastReset = useRef(resetSignal);

  // Vaciado externo: se ajusta durante el render (patrón de React) para no escribir el valor desde un efecto.
  if (lastReset.current !== resetSignal) {
    lastReset.current = resetSignal;
    if (text !== "") setText("");
  }

  useEffect(() => {
    if (composing.current) return;
    const timer = window.setTimeout(() => onSearch(text), text ? delay : 0);
    return () => window.clearTimeout(timer);
  }, [text, delay, onSearch]);

  return (
    <label className="lib-search" role="search">
      <CloudIcon name="search" />
      <input
        type="text"
        role="searchbox"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          setText(value);
          onSearch(value);
        }}
      />
      {text && <button type="button" className="lib-clear" aria-label="Limpiar búsqueda" onClick={() => { setText(""); onSearch(""); }}>×</button>}
    </label>
  );
});

export default SearchBox;
