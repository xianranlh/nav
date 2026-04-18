$ErrorActionPreference = 'Continue'
'Cleanup...' | Out-File up.log -Encoding utf8
docker compose down 2>&1 | Out-File -Append up.log -Encoding utf8
docker rm -f sakura-nav-test 2>&1 | Out-File -Append up.log -Encoding utf8
# 用一个大概率空闲的端口
$port = 18099
"Running on port $port ..." | Out-File -Append up.log -Encoding utf8
docker run -d --name sakura-nav-test -p "${port}:80" sakura-nav:latest 2>&1 | Out-File -Append up.log -Encoding utf8
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
docker rm -f sakura-nav-test 2>&1 | Out-File -Append up.log -Encoding utf8
'END' | Out-File -Append up.log -Encoding utf8
