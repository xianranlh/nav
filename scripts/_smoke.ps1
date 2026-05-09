$ErrorActionPreference = 'Continue'
'Cleanup...' | Out-File up.log -Encoding utf8
docker compose down 2>&1 | Out-File -Append up.log -Encoding utf8
docker rm -f xianran-nav-test 2>&1 | Out-File -Append up.log -Encoding utf8
# 用一个大概率空闲的端口
$port = 18099
"Running on port $port ..." | Out-File -Append up.log -Encoding utf8
docker run -d --name xianran-nav-test -p "${port}:80" xianran-nav:latest 2>&1 | Out-File -Append up.log -Encoding utf8
Start-Sleep -Seconds 2
try {
  $h = (Invoke-WebRequest -Uri "http://127.0.0.1:${port}/healthz" -UseBasicParsing -TimeoutSec 5).Content
  "healthz: $h" | Out-File -Append up.log -Encoding utf8
} catch { "healthz ERR: $($_.Exception.Message)" | Out-File -Append up.log -Encoding utf8 }
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:${port}/" -UseBasicParsing -TimeoutSec 5
  "index status: $($r.StatusCode)" | Out-File -Append up.log -Encoding utf8
  "index bytes: $($r.Content.Length)" | Out-File -Append up.log -Encoding utf8
  "server: $($r.Headers.Server)" | Out-File -Append up.log -Encoding utf8
  # 验证 HTML 里确实是樱
  if ($r.Content -match '樱 · 个人导航') { '(?) title OK' | Out-File -Append up.log -Encoding utf8 } else { '(!) title MISS' | Out-File -Append up.log -Encoding utf8 }
} catch { "index ERR: $($_.Exception.Message)" | Out-File -Append up.log -Encoding utf8 }
try {
  $r2 = Invoke-WebRequest -Uri "http://127.0.0.1:${port}/sw.js" -UseBasicParsing -TimeoutSec 5
  "sw.js status: $($r2.StatusCode)" | Out-File -Append up.log -Encoding utf8
  "sw-allowed: $($r2.Headers['Service-Worker-Allowed'])" | Out-File -Append up.log -Encoding utf8
  "cache-control: $($r2.Headers['Cache-Control'])" | Out-File -Append up.log -Encoding utf8
} catch { "sw ERR: $($_.Exception.Message)" | Out-File -Append up.log -Encoding utf8 }
try {
  $r3 = Invoke-WebRequest -Uri "http://127.0.0.1:${port}/styles.css" -UseBasicParsing -TimeoutSec 5
  "css status: $($r3.StatusCode)" | Out-File -Append up.log -Encoding utf8
  "css cache-control: $($r3.Headers['Cache-Control'])" | Out-File -Append up.log -Encoding utf8
} catch { "css ERR: $($_.Exception.Message)" | Out-File -Append up.log -Encoding utf8 }
docker rm -f xianran-nav-test 2>&1 | Out-File -Append up.log -Encoding utf8

# === Theme & layout source checks ===
$themeFiles = @('themes/sakura.css','themes/q-anime.css','themes/dark-minimal.css','themes/paper.css')
foreach ($f in $themeFiles) {
  if (-not (Test-Path $f)) { "(!) missing $f" | Out-File -Append up.log -Encoding utf8 }
}
if (-not (Select-String -Path 'homepage-theme.js' -Pattern 'q-anime' -Quiet)) {
  '(!) q-anime not registered in homepage-theme.js' | Out-File -Append up.log -Encoding utf8
}
if (-not (Select-String -Path 'homepage-layout.js' -Pattern 'collectStarredLinks' -Quiet)) {
  '(!) collectStarredLinks missing in homepage-layout.js' | Out-File -Append up.log -Encoding utf8
}
if (-not (Select-String -Path 'sakura.js' -Pattern 'candy-stars' -Quiet)) {
  '(!) candy-stars mode not found in sakura.js' | Out-File -Append up.log -Encoding utf8
}
if (-not (Select-String -Path 'sakura.js' -Pattern '"none"' -Quiet)) {
  '(!) none mode not found in sakura.js' | Out-File -Append up.log -Encoding utf8
}
if (-not (Select-String -Path 'app.js' -Pattern 'UIStarred' -Quiet)) {
  '(!) UIStarred missing' | Out-File -Append up.log -Encoding utf8
}
if (-not (Select-String -Path 'app.js' -Pattern 'renderGroupTabs' -Quiet)) {
  '(!) renderGroupTabs missing' | Out-File -Append up.log -Encoding utf8
}
if (-not (Select-String -Path 'styles.css' -Pattern '\[data-density="tight"\]' -Quiet)) {
  '(!) tight density rule missing' | Out-File -Append up.log -Encoding utf8
}
'theme & layout source check done' | Out-File -Append up.log -Encoding utf8

'END' | Out-File -Append up.log -Encoding utf8
