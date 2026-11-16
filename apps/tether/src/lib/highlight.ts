// A separate chunk, requested only for completed fenced code. No auto-detection scan.
let loading: Promise<typeof import('highlight.js/lib/core').default> | undefined;
export function loadHighlighter() {
  return loading ??= Promise.all([
    import('highlight.js/lib/core'), import('highlight.js/lib/languages/javascript'),
    import('highlight.js/lib/languages/typescript'), import('highlight.js/lib/languages/bash'),
    import('highlight.js/lib/languages/json'), import('highlight.js/lib/languages/python'),
    import('highlight.js/lib/languages/rust'), import('highlight.js/lib/languages/xml'),
    import('highlight.js/lib/languages/css')
  ]).then(([{ default: hljs }, ...languages]) => {
    ['javascript', 'typescript', 'bash', 'json', 'python', 'rust', 'xml', 'css'].forEach((name, i) => hljs.registerLanguage(name, languages[i].default));
    hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
    hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
    hljs.registerAliases(['sh', 'shell'], { languageName: 'bash' });
    hljs.registerAliases(['html'], { languageName: 'xml' });
    return hljs;
  });
}
