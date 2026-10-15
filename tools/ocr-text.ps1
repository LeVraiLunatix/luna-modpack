# Lit le texte d'une image avec l'OCR de Windows (utilisé par le benchmark pour lire l'écran F3).
#   powershell -File tools/ocr-text.ps1 -Image capture.png     → une ligne de texte par ligne reconnue
param([string]$Image, [switch]$TopLeft)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
if ($TopLeft) {
  # Recadre le coin haut-gauche (ligne des FPS de F3) et l'agrandit : l'OCR lit mal le petit texte du jeu.
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Image]::FromFile((Resolve-Path $Image).Path)
  $w = [Math]::Min(760, $src.Width); $h = 110
  $dst = New-Object System.Drawing.Bitmap ($w * 3), ($h * 3)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = "NearestNeighbor"
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, ($w * 3), ($h * 3)), (New-Object System.Drawing.Rectangle 0, 30, $w, $h), "Pixel")
  $g.Dispose(); $src.Dispose()
  $Image = Join-Path $env:TEMP "ocr-crop.png"; $dst.Save($Image); $dst.Dispose()
}
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Image).Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
foreach ($line in $result.Lines) { Write-Output $line.Text }
