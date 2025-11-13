// js/dom.js
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      n.addEventListener(k.slice(2), v);
    } else {
      n.setAttribute(k, v);
    }
  });
  kids.forEach(k => n.append(k));
  return n;
}

export function fmtFab(x) {
  return `$${x.toLocaleString()}`;
}
