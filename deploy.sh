#!/bin/bash

# Script completo de deploy do WhatsApp Clone
# Uso: ./deploy.sh [GITHUB_REPO] [BRANCH]
# Exemplo: ./deploy.sh https://github.com/usuario/whatsapp-clone.git main

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para log
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

echo "🚀 Deploy completo do WhatsApp Clone"
echo "=================================="

# Configurações
GITHUB_REPO="${1:-}"
BRANCH="${2:-master}"
APP_NAME="whatsapp-clone"
APP_DIR="./$APP_NAME"
PORT="3000"

# Verificar argumentos
if [ -z "$GITHUB_REPO" ]; then
    echo "Uso: $0 GITHUB_REPO [BRANCH]"
    echo ""
    echo "Exemplos:"
    echo "  $0 https://github.com/usuario/whatsapp-clone.git"
    echo "  $0 https://github.com/usuario/whatsapp-clone.git develop"
    echo ""
    echo "Argumentos:"
    echo "  GITHUB_REPO  URL do repositório GitHub (obrigatório)"
    echo "  BRANCH       Branch a ser clonada (padrão: master)"
    exit 1
fi

log "📦 Repositório: $GITHUB_REPO"
log "🌿 Branch: $BRANCH"
log "📁 Diretório: $APP_DIR"
echo ""

# Verificar dependências
log "Verificando dependências..."

if ! command -v git &> /dev/null; then
    error "Git não está instalado. Instale com: apt-get install git"
fi

if ! command -v docker &> /dev/null; then
    error "Docker não está instalado. Instale com: curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh"
fi

if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose não está instalado. Instale com: apt-get install docker-compose"
fi

log "✅ Todas as dependências estão instaladas"

# Parar containers existentes se existirem
if [ -f "$APP_DIR/docker-compose.yml" ]; then
    log "Parando containers existentes..."
    cd "$APP_DIR"
    docker-compose down --remove-orphans || true
    cd ..
fi

# Remover diretório existente se existir
if [ -d "$APP_DIR" ]; then
    log "Removendo instalação anterior..."
    rm -rf "$APP_DIR"
fi

# Clonar repositório
log "Clonando repositório do GitHub..."
git clone -b "$BRANCH" "$GITHUB_REPO" "$APP_DIR"

# Navegar para o diretório
cd "$APP_DIR"

# Verificar se os arquivos necessários existem
if [ ! -f "package.json" ]; then
    error "Arquivo package.json não encontrado. Verifique se o repositório está correto."
fi

# Criar Dockerfile se não existir
if [ ! -f "Dockerfile" ]; then
    log "Criando Dockerfile..."
    cat > Dockerfile << 'EOF'
# Use a imagem oficial do Node.js como base
FROM node:18-alpine as build

# Definir o diretório de trabalho
WORKDIR /app

# Copiar package.json e package-lock.json (se disponível)
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar o código fonte
COPY . .

# Build da aplicação para produção
RUN npm run build

# Estágio de produção com nginx
FROM nginx:alpine

# Copiar os arquivos buildados para o nginx
COPY --from=build /app/build /usr/share/nginx/html

# Copiar configuração customizada do nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Expor a porta 80
EXPOSE 80

# Comando para iniciar o nginx
CMD ["nginx", "-g", "daemon off;"]
EOF
fi

# Criar nginx.conf se não existir
if [ ! -f "nginx.conf" ]; then
    log "Criando nginx.conf..."
    cat > nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # Configurações de log
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # Configurações de performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Compressão gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;

    server {
        listen 80;
        server_name localhost;
        root /usr/share/nginx/html;
        index index.html;

        # Configuração para SPA (Single Page Application)
        location / {
            try_files $uri $uri/ /index.html;
        }

        # Cache para arquivos estáticos
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        # Configuração de segurança
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer-when-downgrade" always;
        add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

        # Health check
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
EOF
fi

# Criar docker-compose.yml se não existir
if [ ! -f "docker-compose.yml" ]; then
    log "Criando docker-compose.yml..."
    cat > docker-compose.yml << EOF
version: '3.8'

services:
  $APP_NAME:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: $APP_NAME-app
    ports:
      - "$PORT:80"
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    networks:
      - $APP_NAME-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  $APP_NAME-network:
    driver: bridge
EOF
fi

# Criar .dockerignore se não existir
if [ ! -f ".dockerignore" ]; then
    log "Criando .dockerignore..."
    cat > .dockerignore << 'EOF'
node_modules
npm-debug.log
.git
.gitignore
README.md
.env
.nyc_output
coverage
.nyc_output
.coverage
.coverage/
.DS_Store
*.log
build
dist
EOF
fi

# Limpar imagens antigas
log "Limpando imagens antigas..."
docker image prune -f || true

# Build da aplicação
log "Fazendo build da aplicação..."
docker-compose build --no-cache

# Iniciar containers
log "Iniciando containers..."
docker-compose up -d

# Aguardar aplicação ficar online
log "Aguardando aplicação ficar online..."
sleep 15

# Verificar se a aplicação está rodando
log "Verificando se a aplicação está funcionando..."
if curl -f "http://localhost:$PORT/health" > /dev/null 2>&1; then
    log "✅ Deploy realizado com sucesso!"
    log "🌐 Aplicação disponível em: http://localhost:$PORT"
    log "📊 Health check: http://localhost:$PORT/health"
else
    warning "Aplicação pode não estar totalmente pronta ainda. Verificando logs..."
    docker-compose logs --tail=20
fi

# Mostrar status dos containers
log "Status dos containers:"
docker-compose ps

echo ""
log "🎉 Deploy completo finalizado!"
echo ""
info "📋 Comandos úteis:"
echo "  - Ver logs: cd $APP_DIR && docker-compose logs -f"
echo "  - Parar: cd $APP_DIR && docker-compose down"
echo "  - Reiniciar: cd $APP_DIR && docker-compose restart"
echo "  - Status: cd $APP_DIR && docker-compose ps"
echo "  - Atualizar: cd $APP_DIR && git pull && docker-compose up -d --build"
echo ""
info "🌐 Acesse sua aplicação em: http://localhost:$PORT"