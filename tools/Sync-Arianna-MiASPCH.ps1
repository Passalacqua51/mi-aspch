param(
  [switch]$Install,
  [switch]$Run,
  [string]$FilePath,
  [string]$ServerUrl,
  [string]$UploadToken
)

$ErrorActionPreference = 'Stop'
$BaseDir = Join-Path $env:LOCALAPPDATA 'MiASPCH-FinancialSync'
$ConfigPath = Join-Path $BaseDir 'config.json'
$StatePath = Join-Path $BaseDir 'state.json'
$LogPath = Join-Path $BaseDir 'sync.log'
$InstalledScript = Join-Path $BaseDir 'Sync-Arianna-MiASPCH.ps1'
$TaskName = 'Mi ASPCH - Sincronizar BASE DE DATOS'

function Log([string]$Text) {
  New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Text"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Save-Config([string]$Path,[string]$Url,[string]$Token) {
  $cfg = [ordered]@{ filePath=$Path; serverUrl=$Url.TrimEnd('/'); uploadToken=$Token; intervalMinutes=5 }
  $cfg | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  try { & icacls $ConfigPath /inheritance:r /grant:r "$env:USERNAME:(R,W)" | Out-Null } catch {}
}

function Select-Xlsm {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = 'Selecciona BASE DE DATOS.xlsm de Arianna'
  $dlg.Filter = 'Excel con macros (*.xlsm)|*.xlsm'
  $dlg.FileName = 'BASE DE DATOS.xlsm'
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'No se seleccionó el archivo.' }
  return $dlg.FileName
}

if ($Install) {
  New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
  if (-not $FilePath) { $FilePath = Select-Xlsm }
  if (-not (Test-Path -LiteralPath $FilePath)) { throw "No existe: $FilePath" }
  if (-not $ServerUrl) { $ServerUrl = Read-Host 'URL HTTPS de Mi ASPCH (ej. https://app.aspch.org)' }
  if (-not $UploadToken) { $UploadToken = Read-Host 'Token FINANCIAL_UPLOAD_TOKEN del Homelab' }
  if (-not $ServerUrl.StartsWith('https://')) { throw 'Usa una URL HTTPS de Mi ASPCH.' }
  if ([string]::IsNullOrWhiteSpace($UploadToken)) { throw 'Falta el token de sincronización.' }
  Copy-Item -LiteralPath $PSCommandPath -Destination $InstalledScript -Force
  Save-Config $FilePath $ServerUrl $UploadToken
  $powershell = (Get-Command powershell.exe).Source
  $action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$InstalledScript`" -Run"
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Sube BASE DE DATOS.xlsm a Mi ASPCH solo cuando cambia después de guardarlo.' -Force | Out-Null
  Log "Instalado. Archivo: $FilePath"
  Log "Servidor: $($ServerUrl.TrimEnd('/'))"
  Write-Host "`nListo. La tarea se ejecuta cada 5 minutos. Log: $LogPath" -ForegroundColor Green
  exit 0
}

if (-not $Run) { Write-Host 'Usa -Install para configurar o -Run para ejecutar la sincronización.'; exit 0 }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'No existe configuración. Ejecuta primero con -Install.' }
$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$path = [string]$cfg.filePath
if (-not (Test-Path -LiteralPath $path)) { Log "SKIP: no existe $path"; exit 0 }

# No subir mientras el archivo esté en un estado inestable. Espera 4 s y exige que tamaño/mtime no cambien.
$a = Get-Item -LiteralPath $path
Start-Sleep -Seconds 4
$b = Get-Item -LiteralPath $path
if ($a.Length -ne $b.Length -or $a.LastWriteTimeUtc -ne $b.LastWriteTimeUtc) { Log 'SKIP: el archivo aún está cambiando/guardándose.'; exit 0 }
if ($b.Length -lt 1000) { Log 'ERROR: archivo demasiado pequeño.'; exit 1 }

$hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
$lastHash = $null
if (Test-Path -LiteralPath $StatePath) {
  try { $lastHash = (Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json).sha256 } catch {}
}
if ($lastHash -eq $hash) { Log 'Sin cambios; no se sube.'; exit 0 }

$uri = "$($cfg.serverUrl.TrimEnd('/'))/api/financial-source/upload"
$headers = @{ 'X-Mi-Aspch-Financial-Token' = [string]$cfg.uploadToken }
try {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $result = Invoke-RestMethod -Uri $uri -Method Put -Headers $headers -ContentType 'application/vnd.ms-excel.sheet.macroEnabled.12' -Body $bytes -TimeoutSec 120
  if (-not $result.ok) { throw 'El servidor no confirmó la sincronización.' }
  [ordered]@{sha256=$hash; lastWriteTimeUtc=$b.LastWriteTimeUtc.ToString('o'); uploadedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
  Log "OK: XLSM actualizado en Mi ASPCH. SHA256 $($hash.Substring(0,12))…"
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
