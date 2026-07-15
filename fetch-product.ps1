# DuGuud Product Fetcher — Multi-retailer
# Usage: .\fetch-product.ps1 "https://www.adidas.com.ph/grand-court-base-2.0-shoes/JH8611.html"
#        .\fetch-product.ps1 "https://superbalist.com/men/shoes/sneakers/..."
#        .\fetch-product.ps1 "https://www.edgars.co.za/products/..."
#        .\fetch-product.ps1 "https://mixsport.vn/products/jh8611"
# No CORS issues — runs locally. Downloads all images to .\images\

param([string]$Url)

if(-not $Url){ Write-Host "Usage: .\fetch-product.ps1 '<product-url>'" -ForegroundColor Yellow; exit 1 }

# --- Detect retailer ---
$retailer = "generic"
$baseUrl = ""
if($Url -match 'adidas\.'){ $retailer = "adidas"; $baseUrl = $matches[0] -replace '/$','' }
elseif($Url -match 'superbalist\.com'){ $retailer = "superbalist"; $baseUrl = "https://superbalist.com" }
elseif($Url -match 'edgars\.co\.za'){ $retailer = "edgars"; $baseUrl = "https://www.edgars.co.za" }
elseif($Url -match 'mixsport\.vn'){ $retailer = "mixsport"; $baseUrl = "https://mixsport.vn" }
elseif($Url -match 'trappers\.co\.za'){ $retailer = "trappers"; $baseUrl = "https://www.trappers.co.za" }
elseif($Url -match 'cdn\.shopify\.com|myshopify\.com'){ $retailer = "shopify"; $baseUrl = ($Url -replace '^(https?://[^/]+).*','$1') }

Write-Host "Retailer: $retailer" -ForegroundColor DarkGray
Write-Host "Fetching page..." -ForegroundColor Cyan

