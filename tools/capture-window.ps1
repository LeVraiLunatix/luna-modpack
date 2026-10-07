# Met la fenetre principale d'un processus au premier plan et en fait une capture PNG.
# Les fenetres OpenGL ne se capturent pas en arriere-plan (image noire) : le premier plan est indispensable.
# On photographie l'ecran a l'emplacement de la fenetre : si une autre fenetre reste devant, on abandonne
# (code 2) plutot que de capturer la mauvaise image.
param([int]$ProcessId, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public struct RECT { public int L, T, R, B; }
  // Technique classique : on rattache temporairement notre fil d'entree a celui de la fenetre active,
  // ce qui autorise SetForegroundWindow, puis on detache.
  public static bool Focus(IntPtr h) {
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero), me = GetCurrentThreadId();
    AttachThreadInput(me, fgThread, true);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    ShowWindow(h, 9); BringWindowToTop(h); SetForegroundWindow(h);
    AttachThreadInput(me, fgThread, false);
    return GetForegroundWindow() == h;
  }
}
"@
$h = (Get-Process -Id $ProcessId).MainWindowHandle
$ok = $false
for ($i = 0; $i -lt 5 -and -not $ok; $i++) { $ok = [Win]::Focus($h); Start-Sleep -Milliseconds 400 }
Start-Sleep -Milliseconds 1200
if (-not $ok -or [Win]::GetForegroundWindow() -ne $h) { Write-Output "ABANDON: la fenetre du jeu n'est pas au premier plan, pas de capture."; exit 2 }
$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Out)
"$w x $hh"
