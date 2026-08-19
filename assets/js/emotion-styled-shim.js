// Minimal browser-runnable shim for the '@emotion/styled' bare specifier.
// Resolved via the import map in index.html so this repo runs without a
// bundler, while preserving the same tagged-template API surface used
// by the fixture code (styled.div`...`).
function createStyledFactory(tagName) {
  return function styledTag(strings, ...values) {
    var css = strings.reduce(function (acc, str, i) {
      return acc + str + (values[i] !== undefined ? values[i] : '');
    }, '');
    var className = 'styled-' + Math.random().toString(36).slice(2, 9);
    if (typeof document !== 'undefined') {
      var styleEl = document.createElement('style');
      styleEl.textContent = '.' + className + ' {' + css + '}';
      document.head.appendChild(styleEl);
    }
    return { tag: tagName, className: className };
  };
}

var styled = new Proxy({}, {
  get: function (_target, tagName) {
    return createStyledFactory(tagName);
  }
});

export default styled;
