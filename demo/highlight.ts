/** Small JS/TSX highlighter for the authored demo snippets. All source stays text. */
export function highlightCode(element: HTMLElement, source: string): void {
  const tokens = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(?<tag><\/?[A-Za-z][\w.]*)|(?<keyword>\b(?:import|from|export|default|const|let|var|new|return|function|async|await|if|else|true|false|null|undefined|type|interface)\b)|(?<number>\b\d+(?:\.\d+)?\b)|(?<function>[$A-Za-z_][\w$]*(?=\s*\())|(?<property>[$A-Za-z_][\w$]*(?=\s*[:=]))|(?<punctuation>[{}[\]();,.<>/=])/g;
  const colors: Record<string, string> = {
    comment: 'token-comment', string: 'token-green', tag: 'token-blue', keyword: 'token-purple',
    number: 'token-coral', function: 'token-yellow', property: 'token-blue', punctuation: 'token-punctuation',
  };
  const doc = element.ownerDocument;
  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  for (const match of source.matchAll(tokens)) {
    fragment.append(doc.createTextNode(source.slice(cursor, match.index)));
    const token = doc.createElement('span');
    const kind = Object.keys(match.groups ?? {}).find((key) => match.groups?.[key] !== undefined)!;
    token.className = colors[kind]!;
    token.textContent = match[0]; fragment.append(token);
    cursor = match.index! + match[0].length;
  }
  fragment.append(doc.createTextNode(source.slice(cursor)));
  element.replaceChildren(fragment);
}
