/**
 * liveselect-auto.js — declarative auto-mount helper (optional).
 *
 * WHAT: Lets server templates (EJS, Blaze, plain HTML) create a dropdown with
 *       NO inline JavaScript. Two declarative entry points:
 *
 *   1. <div data-liveselect-mount …>  — a fresh control built from data-* attrs
 *      (array or remote/Mongo source). See MARKUP below.
 *   2. <select data-liveselect>       — an existing native <select> upgraded
 *      in-place with LiveSelect.enhance(sel, { live: true }), so a reactive host
 *      (Blaze/React/Vue) can keep re-rendering the <select> and the skin stays
 *      in sync both ways. Ideal for converting hundreds of existing selects by
 *      just tagging them.
 *
 *      This script also WATCHES the document for newly-inserted matching nodes
 *      (framework-added rows), so selects/mounts added after load are upgraded
 *      automatically. All mounting is idempotent — re-scanning is safe.
 *
 * LOAD ORDER: include liveselect.js first, then this file.
 *
 * MARKUP (div mount):
 *   <div data-liveselect-mount
 *        data-name="customerId"
 *        data-label="Customer"
 *        data-placeholder="Search customers…"
 *        data-api-base="/api/dropdown"      <!-- async/Mongo source -->
 *        data-api-key="customers"
 *        data-allow-create="true"
 *        data-value="<existing id>"          <!-- optional, edit mode -->
 *        data-value-label="<existing label>"
 *        data-options='[{"value":"a","label":"A"}]'  <!-- OR a static array source -->
 *   ></div>
 *
 * MARKUP (live enhance):
 *   <select data-liveselect name="customerId" data-allow-create="true">
 *     <option value="">Choose…</option>
 *     <option value="1" selected>Acme</option>
 *   </select>
 *
 * Provide EITHER data-api-base + data-api-key (remote) OR data-options (array)
 * for div mounts. Each mounted element gets `el._liveselect` set to its instance.
 */
(function () {
  'use strict';

  function glob() { return typeof self !== 'undefined' ? self : window; }
  function bool(v) { return v === '' || v === 'true' || v === '1'; }
  function LS() {
    var SD = glob().LiveSelect;
    if (!SD && typeof console !== 'undefined') console.error('liveselect.js must load before -auto.js');
    return SD;
  }

  // --- div mount: build a fresh control from data-* attributes ---------------
  function mountOne(el) {
    if (el._liveselect) return; // already mounted
    var SD = LS();
    if (!SD) return;

    var d = el.dataset;
    var opts = {
      name:        d.name || '',
      label:       d.label || '',
      placeholder: d.placeholder || 'Search…',
      value:       d.value || '',
      valueLabel:  d.valueLabel || '',
      required:    bool(d.required),
      disabled:    bool(d.disabled),
      allowCreate: bool(d.allowCreate),
    };
    if (d.createLabel) opts.createLabel = function () { return d.createLabel; };

    if (d.apiBase && d.apiKey) {
      // Remote / MongoDB-backed source.
      var api = SD.remoteSource({ baseUrl: d.apiBase, key: d.apiKey, create: opts.allowCreate });
      opts.source   = api.source;
      opts.resolve  = api.resolve;
      if (opts.allowCreate) opts.onCreate = api.onCreate;
    } else if (d.options) {
      // Static array source (JSON in a data attribute — safe, HTML-escaped).
      try { opts.source = JSON.parse(d.options); } catch (e) { opts.source = []; }
    } else {
      opts.source = [];
    }

    el._liveselect = new SD(el, opts);
  }

  // --- live enhance: upgrade an existing <select data-liveselect> in place ----
  function enhanceOne(sel) {
    if (sel._liveselect) return; // already enhanced (enhance is itself idempotent)
    var SD = LS();
    if (!SD) return;

    var d = sel.dataset;
    var extra = { live: true };
    if (d.placeholder) extra.placeholder = d.placeholder;
    if (bool(d.allowCreate)) {
      extra.allowCreate = true;
      if (d.createLabel) extra.createLabel = function () { return d.createLabel; };
    }
    SD.enhance(sel, extra);
  }

  // Upgrade a single node if it matches either contract.
  function upgrade(node) {
    if (node.nodeType !== 1) return; // elements only
    if (node.matches) {
      if (node.matches('select[data-liveselect]')) { enhanceOne(node); return; }
      if (node.matches('[data-liveselect-mount]')) { mountOne(node); return; }
    }
  }

  function mountAll(root) {
    var scope = root || document;
    var sels = scope.querySelectorAll('select[data-liveselect]');
    for (var i = 0; i < sels.length; i++) enhanceOne(sels[i]);
    var nodes = scope.querySelectorAll('[data-liveselect-mount]');
    for (var j = 0; j < nodes.length; j++) mountOne(nodes[j]);
  }

  // Watch the document for framework-inserted selects/mounts and upgrade them.
  function observe() {
    if (typeof MutationObserver === 'undefined' || !document.body) return null;
    var mo = new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) {
        var added = records[r].addedNodes;
        for (var n = 0; n < added.length; n++) {
          var node = added[n];
          if (node.nodeType !== 1) continue;
          upgrade(node);
          // The inserted node may be a container holding matching descendants.
          if (node.querySelectorAll) {
            var inner = node.querySelectorAll('select[data-liveselect],[data-liveselect-mount]');
            for (var k = 0; k < inner.length; k++) upgrade(inner[k]);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return mo;
  }

  function start() { mountAll(); observe(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Expose for dynamic content (e.g. after AJAX inserts new markup) and tests.
  glob().LiveSelectAuto = {
    mountAll: mountAll,
    mountOne: mountOne,
    enhanceOne: enhanceOne,
    observe: observe,
  };
}());
