#!/bin/bash
# Deploy script para Hostinger App Runner

echo "🚀 Script de Despliegue a Hostinger"
echo "===================================="

# 1. Verificar git
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ No estás en un repositorio Git. Inicializando..."
    git init
    git add .
    git commit -m "Initial commit: WhatsApp bot with AI and PostgreSQL"
else
    echo "✅ Repositorio Git encontrado"
fi

# 2. Verificar cambios
echo ""
echo "📊 Estado del repositorio:"
git status

# 3. Pedir confirmación
echo ""
read -p "¿Deseas hacer push a Hostinger? (s/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Ss]$ ]]; then
    # 4. Agregar cambios
    echo "📝 Agregando cambios..."
    git add .
    
    # 5. Pedir mensaje de commit
    read -p "Mensaje de commit: " commit_msg
    git commit -m "${commit_msg:-Update bot code}"
    
    # 6. Push
    echo "🔄 Haciendo push a GitHub (Armaqdev/bot-whatsapp)..."
    git push origin main
    
    echo ""
    echo "✅ Push completado!"
    echo "📋 Si conectaste GitHub a Hostinger:"
    echo "   - Hostinger ve el push automáticamente"
    echo "   - Deploy inicia en 1-2 minutos"
    echo "   - Verifica en: hpanel.hostinger.com > App Runner > Deployments"
    echo ""
    echo "📋 Si NO conectaste GitHub:"
    echo "   - Ve a hpanel.hostinger.com > App Runner > Deployments > Deploy Now"
else
    echo "❌ Deploy cancelado"
fi
