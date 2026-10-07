# Met la fenêtre principale d'un processus au premier plan et en fait une capture PNG.
# Les fenêtres OpenGL ne se capturent pas en arrière-plan (image noire) : le premier plan est indispensable.
param([int]$ProcessId, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
"@
$h = (Get-Process -Id $ProcessId).MainWindowHandle
[Win]::ShowWindow($h, 9) | Out-Null
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 1500
$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Out)
"$w x $hh"
