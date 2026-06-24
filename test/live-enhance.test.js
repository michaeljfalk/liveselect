/**
 * live-enhance.test.js — DOM tests for reactive `enhance(sel, { live: true })`
 * and the `<select data-liveselect>` auto-mounter (run under jsdom).
 *
 * Covers the live-mode contract:
 *   - the native <select> stays in the DOM (visually hidden) as source of truth
 *   - a host mutating the <select> (add/remove options, change selection,
 *     disable) is reflected into the liveselect UI live (MutationObserver)
 *   - a UI pick writes back: sets the native value/option.selected and fires
 *     exactly one bubbling input + change ON THE SELECT (delegated parent sees it)
 *   - no feedback loop when the host's change handler re-renders to the same value
 *   - re-enhancing is a no-op; destroy() tears down; removal auto-cleans
 *   - plain <form> FormData serializes the native select's value by name
 *   - the auto-mounter enhances a <select data-liveselect> inserted after load
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let LiveSelect;
let domAvailable = true;
try {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.CustomEvent = dom.window.CustomEvent;
  global.Event = dom.window.Event;
  global.MutationObserver = dom.window.MutationObserver;
  global.FormData = dom.window.FormData;
  LiveSelect = require('../dist/liveselect.js');
  global.window.LiveSelect = LiveSelect;   // -auto.js reads the global
} catch (e) {
  domAvailable = false;
  // eslint-disable-next-line no-console
  console.error('[live-enhance.test] DOM setup failed, skipping:', e.message);
}

const tick = () => new Promise((r) => setTimeout(r, 0));   // let MutationObserver flush

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

function makeSelect(host, html, attrs) {
  const sel = document.createElement('select');
  Object.keys(attrs || {}).forEach((k) => {
    if (k === 'multiple') sel.multiple = !!attrs[k];
    else sel.setAttribute(k, attrs[k]);
  });
  sel.innerHTML = html;
  host.appendChild(sel);
  return sel;
}

test('live: host option add / remove / select / disable reflect into the UI', { skip: !domAvailable }, async () => {
  const host = mount();
  const sel = makeSelect(host,
    '<option value="">Choose…</option>' +
    '<option value="a">Apple</option>' +
    '<option value="b" selected>Banana</option>',
    { name: 'fruit' });

  const dd = LiveSelect.enhance(sel, { live: true });
  assert.equal(dd.getValue(), 'b', 'initial selection mirrored');
  assert.notEqual(sel.style.cssText.indexOf('absolute'), -1, 'select is visually hidden, not display:none');
  assert.notEqual(sel.style.display, 'none');

  // Host APPENDS an option.
  const cherry = document.createElement('option');
  cherry.value = 'c'; cherry.textContent = 'Cherry';
  sel.appendChild(cherry);
  await tick();
  assert.ok(dd.opts.source.some((o) => o.value === 'c'), 'added option reflected into source');

  // Host REMOVES an option.
  sel.removeChild(sel.querySelector('option[value="a"]'));
  await tick();
  assert.ok(!dd.opts.source.some((o) => o.value === 'a'), 'removed option dropped from source');

  // Host CHANGES the selected value (controlled-input style: property + change).
  sel.value = 'c';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(dd.getValue(), 'c', 'reactive selection change reflected');

  // Host DISABLES the select (attribute → observed).
  sel.setAttribute('disabled', '');
  await tick();
  assert.equal(dd.input.disabled, true, 'disabled reflected onto the control input');

  dd.destroy();
});

test('live: a UI pick writes back one bubbling input+change on the select', { skip: !domAvailable }, () => {
  const host = mount();
  const sel = makeSelect(host,
    '<option value="">Choose…</option><option value="a">Apple</option><option value="b">Banana</option>',
    { name: 'fruit' });

  let changeOnSel = 0, inputOnSel = 0, delegated = false;
  host.addEventListener('change', (e) => { if (e.target === sel) { changeOnSel++; delegated = true; } });
  host.addEventListener('input', (e) => { if (e.target === sel) inputOnSel++; });

  const dd = LiveSelect.enhance(sel, { live: true });
  dd._select({ value: 'a', label: 'Apple', sublabel: '' });

  assert.equal(sel.value, 'a', 'native value updated');
  assert.equal(sel.querySelector('option[value="a"]').selected, true, 'matching option.selected set');
  assert.equal(changeOnSel, 1, 'exactly one change on the native select');
  assert.equal(inputOnSel, 1, 'exactly one input on the native select');
  assert.ok(delegated, 'a delegated listener on a parent sees the change');
  dd.destroy();
});

test('live: write-back creates a brand-new option in the native select', { skip: !domAvailable }, () => {
  const host = mount();
  const sel = makeSelect(host, '<option value="">Choose…</option>', { name: 'city' });
  const dd = LiveSelect.enhance(sel, { live: true });
  dd._select({ value: 'yyz', label: 'Toronto', sublabel: '' });
  assert.equal(sel.value, 'yyz');
  assert.ok(Array.prototype.some.call(sel.options, (o) => o.value === 'yyz' && o.selected));
  dd.destroy();
});

test('live: no feedback loop when the host re-renders to the same value', { skip: !domAvailable }, async () => {
  const host = mount();
  const sel = makeSelect(host,
    '<option value="a">Apple</option><option value="b">Banana</option>',
    { name: 'fruit' });

  let handlerCalls = 0;
  sel.addEventListener('change', () => {
    handlerCalls++;
    if (handlerCalls > 25) throw new Error('feedback loop');
    // Host reacts to the change by re-rendering the option list to the SAME value.
    const cur = sel.value;
    sel.innerHTML = '<option value="a">Apple</option><option value="b">Banana</option>';
    sel.value = cur;
  });

  const dd = LiveSelect.enhance(sel, { live: true });
  dd._select({ value: 'b', label: 'Banana', sublabel: '' });   // 'a' is the default → pick 'b'
  await tick(); await tick();

  assert.equal(handlerCalls, 1, 'change handler ran exactly once — no ping-pong');
  assert.equal(dd.getValue(), 'b', 'value settled');
  assert.equal(sel.value, 'b');
  dd.destroy();
});

test('live: re-enhancing an enhanced select is a no-op', { skip: !domAvailable }, () => {
  const host = mount();
  const sel = makeSelect(host, '<option value="a">Apple</option>', { name: 'fruit' });
  const dd1 = LiveSelect.enhance(sel, { live: true });
  const dd2 = LiveSelect.enhance(sel, { live: true });
  assert.equal(dd1, dd2, 'same instance returned');
  assert.equal(host.querySelectorAll('.liveselect').length, 1, 'only one control rendered');
  dd1.destroy();
});

test('live: destroy() disconnects the observer and restores the select', { skip: !domAvailable }, async () => {
  const host = mount();
  const sel = makeSelect(host, '<option value="a">Apple</option>', { name: 'fruit' });
  const dd = LiveSelect.enhance(sel, { live: true });
  assert.equal(sel.getAttribute('aria-hidden'), 'true');

  dd.destroy();
  assert.equal(sel._liveselect, null, 'instance reference cleared');
  assert.equal(sel.getAttribute('aria-hidden'), null, 'aria-hidden removed');
  assert.equal(sel.hasAttribute('tabindex'), false, 'tabindex removed');
  assert.equal(host.querySelectorAll('.liveselect').length, 0, 'UI torn down');

  // Mutating after destroy must not throw or resurrect the UI.
  const extra = document.createElement('option');
  extra.value = 'z'; extra.textContent = 'Z'; sel.appendChild(extra);
  await tick();
  assert.equal(host.querySelectorAll('.liveselect').length, 0);
});

test('live: removing the select from the DOM auto-tears-down', { skip: !domAvailable }, async () => {
  const host = mount();
  const sel = makeSelect(host, '<option value="a">Apple</option>', { name: 'fruit' });
  const dd = LiveSelect.enhance(sel, { live: true });
  assert.ok(sel._liveselect);

  host.removeChild(sel);
  await tick();
  assert.equal(sel._liveselect, null, 'removal disconnected and cleaned up');
});

test('live: plain <form> FormData yields the native select value by name', { skip: !domAvailable }, () => {
  const host = mount();
  const form = document.createElement('form');
  host.appendChild(form);
  const sel = makeSelect(form,
    '<option value="">Choose…</option><option value="a">Apple</option><option value="b">Banana</option>',
    { name: 'fruit' });

  const dd = LiveSelect.enhance(sel, { live: true });
  dd._select({ value: 'b', label: 'Banana', sublabel: '' });

  const fd = new FormData(form);
  assert.equal(fd.get('fruit'), 'b', 'form serializes the native selects value');
  assert.equal(fd.getAll('fruit').length, 1, 'value is not submitted twice');
  dd.destroy();
});

test('live: <select multiple> reflects host changes and writes back option.selected', { skip: !domAvailable }, async () => {
  const host = mount();
  const sel = makeSelect(host,
    '<option value="js" selected>JavaScript</option>' +
    '<option value="py">Python</option>' +
    '<option value="go" selected>Go</option>',
    { name: 'langs', multiple: true });

  const dd = LiveSelect.enhance(sel, { live: true });
  assert.equal(dd.multi, true);
  assert.deepEqual(dd.getValue().slice().sort(), ['go', 'js']);

  // UI pick adds Python → reflected into the native <select multiple>.
  dd._select({ value: 'py', label: 'Python' });
  const s$1 = Array.from(sel.options).filter((o) => o.selected).map((o) => o.value).sort();
  assert.deepEqual(s$1, ['go', 'js', 'py']);

  // Host removes a selected option → reflected into the UI.
  sel.removeChild(sel.querySelector('option[value="go"]'));
  await tick();
  assert.deepEqual(dd.getValue().slice().sort(), ['js', 'py'], 'removed selection dropped from chips');
  dd.destroy();
});

// ---- auto-mounter -----------------------------------------------------------

test('auto: enhances <select data-liveselect> present at scan and inserted later', { skip: !domAvailable }, async () => {
  // Load the declarative auto-mounter (reads window.LiveSelect, starts observer).
  require('../dist/liveselect-auto.js');
  const Auto = global.window.LiveSelectAuto;
  assert.ok(Auto, 'LiveSelectAuto exposed');

  // (a) present at scan time.
  const host = mount();
  const sel0 = makeSelect(host, '<option value="a">Apple</option>', { 'data-liveselect': '', name: 'f0' });
  Auto.mountAll();
  assert.ok(sel0._liveselect instanceof LiveSelect, 'existing select enhanced by mountAll');

  // (b) inserted after load → the document observer enhances it.
  const sel1 = document.createElement('select');
  sel1.setAttribute('data-liveselect', '');
  sel1.name = 'f1';
  sel1.innerHTML = '<option value="b">Banana</option>';
  host.appendChild(sel1);
  await tick();
  assert.ok(sel1._liveselect instanceof LiveSelect, 'framework-inserted select auto-enhanced');

  sel0._liveselect.destroy();
  sel1._liveselect.destroy();
});
