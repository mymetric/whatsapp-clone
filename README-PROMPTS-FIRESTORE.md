# Como Configurar o Endpoint /prompts no Backend para Salvar no Firestore

## Problema
Os prompts não estão sendo salvos no Firestore database "messages" porque o endpoint `/prompts` não existe no backend.

## Solução
Configure o endpoint `/prompts` no seu backend (n8n) para salvar na collection `prompts` do database `messages` no Firestore.

## Endpoints Necessários

### 1. GET /prompts
**Retorna:** Array de prompts
```json
[
  {
    "id": "prompt-id-123",
    "name": "Nome do Prompt",
    "description": "Descrição opcional",
    "content": "Conteúdo do prompt...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Ação no Firestore:**
- Database: `messages`
- Collection: `prompts`
- Operação: Buscar todos os documentos da collection `prompts`

### 2. POST /prompts
**Recebe:**
```json
{
  "name": "Nome do Prompt",
  "description": "Descrição opcional",
  "content": "Conteúdo do prompt...",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Retorna:** O prompt criado com `id` gerado pelo Firestore

**Ação no Firestore:**
- Database: `messages`
- Collection: `prompts`
- Operação: Criar novo documento na collection `prompts`
- O `id` deve ser gerado automaticamente pelo Firestore

### 3. PUT /prompts/:id
**Recebe:**
```json
{
  "name": "Nome atualizado",
  "description": "Descrição atualizada",
  "content": "Conteúdo atualizado...",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Retorna:** O prompt atualizado

**Ação no Firestore:**
- Database: `messages`
- Collection: `prompts`
- Document ID: `:id` (do parâmetro da URL)
- Operação: Atualizar documento existente

### 4. DELETE /prompts/:id
**Ação no Firestore:**
- Database: `messages`
- Collection: `prompts`
- Document ID: `:id` (do parâmetro da URL)
- Operação: Deletar documento

## Configuração no n8n

1. Crie um webhook para cada endpoint:
   - `GET /webhook/api/prompts` - Listar prompts
   - `POST /webhook/api/prompts` - Criar prompt
   - `PUT /webhook/api/prompts/:id` - Atualizar prompt
   - `DELETE /webhook/api/prompts/:id` - Deletar prompt

2. Configure cada webhook para:
   - Conectar ao Firestore database `messages`
   - Usar a collection `prompts`
   - Aplicar as operações CRUD correspondentes

3. Certifique-se de que:
   - O database `messages` está selecionado (não o default)
   - A collection `prompts` existe ou será criada automaticamente
   - As regras do Firestore permitem leitura/escrita (veja `README-FIRESTORE-RULES.md`)

## Estrutura do Documento no Firestore

```
Database: messages
Collection: prompts
Document ID: (gerado automaticamente ou customizado)
Fields:
  - id: string (mesmo que o Document ID)
  - name: string
  - description: string (opcional)
  - content: string
  - createdAt: timestamp
  - updatedAt: timestamp
```

## Verificação

Após configurar o backend:
1. Tente criar um prompt no frontend
2. Verifique no console do navegador se aparece: `✅ Prompt salvo no Firestore com sucesso`
3. Verifique no Firestore Console se o documento foi criado em `messages > prompts`

## Erros Comuns

- **404 Not Found**: Endpoint não existe no backend
- **Network Error**: Backend não está acessível ou CORS não configurado
- **403 Forbidden**: Regras do Firestore não permitem a operação