try {
  $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30 -Headers @{
    'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
} catch {
  Write-Host "Failed to fetch URL: $_" -ForegroundColor Red
  exit 1
}
$html = $resp.Content

# ===== PARSE JSON-LD =====
$name = $brand = $price = $desc = ""
$jsonImages = @()
$ldMatches = [regex]::Matches($html, '<script type="application/ld\+json"[^>]*>([\s\S]*?)</script>')
foreach($m in $ldMatches){
  try{
    $json = $m.Groups[1].Value | ConvertFrom-Json
    $prod = if($json.'@type' -eq 'Product'){$json}else{($json.'@graph'|Where-Object{$_.'@type'-eq'Product'})}
    if($prod){
      if($prod.name){$name = $prod.name}
      if($prod.brand){
        if($prod.brand.name){$brand = $prod.brand.name}
        elseif($prod.brand -is [string]){$brand = $prod.brand}
      }
      if($prod.description -and $prod.description -is [string]){$desc = $prod.description}
      if($prod.offers){
        $offer = if($prod.offers -is [array]){$prod.offers[0]}else{$prod.offers}
        if($offer.price){$price = $offer.price}
      }
      # JSON-LD images
      if($prod.image){
        $jimgs = if($prod.image -is [array]){$prod.image}else{@($prod.image)}
        foreach($img in $jimgs){
          if($img -is [string]){$jsonImages += $img}
          elseif($img.url){$jsonImages += $img.url}
          elseif($img.contentUrl){$jsonImages += $img.contentUrl}
        }
      }
    }
  }catch{}
}

# ===== FALLBACKS =====
if(-not $name){
  if($html -match '<meta\s+property="og:title"\s+content="([^"]+)"'){ $name = $matches[1].Trim() }
  if(-not $name -and $html -match '<title[^>]*>([^<]+)</title>'){
    $name = $matches[1] -replace '\s*[–|-|]\s*(Edgars|Superbalist|adidas|Mixsport)\s*$','' -replace '&amp;','&'
  }
}
# Clean up boilerplate descriptions
if($desc -match '^(Shop online at|We have great deals|Free Delivery|Shop the latest|Buy .+ online at|Mua .+ online)'){ $desc = "" }
if(-not $desc){
  if($html -match '<meta\s+property="og:description"\s+content="([^"]+)"'){ $desc = $matches[1].Trim() }
  if(-not $desc -and $html -match '<meta\s+name="description"\s+content="([^"]+)"'){ $desc = $matches[1].Trim() }
}

# ===== IMAGE EXTRACTION =====
$imgUrls = [System.Collections.ArrayList]::new()
$seen = @{}

function Add-ImageUrl($u){
  if(-not $u -or $u -eq ''){ return }
  # Resolve protocol-relative
  if($u.StartsWith("//")){ $u = "https:$u" }
  # Resolve relative
  if(-not $u.StartsWith("http")){
    if($u.StartsWith("/")){ $u = $baseUrl + $u }
    else{ $u = $baseUrl + "/" + $u }
  }
  # Strip query for dedup key
  $key = ($u -replace '\?.*$','') -replace '_[0-9]+x[0-9]+','_WxH'
  if(-not $seen.ContainsKey($key)){
    $seen[$key] = $true
    [void]$imgUrls.Add($u)
  }
}

# 1. JSON-LD images first (usually best quality)
foreach($u in $jsonImages){ Add-ImageUrl $u }

# 2. og:image
$ogImgs = [regex]::Matches($html, '<meta\s+property="og:image"\s+content="([^"]+)"')
foreach($m in $ogImgs){ Add-ImageUrl $m.Groups[1].Value }

# 3. Retailer-specific patterns
switch($retailer){
  "adidas" {
    # Adidas CDN images — find all assets.adidas.com URLs
    $adidasMatches = [regex]::Matches($html, 'https?://assets\.adidas\.com/images/[^"''\s<>]+')
    foreach($m in $adidasMatches){
      $u = $m.Value
      # Upgrade to full resolution
      $u = $u -replace '/w_\d+,','/w_1800,' -replace '/h_\d+,','/h_1800,' -replace '/c_scale,','/c_fill,'
      Add-ImageUrl $u
    }
    # Also try srcset
    $srcsetMatches = [regex]::Matches($html, 'srcset="([^"]+)"')
    foreach($m in $srcsetMatches){
      $m.Groups[1].Value -split ',' | ForEach-Object {
        $part = ($_ -split '\s+')[0].Trim()
        if($part -match 'assets\.adidas\.com'){ Add-ImageUrl $part }
      }
    }
  }
  "superbalist" {
    # Superbalist images in product gallery data
    $galleryMatches = [regex]::Matches($html, '"full_size_url"\s*:\s*"([^"]+)"')
    foreach($m in $galleryMatches){ Add-ImageUrl $m.Groups[1].Value }
    # Also look for srcset
    $srcsetMatches = [regex]::Matches($html, 'srcset="([^"]+)"')
    foreach($m in $srcsetMatches){
      $m.Groups[1].Value -split ',' | ForEach-Object {
        $part = ($_ -split '\s+')[0].Trim()
        if($part -match '\.(jpg|jpeg|png|webp)'){ Add-ImageUrl $part }
      }
    }
  }
  "edgars" {
    $edMatches = [regex]::Matches($html, '(?:src|href|content)=["'']([^"'']*?(_1800x1800|_1024x1024|_grande|_master)\.(?:jpg|jpeg|png|webp)[^"'']*)')
    foreach($m in $edMatches){ Add-ImageUrl $m.Groups[1].Value }
  }
  "mixsport" {
    # Mixsport/Vietnamese retailers — often use simple img tags or srcset
    $srcsetMatches = [regex]::Matches($html, 'srcset="([^"]+)"')
    foreach($m in $srcsetMatches){
      $m.Groups[1].Value -split ',' | ForEach-Object {
        $part = ($_ -split '\s+')[0].Trim()
        if($part -match '\.(jpg|jpeg|png|webp)'){ Add-ImageUrl $part }
      }
    }
    # data-src or data-original for lazy-loaded images
    $dataMatches = [regex]::Matches($html, '(?:data-src|data-original|data-large)=["'']([^"'']+\.(?:jpg|jpeg|png|webp)[^"'']*)')
    foreach($m in $dataMatches){ Add-ImageUrl $m.Groups[1].Value }
  }
  {$_ -in @("trappers","shopify")} {
    # Shopify-based retailers: images on cdn.shopify.com
    $shopifyMatches = [regex]::Matches($html, 'https?://cdn\.shopify\.com/[^"''\s<>]+')
    foreach($m in $shopifyMatches){
      $u = $m.Value -replace '[?&]_ccl_[^&]*','' -replace '[?&]v=\d+','' -replace '&width=\d+',''
      if($u -match '\.(jpg|jpeg|png|webp)' -or $u -match 'shopify'){
        Add-ImageUrl $u
      }
    }
    # Lazy-loaded images with data-src (common in Shopify themes)
    $lazyMatches = [regex]::Matches($html, '<img[^>]+(?:data-src|data-original)=["'']([^"'']+)["''][^>]*>')
    foreach($m in $lazyMatches){
      $u = $m.Groups[1].Value
      if($u -match '\.(jpg|jpeg|png|webp)' -or $u -match 'shopify'){
        Add-ImageUrl $u
      }
    }
    # srcset (often has multiple resolutions)
    $srcsetMatches = [regex]::Matches($html, 'srcset="([^"]+)"')
    foreach($m in $srcsetMatches){
      $m.Groups[1].Value -split ',' | ForEach-Object {
        $part = ($_ -split '\s+')[0].Trim()
        if($part -match '\.(jpg|jpeg|png|webp)' -or $part -match 'shopify'){
          Add-ImageUrl $part
        }
      }
    }
  }
}

# 4. Generic: any high-quality looking image URLs in the page
if($imgUrls.Count -lt 2){
  $genMatches = [regex]::Matches($html, '(?:src|content)=["''](https?://[^"'']+\.(?:jpg|jpeg|png|webp)\?[^"'']*(?:w=\d{3,4}|q=\d+|width=\d{3,})[^"'']*)')
  foreach($m in $genMatches){ Add-ImageUrl $m.Groups[1].Value }
}

# 5. Lazy-loaded images: data-src, data-original (increasingly common)
if($imgUrls.Count -lt 3){
  $lazyMatches = [regex]::Matches($html, '<img[^>]+(?:data-src|data-original)=["'']([^"'']+)["''][^>]*>')
  foreach($m in $lazyMatches){
    $src = $m.Groups[1].Value
    if($src -match '\.(jpg|jpeg|png|webp|heic|heif)' -and $src -notmatch 'logo|icon|avatar|banner|pixel|track|placeholder'){
      Add-ImageUrl $src
    }
  }
}

# 6. Last resort: any img tag with product-looking src
if($imgUrls.Count -lt 2){
  $imgTagMatches = [regex]::Matches($html, '<img[^>]+(?:src|data-src)=["'']([^"'']+)["''][^>]*>')
  foreach($m in $imgTagMatches){
    $src = $m.Groups[1].Value
    if($src -match '\.(jpg|jpeg|png|webp)' -and $src -notmatch 'logo|icon|avatar|banner|pixel|track|placeholder'){
      Add-ImageUrl $src
    }
  }
}

# ===== DOWNLOAD IMAGES =====
$prodid = -join ((65..90)+(97..122)+(48..57) | Get-Random -Count 8 | ForEach-Object{[char]$_})
$imgDir = Join-Path $PSScriptRoot "images"
if(-not (Test-Path $imgDir)){ New-Item -ItemType Directory -Path $imgDir -Force | Out-Null }

Write-Host "`nProduct: $name" -ForegroundColor Green
if($brand){ Write-Host "Brand:   $brand" -ForegroundColor Green }
if($price){ Write-Host "Price:   R $price" -ForegroundColor Green }
Write-Host "Images:  $($imgUrls.Count) found" -ForegroundColor Green
Write-Host "`nDownloading to .\images\ ..." -ForegroundColor Cyan

$images = @()
$i = 1
foreach($u in $imgUrls){
  $ext = [System.IO.Path]::GetExtension(($u -replace '\?.*',''))
  if(-not $ext -or $ext.Length -gt 5){ $ext = ".jpg" }
  $fname = "${prodid}-${i}${ext}"
  $outPath = Join-Path $imgDir $fname
  try{
    Invoke-WebRequest -Uri $u -OutFile $outPath -UseBasicParsing -TimeoutSec 20 -Headers @{
      'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    $size = (Get-Item $outPath).Length
    if($size -gt 500){
      Write-Host "  $fname ($([math]::Round($size/1KB)) KB)" -ForegroundColor Gray
      $images += "images/$fname"
      $i++
    } else {
      Remove-Item $outPath -Force
      Write-Host "  SKIP: $fname (too small — likely placeholder)" -ForegroundColor DarkGray
    }
  }catch{
    Write-Host "  FAILED: $fname — $_" -ForegroundColor Red
  }
}

# ===== OUTPUT JSON =====
$product = [ordered]@{
  id = "p$(Get-Date -UFormat '%y%m%d%H%M%S')"
  name = $name
  cat = 'men'
  icon = 'tee'
  tag = 'Tops'
  subtag = 'Summer'
  images = $images
  price = if($price){[math]::Round([double]($price -replace '[^0-9.]',''))}else{0}
  sizes = @('One Size')
  sizeStock = @{'One Size' = 1}
  stock = 1
}
if($desc -and $desc.Length -gt 10){ $product.desc = $desc.Substring(0, [Math]::Min(250, $desc.Length)) }

Write-Host "`n=== PRODUCT JSON (copy into admin) ===" -ForegroundColor Yellow
$product | ConvertTo-Json -Depth 4
Write-Host "`nDone! $($images.Count) image(s) downloaded to .\images\" -ForegroundColor Green
Write-Host "Add this JSON to your admin page, or open admin.html and paste the values manually." -ForegroundColor DarkGray
