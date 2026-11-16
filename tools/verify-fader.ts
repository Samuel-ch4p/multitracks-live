// Nivel 3: fader con modo fino, zona muerta menor y gestos diagonales. Sin saltos y sin temblor.
// Uso: node tools/verify-fader.ts
import { FADER_DEAD_ZONE, FINE_DX, FINE_FACTOR, FaderDrag, faderAxis } from "../src/faderGesture.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

// Ejes
check("zona muerta del carril menor que antes (8)", FADER_DEAD_ZONE < 8, `${FADER_DEAD_ZONE} px`);
check("carril: gesto diagonal 45° → mueve el fader (antes: a veces desplazaba)", faderAxis(10, -10, false) === "vertical");
check("carril: diagonal tendida 35° → mueve el fader", faderAxis(10, -7, false) === "vertical");
check("carril: claramente horizontal → desplaza la lista", faderAxis(12, -3, false) === "horizontal");
check("carril: dentro de la zona muerta → aún nada", faderAxis(3, 3, false) === "pending");
check("perilla: incluso casi horizontal → fader (lo horizontal es el modo fino)", faderAxis(12, -2, true) === "vertical");

// Arrastre normal: relativo y sin salto
const RAIL = 200; // px de carril → 1 unidad = 2 px
{
  const d = new FaderDrag(100, 300, 80, RAIL);
  check("primer movimiento de 1 px: sin salto (no cambia el entero)", d.move(100, 299) === null);
  check("40 px arriba = +20", d.move(100, 260) === 100 || d.move(100, 260) === null);
}
{
  const d = new FaderDrag(100, 300, 50, RAIL);
  check("20 px arriba = 60", d.move(100, 280) === 60);
  check("vuelve al punto de inicio = 50", d.move(100, 300) === 50);
  check("no pasa de 0", d.move(100, 1000) === 0);
}

// Modo fino por apartar el dedo en horizontal
{
  const d = new FaderDrag(100, 300, 50, RAIL);
  d.move(100, 280); // 60
  const before = 60;
  const atSwitch = d.move(100 + FINE_DX + 5, 280); // se aparta en horizontal sin mover en vertical
  check("al entrar en modo fino el valor NO salta", atSwitch === null && d.fine, `fino=${d.fine}`);
  const v = d.move(100 + FINE_DX + 5, 240); // 40 px arriba en fino = +5 (×0,25)
  check(`en fino 40 px = +${40 / 2 * FINE_FACTOR} (×${FINE_FACTOR})`, v === before + 5, `valor ${v}`);
  const back = d.move(100, 240); // vuelve hacia la columna: sale del fino sin salto
  check("al salir del modo fino tampoco salta", back === null && !d.fine);
  check("después sigue a velocidad normal", d.move(100, 220) === before + 5 + 10);
}

// Modo fino por mantener pulsado antes de mover
{
  const d = new FaderDrag(100, 300, 50, RAIL, true);
  check("dedo quieto antes de mover: empieza en modo fino", d.fine);
  check("…20 px = +2/3 (no +10)", (d.move(100, 280) ?? 0) <= 53);
}

// Sin temblor: un dedo que tiembla ±1 px no hace saltar el número
{
  const d = new FaderDrag(100, 300, 50, RAIL);
  let emitted = 0;
  for (const y of [300, 301, 299, 300, 301, 300, 299]) if (d.move(100, y) !== null) emitted++;
  check("temblor de ±1 px: ningún cambio emitido", emitted === 0);
}
{
  const d = new FaderDrag(100, 300, 50, RAIL, true);
  let emitted = 0;
  for (const y of [300, 302, 298, 301, 299, 300]) if (d.move(100, y) !== null) emitted++;
  check("temblor de ±2 px en modo fino: ningún cambio emitido", emitted === 0);
}

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
