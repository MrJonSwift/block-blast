param(
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\icons')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$output = [System.IO.Path]::GetFullPath($OutputDir)
if (-not (Test-Path -LiteralPath $output)) {
  New-Item -ItemType Directory -Path $output | Out-Null
}

function New-GradientBrush([System.Drawing.Drawing2D.LinearGradientBrush]$from, [System.Drawing.PointF]$p1, [System.Drawing.PointF]$p2, [System.Drawing.Color]$c1, [System.Drawing.Color]$c2) {
  $b = New-Object System.Drawing.Drawing2D.LinearGradientBrush($p1, $p2, $c1, $c2)
  return $b
}

function New-RoundedRect($graphics, $brush, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  if ($r -le 0) {
    $graphics.FillRectangle($brush, $x, $y, $w, $h)
    return
  }
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $graphics.FillPath($brush, $path)
  $path.Dispose()
}

function New-Icon([int]$size, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $bg1 = [System.Drawing.Color]::FromArgb(255, 43, 47, 69)
  $bg2 = [System.Drawing.Color]::FromArgb(255, 20, 22, 31)
  $bgBrush = New-GradientBrush $null ([System.Drawing.PointF]::new(0, 0)) ([System.Drawing.PointF]::new($size, $size)) $bg1 $bg2
  $radius = if ($maskable) { 0 } else { $size * 0.22 }
  New-RoundedRect $g $bgBrush 0 0 $size $size $radius
  $bgBrush.Dispose()

  # Maskable icons are cropped to a circle, so keep art inside the safe zone.
  $inset = if ($maskable) { $size * 0.22 } else { $size * 0.16 }
  $art = $size - (2 * $inset)
  $rows = 3
  $cols = 2
  $unit = $art / $rows
  $gap = $unit * 0.16
  $block = $unit - $gap
  $radiusBlock = $block * 0.26

  # Centre the block group in the icon rather than in the padded art box.
  $groupWidth = [single](($cols * $block) + (($cols - 1) * $gap))
  $groupHeight = [single](($rows * $block) + (($rows - 1) * $gap))
  $originX = [single](($size - $groupWidth) / 2)
  $originY = [single](($size - $groupHeight) / 2)

  $blocks = @(
    @{ c = [System.Drawing.Color]::FromArgb(255, 255, 95, 109);  cx = 0; cy = 0 },
    @{ c = [System.Drawing.Color]::FromArgb(255, 255, 217, 61);  cx = 1; cy = 0 },
    @{ c = [System.Drawing.Color]::FromArgb(255, 78, 205, 196);  cx = 0; cy = 1 },
    @{ c = [System.Drawing.Color]::FromArgb(255, 90, 169, 255);  cx = 1; cy = 1 },
    @{ c = [System.Drawing.Color]::FromArgb(255, 155, 123, 255); cx = 0; cy = 2; w = 2 }
  )

  foreach ($b in $blocks) {
    $columns = if ($b.ContainsKey('w')) { $b.w } else { 1 }
    $bx = [single]($originX + ($b.cx * ($block + $gap)))
    $by = [single]($originY + ($b.cy * ($block + $gap)))
    $bw = [single]($columns * $block + ($columns - 1) * $gap)
    $brush = New-Object System.Drawing.SolidBrush($b.c)

    $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(46, 0, 0, 0))
    New-RoundedRect $g $shadowBrush $bx ([single]($by + $block * 0.14)) $bw $block $radiusBlock
    $shadowBrush.Dispose()

    New-RoundedRect $g $brush $bx $by $bw $block $radiusBlock
    $brush.Dispose()

    $gloss = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(74, 255, 255, 255))
    New-RoundedRect $g $gloss `
      ([single]($bx + $block * 0.16)) ([single]($by + $block * 0.14)) `
      ([single]($bw - $block * 0.32)) ([single]($block * 0.3)) ([single]($radiusBlock * 0.8))
    $gloss.Dispose()
  }

  $g.Dispose()
  return $bmp
}

function Save-Icon($bitmap, [string]$name) {
  $path = Join-Path $output $name
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  Write-Host "wrote $path"
}

Save-Icon (New-Icon 180 $false) 'icon-180.png'
Save-Icon (New-Icon 192 $false) 'icon-192.png'
Save-Icon (New-Icon 512 $false) 'icon-512.png'
Save-Icon (New-Icon 512 $true) 'icon-maskable-512.png'
