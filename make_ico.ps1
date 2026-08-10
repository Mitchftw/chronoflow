Add-Type -AssemblyName System.Drawing
$pngPath = "d:\Projects\new-todo-tracker\build\icon.png"
$icoPath = "d:\Projects\new-todo-tracker\build\icon.ico"

Write-Host "Loading transparent PNG..."
$bmp = [System.Drawing.Bitmap]::FromFile($pngPath)

Write-Host "Resizing image to 256x256..."
$resized = New-Object System.Drawing.Bitmap (256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($resized)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($bmp, 0, 0, 256, 256)
$g.Dispose()
$bmp.Dispose()

$tempPng = "d:\Projects\new-todo-tracker\build\icon_temp.png"
$resized.Save($tempPng, [System.Drawing.Imaging.ImageFormat]::Png)
$resized.Dispose()

Write-Host "Reading resized PNG bytes..."
$pngBytes = [System.IO.File]::ReadAllBytes($tempPng)
$pngSize = $pngBytes.Length

# ICO header (6 bytes)
# Reserved (2 bytes) = 0, Type (2 bytes) = 1, Count (2 bytes) = 1
$icoHeader = [byte[]]@(0, 0, 1, 0, 1, 0)

# Directory Entry (16 bytes)
$dirEntry = New-Object byte[] 16
$dirEntry[0] = 0 # width 256 -> 0
$dirEntry[1] = 0 # height 256 -> 0
$dirEntry[2] = 0
$dirEntry[3] = 0
$dirEntry[4] = 1 # planes low
$dirEntry[5] = 0 # planes high
$dirEntry[6] = 32 # bitcount low (32-bit ARGB)
$dirEntry[7] = 0 # bitcount high

$sizeBytes = [System.BitConverter]::GetBytes([int]$pngSize)
$dirEntry[8] = $sizeBytes[0]
$dirEntry[9] = $sizeBytes[1]
$dirEntry[10] = $sizeBytes[2]
$dirEntry[11] = $sizeBytes[3]

$offsetBytes = [System.BitConverter]::GetBytes([int]22)
$dirEntry[12] = $offsetBytes[0]
$dirEntry[13] = $offsetBytes[1]
$dirEntry[14] = $offsetBytes[2]
$dirEntry[15] = $offsetBytes[3]

Write-Host "Writing ICO file..."
$fileStream = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$fileStream.Write($icoHeader, 0, $icoHeader.Length)
$fileStream.Write($dirEntry, 0, $dirEntry.Length)
$fileStream.Write($pngBytes, 0, $pngBytes.Length)
$fileStream.Close()

Write-Host "Replacing original icon.png with 256x256 version..."
if (Test-Path $pngPath) {
    Remove-Item $pngPath -Force
}
Move-Item $tempPng $pngPath

Write-Host "Successfully generated icon.ico and 256x256 icon.png!"
