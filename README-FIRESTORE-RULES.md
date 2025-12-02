# Como Aplicar Regras do Firestore ao Database "messages"

## Problema
As regras podem não estar sendo aplicadas automaticamente ao database "messages" via Firebase CLI.

## Solução Manual

1. Acesse: https://console.firebase.google.com/project/zapy-306602/firestore/rules

2. **IMPORTANTE**: No topo da página, certifique-se de selecionar o database **"messages"** no seletor (não o "(default)")

3. Cole as seguintes regras:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Permitir acesso à collection prompts
    match /prompts/{document=**} {
      allow read, write: if true; // TEMPORÁRIO - Ajuste conforme sua necessidade de segurança
    }
  }
}
```

4. Clique em **"Publicar"**

5. Aguarde alguns segundos para a propagação

6. Recarregue a página do app e tente criar um prompt novamente
