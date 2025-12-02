# Use a imagem oficial do Node.js como base
FROM node:18-alpine as build

# Definir o diretório de trabalho
WORKDIR /app

# Copiar package.json e package-lock.json (se disponível)
COPY package*.json ./

# Instalar todas as dependências (incluindo dev dependencies necessárias para o build)
RUN npm ci

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

