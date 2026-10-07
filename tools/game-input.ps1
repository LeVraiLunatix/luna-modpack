# Envoie des commandes de chat et des touches a la fenetre du jeu de test (outil de la seance panorama).
#   -Commands "/time set 13000","/weather clear"  : tapees dans le chat une par une
#   -Keys "F1","CTRL+F2","ESCAPE"                 : touches simples ou combinees avec CTRL/SHIFT
# SECURITE : avant CHAQUE frappe, on verifie que la fenetre au premier plan est bien celle du jeu.
# Sinon (Windows a refuse le premier plan, l'utilisateur a clique ailleurs...), on s'arrete net :
# les frappes partiraient dans une autre application.
param([int]$ProcessId, [string[]]$Commands = @(), [string[]]$Keys = @(), [int]$DelayMs = 400)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class GameInput {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$vk = @{ K = 0x4B; F1 = 0x70; F2 = 0x71; F3 = 0x72; ESCAPE = 0x1B; ENTER = 0x0D; T = 0x54; CTRL = 0x11; SHIFT = 0x10 }
$h = (Get-Process -Id $ProcessId).MainWindowHandle

function Assert-GameFocused {
  if ([GameInput]::GetForegroundWindow() -ne $h) {
    # Relache les modificateurs au cas ou, puis abandon.
    foreach ($m in 0x11, 0x10, 0x12) { [GameInput]::keybd_event([byte]$m, 0, 2, [UIntPtr]::Zero) }
    Write-Output "ABANDON: le jeu n'est pas au premier plan, aucune autre frappe envoyee."
    exit 2
  }
}
function Tap([byte]$code) {
  Assert-GameFocused
  [GameInput]::keybd_event($code, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
  [GameInput]::keybd_event($code, 0, 2, [UIntPtr]::Zero)
}

[GameInput]::ShowWindow($h, 9) | Out-Null
[GameInput]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[GameInput]::SetForegroundWindow($h) | Out-Null
[GameInput]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 800
Assert-GameFocused

foreach ($cmd in $Commands) {
  Tap $vk.T
  Start-Sleep -Milliseconds 400
  # Caractere par caractere, avec verification du premier plan a chaque fois.
  foreach ($ch in $cmd.ToCharArray()) {
    Assert-GameFocused
    $s = [string]$ch
    if ('+^%~(){}[]'.Contains($s)) { $s = "{$s}" }
    [System.Windows.Forms.SendKeys]::SendWait($s)
  }
  Start-Sleep -Milliseconds 150
  Tap $vk.ENTER
  Start-Sleep -Milliseconds $DelayMs
}

foreach ($key in $Keys) {
  $parts = $key.ToUpper().Split('+')
  $mods = $parts[0..($parts.Length - 2)] | Where-Object { $_ }
  $main = $parts[-1]
  Assert-GameFocused
  foreach ($m in $mods) { [GameInput]::keybd_event([byte]$vk[$m], 0, 0, [UIntPtr]::Zero) }
  Tap ([byte]$vk[$main])
  foreach ($m in $mods) { [GameInput]::keybd_event([byte]$vk[$m], 0, 2, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds $DelayMs
}
Write-Output "OK"
