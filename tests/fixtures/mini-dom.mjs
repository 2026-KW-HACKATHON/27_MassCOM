// 제작기 편집기 행동 시험용 최소 DOM입니다. 브라우저 없이 innerHTML·querySelector·이벤트 전파·canvas 호출만 흉내 냅니다.
// 실제 브라우저 동작(레이아웃·픽셀 결과)은 검증하지 않고, 저장·게시·복사·충돌·삭제 흐름이 부르는 API 호출과 화면 문구를 확인하는 데 씁니다.
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'circle', 'path', 'polygon', 'rect']);
const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = text => text.replace(/&(?:amp|lt|gt|quot|#39);/g, match => entities[match]);
const camel = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const kebab = name => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

function parseSelector(text) {
  const groups = [];
  let depth = 0, quote = '', current = '';
  const groupsText = [];
  for (const character of text) {
    if (quote) { current += character; if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === '[') depth++; if (character === ']') depth--;
    if (character === ',' && depth === 0) { groupsText.push(current); current = ''; continue; }
    current += character;
  }
  groupsText.push(current);
  for (const group of groupsText) {
    const parts = [];
    let part = '';
    depth = 0; quote = '';
    for (const character of group.trim()) {
      if (quote) { part += character; if (character === quote) quote = ''; continue; }
      if (character === '"' || character === "'") { quote = character; part += character; continue; }
      if (character === '[') depth++; if (character === ']') depth--;
      if (/\s/.test(character) && depth === 0) { if (part) parts.push(part); part = ''; continue; }
      part += character;
    }
    if (part) parts.push(part);
    groups.push(parts.map(parseCompound));
  }
  return groups;
}
function parseCompound(text) {
  const compound = { tag: '', classes: [], attrs: [], nots: [] };
  const tag = text.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tag) { compound.tag = tag[0].toLowerCase(); text = text.slice(tag[0].length); }
  while (text) {
    let match;
    if ((match = text.match(/^\.([a-zA-Z0-9_-]+)/))) compound.classes.push(match[1]);
    else if ((match = text.match(/^\[([a-zA-Z0-9_:-]+)(?:([~|^$*]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/))) compound.attrs.push({ name: match[1], op: match[2], value: match[3] ?? match[4] ?? match[5] });
    else if ((match = text.match(/^:not\(((?:[^()]|\([^()]*\))*)\)/))) compound.nots.push(parseCompound(match[1]));
    else throw new Error(`mini-dom: unsupported selector "${text}"`);
    text = text.slice(match[0].length);
  }
  return compound;
}
function compoundMatches(element, compound) {
  if (compound.tag && element.tagName.toLowerCase() !== compound.tag) return false;
  if (compound.classes.some(name => !element.classList.contains(name))) return false;
  for (const { name, op, value } of compound.attrs) {
    const actual = element.getAttribute(name);
    if (actual === null) return false;
    if (op === '=' && actual !== value) return false;
    if (op === '^=' && !actual.startsWith(value)) return false;
  }
  return !compound.nots.some(item => compoundMatches(element, item));
}
function selectorMatches(element, selector, root) {
  return parseSelector(selector).some(chain => {
    if (!compoundMatches(element, chain.at(-1))) return false;
    let node = element.parentElement, index = chain.length - 2;
    while (index >= 0 && node && node !== root?.parentElement) { if (compoundMatches(node, chain[index])) index--; node = node.parentElement; }
    return index < 0;
  });
}

export class TextNode {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

export class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase(); this.ownerDocument = ownerDocument; this.nodeType = 1;
    this.childNodes = []; this.parentNode = null; this.attributes = new Map(); this.listeners = new Map();
    this.hidden = false; this.disabled = false; this.checked = false; this.open = false; this.files = []; this._value = undefined;
    this.width = 300; this.height = 150; this.naturalWidth = 0; this.naturalHeight = 0;
    const store = this;
    this.dataset = new Proxy({}, {
      get: (_, key) => typeof key === 'string' ? store.attributes.get(`data-${kebab(key)}`) : undefined,
      set: (_, key, value) => { store.attributes.set(`data-${kebab(key)}`, String(value)); return true; },
      has: (_, key) => store.attributes.has(`data-${kebab(String(key))}`),
    });
    this.classList = {
      add: (...names) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); names.forEach(name => set.add(name)); this.className = [...set].join(' '); },
      remove: (...names) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); names.forEach(name => set.delete(name)); this.className = [...set].join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const has = this.classList.contains(name), next = force ?? !has; this.classList[next ? 'add' : 'remove'](name); return next; },
    };
  }
  get className() { return this.attributes.get('class') ?? ''; }
  set className(value) { this.attributes.set('class', String(value)); }
  get id() { return this.attributes.get('id') ?? ''; }
  set id(value) { this.attributes.set('id', String(value)); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get nextElementSibling() { const siblings = this.parentNode?.children ?? []; return siblings[siblings.indexOf(this) + 1] ?? null; }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get value() {
    if (this.tagName === 'OPTION') return this._value ?? this.attributes.get('value') ?? this.textContent;
    if (this.tagName === 'SELECT') { const options = this.options; return options.some(item => item.value === this._value) ? this._value : (options[0]?.value ?? ''); }
    return this._value ?? this.attributes.get('value') ?? '';
  }
  set value(value) { this._value = String(value); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  set innerHTML(html) { this.replaceChildren(); parseInto(this, String(html)); }
  get innerHTML() { return this.childNodes.map(node => node.nodeType === 3 ? node.data : `<${node.tagName.toLowerCase()}>…`).join(''); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'hidden') this.hidden = true;
    if ((name === 'width' || name === 'height') && Number.isFinite(Number(value))) this[name] = Number(value);
    if (name === 'value') this._value = String(value);
  }
  getAttribute(name) {
    if (name === 'hidden') return this.hidden ? '' : null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  #adopt(node) { if (typeof node === 'string') node = new TextNode(node); node.parentNode?.removeChild?.(node); node.parentNode = this; return node; }
  append(...nodes) { for (const node of nodes) this.childNodes.push(this.#adopt(node)); }
  prepend(...nodes) { this.childNodes.unshift(...nodes.map(node => this.#adopt(node))); }
  appendChild(node) { this.append(node); return node; }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) { this.childNodes.splice(index, 1); node.parentNode = null; } return node; }
  replaceChildren(...nodes) { for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; this.append(...nodes); }
  remove() { this.parentNode?.removeChild(this); }
  contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (selectorMatches(node, selector)) return node; return null; }
  matches(selector) { return selectorMatches(this, selector); }
  querySelectorAll(selector) {
    const found = [];
    const walk = node => { for (const child of node.children) { if (selectorMatches(child, selector, this)) found.push(child); walk(child); } };
    walk(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(type, handler, options = {}) {
    const list = this.listeners.get(type) ?? []; list.push(handler); this.listeners.set(type, list);
    options.signal?.addEventListener('abort', () => this.removeEventListener(type, handler));
  }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== handler)); }
  dispatchEvent(event) {
    event.target ??= this;
    for (let node = this; node; node = node.parentElement) {
      event.currentTarget = node;
      for (const handler of [...(node.listeners?.get(event.type) ?? [])]) handler(event);
      if (event.cancelBubble || event.bubbles === false) break;
    }
    return true;
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() {} click() {} select() {} scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {} pause() {} play() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  getContext() { return this._context ??= createContext(this); }
  toDataURL(type = 'image/png') {
    const mime = this.ownerDocument.encoders.has(type) ? type : 'image/png';
    return `data:${mime};base64,${Buffer.from(`${mime}:${this.width}x${this.height}`).toString('base64')}`;
  }
}

function createContext(canvas) {
  const state = { canvas };
  const gradient = { addColorStop() {} };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'getImageData' || key === 'createImageData') return (x, y, width = canvas.width, height = canvas.height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => gradient;
      if (key === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

function parseInto(parent, html) {
  const token = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  const stack = [parent];
  for (const match of html.matchAll(token)) {
    const [whole, closing, opening, attributes = '', selfClosing, text] = match;
    const current = stack.at(-1);
    if (text !== undefined) { current.append(decode(text)); continue; }
    if (whole.startsWith('<!--')) continue;
    if (closing) { const index = stack.map(node => node.tagName?.toLowerCase()).lastIndexOf(closing.toLowerCase()); if (index > 0) stack.length = index; continue; }
    const element = parent.ownerDocument.createElement(opening);
    for (const attribute of attributes.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const [, name, quoted, single, bare] = attribute;
      const value = quoted ?? single ?? bare;
      element.setAttribute(name, value === undefined ? '' : decode(value));
      if (['disabled', 'checked', 'open', 'multiple', 'required', 'controls'].includes(name) && value === undefined) element[name] = true;
    }
    current.append(element);
    if (!selfClosing && !VOID.has(opening.toLowerCase())) stack.push(element);
  }
}

/** document·window·Image·FileReader 등 편집기가 전역으로 쓰는 것만 설치하고 되돌리는 함수를 돌려준다. */
export function installMiniDom({ webp = true } = {}) {
  const previous = new Map();
  const set = (name, value) => { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const document = {
    hidden: false, activeElement: null, listeners: new Map(), encoders: new Set(webp ? ['image/png', 'image/webp', 'image/jpeg'] : ['image/png']),
    createElement(tag) { return new Element(tag, document); },
    createTextNode(text) { return new TextNode(text); },
    getElementById(id) { return document.body.querySelector(`[id="${id}"]`); },
    querySelector(selector) { return document.body.querySelector(selector); },
    addEventListener(type, handler, options = {}) { Element.prototype.addEventListener.call(document, type, handler, options); },
    removeEventListener(type, handler) { Element.prototype.removeEventListener.call(document, type, handler); },
  };
  document.body = new Element('body', document);
  const windowListeners = new Element('window', document);
  const windowStub = { addEventListener: (...args) => windowListeners.addEventListener(...args), removeEventListener: (...args) => windowListeners.removeEventListener(...args),
    dispatch: event => { event.target ??= windowStub; for (const handler of [...(windowListeners.listeners.get(event.type) ?? [])]) handler(event); return event; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  document.listeners = new Map();
  set('document', document);
  set('window', windowStub);
  set('requestAnimationFrame', () => 1);
  set('cancelAnimationFrame', () => {});
  class FakeImage {
    set src(value) { this._src = value; setTimeout(() => { if (String(value).includes('broken')) this.onerror?.(new Error('broken')); else { this.naturalWidth = this.width = 2; this.naturalHeight = this.height = 2; this.onload?.(); } }, 0); }
    get src() { return this._src; }
  }
  set('Image', FakeImage);
  set('FileReader', class { readAsDataURL(file) { setTimeout(() => { this.result = file.dataUrl ?? `data:${file.type};base64,AAAA`; this.onload?.(); }, 0); } });
  return { document, window: windowStub, restore() { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } } };
}

// 대역의 타이머(파일 읽기·이미지 로드)와 비동기 흐름이 끝나도록 잠시 기다린다.
export const settle = async (turns = 12) => { for (let turn = 0; turn < turns; turn++) await new Promise(resolve => setTimeout(resolve, 3)); };
