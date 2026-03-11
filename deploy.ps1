# Deploy script para Hostinger App Runner (PowerShell)

Write-Host "🚀 Script de Despliegue a Hostinger" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

# 1. Verificar git
Write-Host "`n📦 Verificando Git..."
try {
    git rev-parse --git-dir | Out-Null
    Write-Host "✅ Repositorio Git encontrado" -ForegroundColor Green
} catch {
    Write-Host "❌ No estás en un repositorio Git. Inicializando..." -ForegroundColor Yellow
    git init
    git add .
    git commit -m "Initial commit: WhatsApp bot with AI and PostgreSQL"
}

# 2. Mostrar estado
Write-Host "`n📊 Estado actual:" -ForegroundColor Blue
git status

# 3. Confirmar push
$confirm = Read-Host "`n¿Deseas hacer push a Hostinger? (s/n)"

if ($confirm -eq "s" -or $confirm -eq "S") {
    # Agregar cambios
    Write-Host "`n📝 Agregando cambios..." -ForegroundColor Blue
    git add .
    
    # Pedir mensaje
    $message = Read-Host "Mensaje de commit (press Enter para 'Update bot code')"
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = "Update bot code"
    }
    
    # Commit
    Write-Host "`n💾 Haciendo commit..." -ForegroundColor Blue
    git commit -m $message
    
    # Push
    Write-Host "`n🔄 Haciendo push a GitHub (Armaqdev/bot-whatsapp)..." -ForegroundColor Blue
    git push origin main
    
    Write-Host "`n✅ Push completado!" -ForegroundColor Green
    Write-Host "📋 Si conectaste GitHub a Hostinger:" -ForegroundColor Cyan
    Write-Host "   - Hostinger ve el push automáticamente" -ForegroundColor Cyan
    Write-Host "   - Deploy inicia en 1-2 minutos" -ForegroundColor Cyan
    Write-Host "   - Verifica en: hpanel.hostinger.com > App Runner > Deployments > Activity" -ForegroundColor Cyan
    Write-Host "`n📋 Si NO conectaste GitHub:" -ForegroundColor Yellow
    Write-Host "   - Ve a hpanel.hostinger.com > App Runner > Deployments > Deploy Now" -ForegroundColor Yellow
} else {
    Write-Host "`n❌ Deploy cancelado" -ForegroundColor Yellow
}
