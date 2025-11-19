# WhatsApp Clone

Clone do WhatsApp desenvolvido com React e TypeScript.

## 🚀 Como Executar

### Primeira vez (instalação inicial)

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar o servidor de desenvolvimento
npm start
```

### Uso diário (quando já tem as dependências instaladas)

```bash
# Apenas iniciar o servidor
npm start
```

O app estará disponível em [http://localhost:3000](http://localhost:3000)

### ⚠️ Se der problema (limpeza e reinstalação)

Se o `npm install` estiver lento ou der erro, execute:

```bash
# 1. Limpar cache do npm
npm cache clean --force

# 2. Remover node_modules e package-lock.json
rm -rf node_modules package-lock.json

# 3. Reinstalar tudo do zero
npm install

# 4. Iniciar o servidor
npm start
```

## 📋 Comandos Disponíveis

### `npm start`

Inicia o servidor de desenvolvimento.\
Abra [http://localhost:3000](http://localhost:3000) no navegador.

A página recarrega automaticamente quando você faz alterações no código.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).
