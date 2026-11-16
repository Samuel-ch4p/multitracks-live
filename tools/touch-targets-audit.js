// P9: auditoría de zonas táctiles EN EL NAVEGADOR (no forma parte de `npm run verify`).
// Uso: `npm run dev`, abrir http://localhost:5173/?demo en modo dispositivo (p. ej. 760×360, táctil) y pegar este archivo en la consola.
// Mide la zona que de verdad recibe el toque (elementFromPoint, incluye las ampliaciones con ::before/::after) y lista lo que queda
// por debajo de 44 px en ancho o alto. Excepciones conocidas: ver el final de src/styles/touch.css.
(() => {
  const out = [];
  const controls = [...document.querySelectorAll("button, [role=slider], input, select, a[href], [role=button], .pan-hit")].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  });
  for (const e of controls) {
    const r = e.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); };
    if (!hit(cx, cy)) continue; // tapado (fuera del desplazamiento visible)
    let left = 0, right = 0, up = 0, down = 0;
    while (left < 40 && hit(cx - left - 1, cy)) left++;
    while (right < 40 && hit(cx + right + 1, cy)) right++;
    while (up < 40 && hit(cx, cy - up - 1)) up++;
    while (down < 40 && hit(cx, cy + down + 1)) down++;
    const w = left + right + 1;
    const h = up + down + 1;
    if (w < 43 || h < 43) out.push({ control: (e.getAttribute("aria-label") || e.textContent || String(e.className)).trim().slice(0, 40), visible: `${Math.round(r.width)}×${Math.round(r.height)}`, zona: `${w}×${h}` });
  }
  console.table(out);
  return out;
})();
