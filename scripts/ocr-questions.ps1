param(
  [string]$QuestionsDir = "public\questions",
  [string]$OutputPath = "data\ocr-results.json"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]

function Await-WinRT($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage(
  [Windows.Globalization.Language]::new("ja-JP")
)
if (-not $engine) {
  throw "Windows Japanese OCR is unavailable. Check the Japanese language pack."
}

$root = (Resolve-Path -LiteralPath ".").Path
$questionRoot = (Resolve-Path -LiteralPath $QuestionsDir).Path
$items = [System.Collections.Generic.List[object]]::new()

Get-ChildItem -LiteralPath $questionRoot -Filter "question-*.png" -File |
  Sort-Object Name |
  ForEach-Object {
    $match = [regex]::Match($_.BaseName, "question-(\d+)")
    if (-not $match.Success) { return }

    $stream = $null
    try {
      $file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($_.FullName)) ([Windows.Storage.StorageFile])
      $stream = Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $result = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $items.Add([ordered]@{
        id = [int]$match.Groups[1].Value
        text = [string]$result.Text
      })
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  }

$absoluteOutput = Join-Path $root $OutputPath
$outputDirectory = Split-Path -Parent $absoluteOutput
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$json = $items | ConvertTo-Json -Depth 4
$temporary = "$absoluteOutput.$PID.tmp"
[System.IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

for ($attempt = 1; $attempt -le 8; $attempt += 1) {
  try {
    Move-Item -LiteralPath $temporary -Destination $absoluteOutput -Force
    break
  } catch {
    if ($attempt -eq 8) { throw }
    Start-Sleep -Milliseconds (150 * $attempt)
  }
}

Write-Output ("OCR complete: {0}" -f $items.Count)
