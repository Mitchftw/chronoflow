Add-Type -AssemblyName System.Drawing
$imagePath = "C:\Users\mitchell\.gemini\antigravity\brain\fc52de9c-d254-47b3-ab1d-8bd395fec010\chronoflow_logo_1779348325617.png"
$outputPath = "d:\Projects\new-todo-tracker\build\icon.png"

# Ensure build directory exists
if (-not (Test-Path "d:\Projects\new-todo-tracker\build")) {
    New-Item -ItemType Directory -Force -Path "d:\Projects\new-todo-tracker\build" | Out-Null
}

Write-Host "Loading image from $imagePath ..."
$bmp = [System.Drawing.Bitmap]::FromFile($imagePath)
$width = $bmp.Width
$height = $bmp.Height
Write-Host "Image size: $width x $height"

# We will copy the bitmap to a new ARGB bitmap to support transparency properly
$newBmp = New-Object System.Drawing.Bitmap ($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($newBmp)
$g.DrawImage($bmp, 0, 0, $width, $height)
$g.Dispose()
$bmp.Dispose()

# Threshold for "black background" (RGB sum <= 40)
$threshold = 40

Write-Host "Running threshold transparency processing..."
$count = 0
for ($x = 0; $x -lt $width; $x++) {
    for ($y = 0; $y -lt $height; $y++) {
        $pixel = $newBmp.GetPixel($x, $y)
        $colorSum = $pixel.R + $pixel.G + $pixel.B
        if ($colorSum -le $threshold) {
            # Make completely transparent
            $newBmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
            $count++
        }
    }
}

Write-Host "Made $count pixels transparent."
$newBmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$newBmp.Dispose()
Write-Host "Transparent PNG successfully saved to $outputPath"
