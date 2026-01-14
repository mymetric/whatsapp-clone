# Guia de Diagnóstico - Erro 502 Bad Gateway

## Passos para diagnosticar o problema:

### 1. Verificar se os containers estão rodando:
```bash
cd whatsapp-clone
docker-compose ps
```

Você deve ver dois containers:
- `whatsapp-clone-backend` (status: Up)
- `whatsapp-clone-app` (status: Up)

### 2. Verificar logs do backend:
```bash
docker-compose logs backend
```

Procure por:
- ✅ `🚀 Servidor backend rodando em http://0.0.0.0:4000`
- ✅ `✅ credentials.json carregado com sucesso`
- ❌ Qualquer erro sobre credentials.json
- ❌ Qualquer erro ao iniciar

### 3. Testar se o backend está respondendo:
```bash
# De dentro do container do nginx ou da máquina host
curl http://backend:4000/api/health

# Ou do host
docker exec whatsapp-clone-backend wget -qO- http://localhost:4000/api/health
```

Deve retornar:
```json
{"status":"ok","service":"backend","timestamp":"..."}
```

### 4. Verificar se o nginx consegue resolver o nome "backend":
```bash
docker exec whatsapp-clone-app nslookup backend
```

Deve retornar o IP do container backend.

### 5. Testar conexão do nginx para o backend:
```bash
docker exec whatsapp-clone-app wget -qO- http://backend:4000/api/health
```

### 6. Verificar logs do nginx:
```bash
docker-compose logs whatsapp-clone-app
```

Procure por erros de proxy ou conexão recusada.

### 7. Verificar se o credentials.json existe no container:
```bash
docker exec whatsapp-clone-backend ls -la /app/credentials.json
docker exec whatsapp-clone-backend cat /app/credentials.json | head -5
```

### 8. Verificar variáveis de ambiente:
```bash
docker exec whatsapp-clone-backend env | grep PORT
```

Deve mostrar `PORT=4000`

## Possíveis problemas e soluções:

### Problema 1: Backend não está iniciando
**Sintomas:** Container backend está "Exited" ou reiniciando constantemente
**Solução:** 
- Verificar logs: `docker-compose logs backend`
- Verificar se credentials.json está correto
- Verificar se todas as dependências foram instaladas

### Problema 2: Backend não está escutando em 0.0.0.0
**Sintomas:** Backend inicia mas nginx não consegue conectar
**Solução:** Já corrigido - backend agora escuta em 0.0.0.0:4000

### Problema 3: Credentials.json não encontrado
**Sintomas:** Erro no log: "credentials.json não encontrado"
**Solução:**
- Verificar se credentials.json foi criado antes do build
- Verificar se está sendo copiado no Dockerfile.backend

### Problema 4: Rede Docker não está funcionando
**Sintomas:** nginx não consegue resolver "backend"
**Solução:**
- Verificar se ambos containers estão na mesma rede: `docker network inspect whatsapp-clone-network`
- Recriar containers: `docker-compose down && docker-compose up -d`

### Problema 5: Porta 4000 já está em uso
**Sintomas:** Backend não consegue iniciar na porta 4000
**Solução:**
- Verificar se há outro processo usando a porta
- Não é necessário mapear a porta 4000 para o host (só para comunicação interna)

## Comandos úteis para debugging:

```bash
# Ver todos os logs
docker-compose logs -f

# Ver logs apenas do backend
docker-compose logs -f backend

# Reiniciar apenas o backend
docker-compose restart backend

# Rebuild e restart tudo
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Entrar no container do backend
docker exec -it whatsapp-clone-backend sh

# Entrar no container do nginx
docker exec -it whatsapp-clone-app sh

# Verificar rede Docker
docker network inspect whatsapp-clone-network
```
