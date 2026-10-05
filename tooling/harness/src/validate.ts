import { docsCheck } from "./registry";

// validate:hooks (N-5): расхождение файлов хуков с реестром или прямой вызов
// codegraph, graphify, serena-hooks - ошибка. Список проблем пуст - проверка пройдена.
export function validateHooks(root: string): string[] {
  return docsCheck(root);
}
