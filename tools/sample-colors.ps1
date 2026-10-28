# Lee los píxeles de las capturas de tools/capture-colors.mjs en los puntos de points.json.
# Toma el color MÁS FRECUENTE de un bloque de 15x15 píxeles (así un borde o una letra cercana no falsean el fondo).
# Uso: powershell -File tools/sample-colors.ps1 <carpeta>
param([string]$Dir)
Add-Type -AssemblyName System.Drawing
$points = Get-Content "$Dir\points.json" -Raw | ConvertFrom-Json
foreach ($size in $points.PSObject.Properties.Name) {
  $img = [System.Drawing.Bitmap]::FromFile((Resolve-Path "$Dir\$size.png"))
  "== $size ($($img.Width)x$($img.Height))"
  foreach ($item in $points.$size.PSObject.Properties) {
    if ($null -eq $item.Value) { "{0,-34} (no visible)" -f $item.Name; continue }
    $cx = $item.Value[0]; $cy = $item.Value[1]
    $count = @{}
    for ($dx = -7; $dx -le 7; $dx++) { for ($dy = -7; $dy -le 7; $dy++) {
      $x = [Math]::Min([Math]::Max($cx + $dx, 0), $img.Width - 1); $y = [Math]::Min([Math]::Max($cy + $dy, 0), $img.Height - 1)
      $c = $img.GetPixel($x, $y); $k = "{0:X2}{1:X2}{2:X2}" -f $c.R, $c.G, $c.B
      if ($count.ContainsKey($k)) { $count[$k]++ } else { $count[$k] = 1 }
    } }
    $top = $count.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
    "{0,-34} #{1}  ({2},{3})" -f $item.Name, $top.Key, $cx, $cy
  }
  $img.Dispose()
}
