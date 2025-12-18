// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// `axios@1.x` é ESM e pode quebrar o Jest (CRA) ao importar módulos do app nos testes.
// Aqui forçamos um mock que expõe o mínimo necessário (`create`, `get`, `post`, etc).
jest.mock('axios', () => {
  // Usar o build CJS do axios para compatibilidade com Jest/CRA
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const axiosCjs = require('axios/dist/browser/axios.cjs');
  return axiosCjs;
});

// `react-markdown` é ESM e pode quebrar o Jest (CRA) ao importar o App nos testes.
// Para os testes unitários deste projeto, um mock simples é suficiente.
jest.mock('react-markdown', () => {
  return function ReactMarkdownMock(props: { children?: unknown }) {
    return props.children ?? null;
  };
});
