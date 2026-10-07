# Envoie des commandes de chat et des touches à la fenêtre du jeu de test (outil de la séance panorama).
#   -Commands "/time set 13000","/weather clear"  : tapées dans le chat une par une
#   -Keys "F1","CTRL+F2","ESCAPE"                 : touches simples ou combinées avec CTRL/SHIFT
param([int]$ProcessId, [string[]]$Commands = @(), [string[]]$Keys = @(), [int]$DelayMs = 400)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class GameInput {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Tap(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
$vk = @{ F1 = 0x70; F2 = 0x71; F3 = 0x72; ESCAPE = 0x1B; ENTER = 0x0D; T = 0x54; CTRL = 0x11; SHIFT = 0x10; SLASH = 0xBF }
$h = (Get-Process -Id $ProcessId).MainWindowHandle
[GameInput]::ShowWindow($h, 9) | Out-Null
[GameInput]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[GameInput]::SetForegroundWindow($h) | Out-Null
[GameInput]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 800

foreach ($cmd in $Commands) {
  [GameInput]::Tap($vk.T)
  Start-Sleep -Milliseconds 350
  # SendKeys interprète + ^ % ~ ( ) { } [ ] : on les échappe
  $escaped = ($cmd -replace '([+^%~(){}\[\]])', '{$1}')
  [System.Windows.Forms.SendKeys]::SendWait($escaped)
  Start-Sleep -Milliseconds 150
  [GameInput]::Tap($vk.ENTER)
  Start-Sleep -Milliseconds $DelayMs
}

foreach ($key in $Keys) {
  $parts = $key.ToUpper().Split('+')
  $mods = $parts[0..($parts.Length - 2)] | Where-Object { $_ }
  $main = $parts[-1]
  foreach ($m in $mods) { [GameInput]::keybd_event([byte]$vk[$m], 0, 0, [UIntPtr]::Zero) }
  [GameInput]::Tap([byte]$vk[$main])
  foreach ($m in $mods) { [GameInput]::keybd_event([byte]$vk[$m], 0, 2, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds $DelayMs
}
