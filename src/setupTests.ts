// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// `react-markdown` é ESM e pode quebrar o Jest (CRA) ao importar o App nos testes.
// Para os testes unitários deste projeto, um mock simples é suficiente.
jest.mock('react-markdown', () => {
  return function ReactMarkdownMock(props: { children?: unknown }) {
    return props.children ?? null;
  };
});
