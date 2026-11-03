Add-Type -AssemblyName System.Drawing

$csharp = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class ImageBlender
{
    public static void FeatherLeftEdge(Bitmap bmp, int featherWidth)
    {
        BitmapData data = bmp.LockBits(
            new Rectangle(0, 0, bmp.Width, bmp.Height),
            ImageLockMode.ReadWrite,
            PixelFormat.Format32bppArgb
        );

        int stride = data.Stride;
        IntPtr scan0 = data.Scan0;

        for (int y = 0; y < bmp.Height; y++)
        {
            byte[] row = new byte[stride];
            Marshal.Copy(scan0 + y * stride, row, 0, stride);

            for (int x = 0; x < featherWidth && x < bmp.Width; x++)
            {
                float t = (float)x / (float)featherWidth;
                float smooth = t * t * (3f - 2f * t);
                int alphaIndex = x * 4 + 3;
                row[alphaIndex] = (byte)(row[alphaIndex] * smooth);
            }

            Marshal.Copy(row, 0, scan0 + y * stride, stride);
        }

        bmp.UnlockBits(data);
    }
}
"@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies System.Drawing

$delaPath = "C:\Users\owusu\Desktop\DracoWorld\assets\DELA.jpeg"
$todPath  = "C:\Users\owusu\Desktop\DracoWorld\assets\TOD.jpeg"

$dela = [System.Drawing.Image]::FromFile($delaPath)
$tod  = [System.Drawing.Image]::FromFile($todPath)

$width = 2000
$height = 910
$bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# 1. Base dark warm fill
$baseBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 14, 13, 12))
$g.FillRectangle($baseBrush, 0, 0, $width, $height)
$baseBrush.Dispose()

# 2. Draw Dela
# In DELA.jpeg (498x1080), Dela's face is illuminated with sunlight.
# We crop Dela from y=100 to y=660 (height 560).
$delaCropY = 95
$delaCropH = 570
$delaDestW = 1260
$delaDestH = [int]($delaDestW * ($delaCropH / 498))
$delaDestX = 130
$delaDestY = -15

# Fill the far left background with the left slice of Dela's brick/foliage
$delaLeftDest = New-Object System.Drawing.Rectangle(-160, -15, 460, $delaDestH)
$delaLeftSrc  = New-Object System.Drawing.Rectangle(0, $delaCropY, 160, $delaCropH)
$g.DrawImage($dela, $delaLeftDest, $delaLeftSrc, [System.Drawing.GraphicsUnit]::Pixel)

$delaDest = New-Object System.Drawing.Rectangle($delaDestX, $delaDestY, $delaDestW, $delaDestH)
$delaSrc  = New-Object System.Drawing.Rectangle(0, $delaCropY, 498, $delaCropH)
$g.DrawImage($dela, $delaDest, $delaSrc, [System.Drawing.GraphicsUnit]::Pixel)

# 3. Prepare Tod
# Tod source: 810x1080.
$todCropY = 90
$todCropH = 640
$todBmpW = 1260
$todBmpH = $height + 40
$todBmp = New-Object System.Drawing.Bitmap($todBmpW, $todBmpH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gTod = [System.Drawing.Graphics]::FromImage($todBmp)
$gTod.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gTod.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

$todSrc = New-Object System.Drawing.Rectangle(40, $todCropY, 770, $todCropH)
$todDest = New-Object System.Drawing.Rectangle(0, 0, $todBmpW, $todBmpH)
$gTod.DrawImage($tod, $todDest, $todSrc, [System.Drawing.GraphicsUnit]::Pixel)
$gTod.Dispose()

# Feather Tod's left edge (first 460px smooth fade)
[ImageBlender]::FeatherLeftEdge($todBmp, 460)

# Draw Tod over Dela at x=830 so they overlap naturally
$g.DrawImage($todBmp, 830, -10)
$todBmp.Dispose()

# 4. Light Vignette on the far left edge ONLY (x=0 to x=680)
# Dela's face starts around x=760 so his face remains 100% untouched and bright!
$darkRect = New-Object System.Drawing.Rectangle(0, 0, 700, $height)
$darkBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $darkRect,
    [System.Drawing.Color]::FromArgb(210, 12, 12, 12),
    [System.Drawing.Color]::FromArgb(0, 12, 12, 12),
    [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal
)
$g.FillRectangle($darkBrush, $darkRect)
$darkBrush.Dispose()

# 5. Top subtle vignette
$topRect = New-Object System.Drawing.Rectangle(0, 0, $width, 120)
$topBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $topRect,
    [System.Drawing.Color]::FromArgb(60, 0, 0, 0),
    [System.Drawing.Color]::FromArgb(0, 0, 0, 0),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$g.FillRectangle($topBrush, $topRect)
$topBrush.Dispose()

# 6. Bottom subtle vignette
$botH = 110
$botY = [int]($height - $botH)
$botRect = New-Object System.Drawing.Rectangle(0, $botY, $width, $botH)
$botBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $botRect,
    [System.Drawing.Color]::FromArgb(0, 0, 0, 0),
    [System.Drawing.Color]::FromArgb(90, 0, 0, 0),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$g.FillRectangle($botBrush, $botRect)
$botBrush.Dispose()

# Save final JPEG
$outputPath = "C:\Users\owusu\Desktop\DracoWorld\assets\hero-campaign-banner.jpg"
$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]96)

$bmp.Save($outputPath, $encoder, $encoderParams)

$encoderParams.Dispose()
$g.Dispose()
$bmp.Dispose()
$dela.Dispose()
$tod.Dispose()

Write-Host "Vibrant hero-campaign-banner.jpg generated successfully"
