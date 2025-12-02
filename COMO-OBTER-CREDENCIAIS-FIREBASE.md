# Como Obter as Credenciais do Firebase para o Frontend

## Problema
Para salvar os prompts diretamente no Firestore do frontend, você precisa das credenciais de configuração do Firebase (não do service account).

## Diferença entre Service Account e Config do Firebase

- **Service Account**: Usado pelo Firebase Admin SDK no backend (Node.js)
- **Config do Firebase**: Usado pelo Firebase Client SDK no frontend (JavaScript/React)

## Como Obter as Credenciais do Firebase

1. Acesse o Firebase Console: https://console.firebase.google.com/project/zapy-306602

2. Vá em **Configurações do Projeto** (ícone de engrenagem)

3. Role até a seção **Seus apps**

4. Se já houver um app Web, clique nele. Se não houver, clique em **Adicionar app** > **Web** (ícone `</>`)

5. Copie as credenciais que aparecem. Elas terão este formato:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "zapy-306602.firebaseapp.com",
  projectId: "zapy-306602",
  storageBucket: "zapy-306602.appspot.com",
  messagingSenderId: "103479789680712397761",
  appId: "1:103479789680712397761:web:..."
};
```

6. Adicione essas credenciais no arquivo `public/credentials.json` na seção `firebase`:

```json
{
  "users": [...],
  "api": {...},
  "firebase": {
    "apiKey": "AIzaSy...",
    "authDomain": "zapy-306602.firebaseapp.com",
    "projectId": "zapy-306602",
    "storageBucket": "zapy-306602.appspot.com",
    "messagingSenderId": "103479789680712397761",
    "appId": "1:103479789680712397761:web:..."
  }
}
```

## Limitação Importante

⚠️ **O Firestore Client SDK só pode acessar o database default**, não o database "messages".

Para salvar no database "messages", você tem duas opções:

### Opção 1: Usar o Backend (Recomendado)
Configure o endpoint `/prompts` no n8n para usar o Firebase Admin SDK e salvar no database "messages".

### Opção 2: Usar o Database Default
Se você quiser usar o Client SDK diretamente, os prompts serão salvos no database default, não no "messages".

## Configuração das Regras do Firestore

Certifique-se de que as regras do Firestore permitem leitura/escrita na collection `prompts`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /prompts/{document=**} {
      allow read, write: if true; // Ajuste conforme sua necessidade de segurança
    }
  }
}
```

Aplique essas regras tanto no database default quanto no database "messages" (se estiver usando o backend).

