/**
 * dom-processor.js — DOM protocol message processor.
 *
 * Parses the text-based DOM protocol produced by woua programs and applies
 * each message to a live HTML container element.
 *
 * Protocol (each message is a single newline-terminated line):
 *   <tag id="ID" attr="val".../>              — upsert element (self-closing)
 *   <tag id="ID" attr="val"...>TEXT</tag>     — upsert element with text content
 *   <!clear>                                  — remove all children from root
 *   <!parent ID>                              — set insertion context to element ID
 *   <!parent-root>                            — reset insertion context to root
 *   <!remove ID>                              — remove element with id ID
 *   <!style ID CSS>                           — element.setAttribute('style', CSS)
 *   <!class ID CLASSNAME>                     — element.className = CLASSNAME
 *   <!text ID TEXT>                           — element.textContent = TEXT
 *   <!attr ID NAME VALUE>                     — element.setAttribute(NAME, VALUE)
 *   <!title TEXT>                             — document.title = TEXT
 *   <!css TEXT>                               — append TEXT to a <style id="__wasm-css"> in <head>
 *   <!css-raw PTR LEN>                        — worker reads LEN bytes from WASM memory at PTR, decodes UTF-8, appends to same <style>
 *   <!blob BLOB-ID PTR LEN MIME>              — create Blob from WASM memory[PTR..PTR+LEN], store ObjectURL under BLOB-ID
 *   <!canvas ID W H PTR>                      — (intercepted by worker) create <canvas>; PTR=0 manual, PTR≠0 auto
 *   <!canvas-put ID PTR W H>                  — (intercepted by worker) push RGBA frame to canvas
 *   <!listen ID EVENT>                        — (intercepted by worker) attach event listener on element ID
 *   <!unlisten ID EVENT>                      — (intercepted by worker) remove event listener
 *
 * Attribute values matching 'blob:BLOB-ID' (without '://') are automatically
 * resolved to the registered ObjectURL when the element is upserted.
 *
 * The special id "__root" in directives refers to the root container element.
 *
 * Usage:
 *   import { makeDomProcessor, makeWorkerHandler } from './dom-processor.js';
 */

import { applyListenMessage, EVT_VAL } from './dom-events.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function makeDomProcessor(root, sab, getMemory = null) {
  let insertionParent = root;
  const blobRegistry  = new Map(); // blob-id → ObjectURL
    let styleEl = null; // <style id="__wasm-css"> created on first <!css>

    const RING_DATA   = 4096;

    let sabHeader = new Int32Array(sab, 0, 2);
        let sabData   = new Uint8Array(sab, 8);
 
  const listenerMap = new Map();
  const canvasMap   = new Map(); // id → { ctx, w, h, ptr, auto }
    let   rafRunning  = false;

    let eventArray = null;
    let dataArray = null;

    function select(sea, sda) {

	eventArray = sea;
	dataArray = sda;
    }

  function resolveAttrValue(val) {
    if (val.startsWith('blob:') && !val.includes('://')) {
      const id = val.slice(5);
      if (blobRegistry.has(id)) return blobRegistry.get(id);
      console.warn(`dom-blob: blob '${id}' not yet registered`);
    }
    return val;
  }
    
    function writeEventToRing(text) {

	//console.log("writeEventToRing");
	//console.log(text);
	
	if (!sabHeader) return;
	const bytes = new TextEncoder().encode(text);
	const N     = RING_DATA;
	const wIdx  = Atomics.load(sabHeader, 0);
	const rIdx  = Atomics.load(sabHeader, 1);
	if (N - (wIdx - rIdx) < bytes.length) return;
	for (let i = 0; i < bytes.length; i++) sabData[(wIdx + i) % N] = bytes[i];
	Atomics.store(sabHeader, 0, wIdx + bytes.length);
	Atomics.notify(sabHeader, 0);

	if (eventArray && dataArray) {
	    
	    const fd = 0x7d000000;
	    
	    dataArray[0] = 31|128;

	    dataArray[12] = fd & 0xff;
	    dataArray[13] = (fd >> 8) & 0xff;
	    dataArray[14] = (fd >> 16) & 0xff;
	    dataArray[15] = (fd >> 24) & 0xff;

	    Atomics.store(eventArray, 0, 31|128); // Return select
	    Atomics.notify(eventArray, 0);
	}
    }

    function startRaf() {
	
	if (rafRunning) return;
	
	rafRunning = true;
	
	function rafLoop() {
	    
	    const mem  = getMemory ? getMemory() : null;
	    
	    for (const c of canvasMap.values()) {
		
		if (!c.auto && !mem) continue;
		
		// ImageData doesn't accept SAB-backed TypedArrays (not detachable),
		// so we pre-allocate a regular ImageData once and .set() from SAB each frame.
		if (!c.imageData) c.imageData = new ImageData(c.w, c.h);
		c.imageData.data.set(new Uint8ClampedArray(mem.buffer, c.ptr, c.w * c.h * 4));
		c.ctx.putImageData(c.imageData, 0, 0);
	    }
	    requestAnimationFrame(rafLoop);
	}
	requestAnimationFrame(rafLoop);
  }

  const processMessage = function processMessage(line) {
    line = line.trim();
      if (!line) return;

      console.log(line);

    // ── Directives: <!...> ────────────────────────────────────────────────
    if (line.startsWith('<!')) {
      const inner = line.slice(2, -1).trim();

      if (inner === 'clear') {
        root.innerHTML = '';
        insertionParent = root;
        return;
      }

      if (inner === 'parent-root') {
        insertionParent = root;
        return;
      }

      if (inner.startsWith('remove ')) {
        const el = document.getElementById(inner.slice(7).trim());
        if (el) el.parentNode.removeChild(el);
        return;
      }

      if (inner.startsWith('parent ')) {
        insertionParent = document.getElementById(inner.slice(7).trim()) ?? root;
        return;
      }

      if (inner.startsWith('style ')) {
        const rest = inner.slice(6);
        const sp = rest.indexOf(' ');
        if (sp !== -1) {
          const id = rest.slice(0, sp);
          const el = id === '__root' ? root : document.getElementById(id);
          el?.setAttribute('style', rest.slice(sp + 1));
        }
        return;
      }

      if (inner.startsWith('class ')) {
        const rest = inner.slice(6);
        const sp = rest.indexOf(' ');
        if (sp !== -1) {
          const id = rest.slice(0, sp);
          const el = id === '__root' ? root : document.getElementById(id);
          if (el) el.className = rest.slice(sp + 1);
        }
        return;
      }

      if (inner.startsWith('text ')) {
        const rest = inner.slice(5);
        const sp   = rest.indexOf(' ');
        const id   = sp !== -1 ? rest.slice(0, sp) : rest;
        const text = sp !== -1 ? rest.slice(sp + 1) : '';
        const el   = id === '__root' ? root : document.getElementById(id);
        if (el) el.textContent = text;
        return;
      }

      if (inner.startsWith('attr ')) {
        // <!attr ID NAME VALUE>
        const rest = inner.slice(5);
        const sp1 = rest.indexOf(' ');
        if (sp1 !== -1) {
          const id    = rest.slice(0, sp1);
          const rest2 = rest.slice(sp1 + 1);
          const sp2   = rest2.indexOf(' ');
          if (sp2 !== -1) {
            const el = id === '__root' ? root : document.getElementById(id);
            el?.setAttribute(rest2.slice(0, sp2), rest2.slice(sp2 + 1));
          }
        }
        return;
      }

	if (inner.startsWith('title ')) {
	    
            const text = inner.slice(6);

	    console.log("TITLE!!!");

	    console.log(root);
	    console.log(root.parentNode);

	    if (root.parentNode.firstChild && root.parentNode.firstChild.id == "deco") {
		
		const deco = root.parentNode.firstChild;
		
		const title = deco.getElementsByClassName("title")[0];

		if (title) {

		    title.innerHTML = text;
		}
	    }
	  
        return;
      }

	if (inner.startsWith('css-raw ')) {

	    const parts = inner.slice(8).split(' ');
	    
            if (parts.length === 2) {
		const ptr  = parseInt(parts[0], 10);
		const len  = parseInt(parts[1], 10);
		const copy = new Uint8Array(len);
		const mem  = getMemory ? getMemory() : null;
		copy.set(new Uint8Array(mem.buffer, ptr, len));
		const css = new TextDecoder().decode(copy);
		
		if (!styleEl) {
		    styleEl = document.createElement('style');
		    styleEl.id = '__wasm-css';
		    document.head.appendChild(styleEl);
		}
		
		styleEl.textContent += css + '\n';
            
	    }
	    return;
	}

      if (inner.startsWith('blob ')) {
        // <!blob BLOB-ID PTR LEN MIME>
        const rest = inner.slice(5);
        const sp1  = rest.indexOf(' ');
        if (sp1 === -1) return;
        const blobId = rest.slice(0, sp1);
        const rest2  = rest.slice(sp1 + 1);
        const sp2    = rest2.indexOf(' ');
        if (sp2 === -1) return;
        const ptr   = parseInt(rest2.slice(0, sp2), 10);
        const rest3 = rest2.slice(sp2 + 1);
        const sp3   = rest3.indexOf(' ');
        if (sp3 === -1) return;
        const len  = parseInt(rest3.slice(0, sp3), 10);
        const mime = rest3.slice(sp3 + 1);
        const mem  = getMemory ? getMemory() : null;
        if (!mem) { console.warn(`dom-blob: memory not available for blob '${blobId}'`); return; }
        const bytes = new Uint8Array(len);
        bytes.set(new Uint8Array(mem.buffer, ptr, len));
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        blobRegistry.set(blobId, url);
        return;
      }

      if (inner.startsWith('listen ') || inner.startsWith('unlisten ')) {
        const isListen = inner.startsWith('listen ');
        const inner2    = inner.slice(isListen ? 7 : 9);
        const sp       = inner2.indexOf(' ');
          if (sp >= 0) {
	      
          applyListenMessage({
            type:    isListen ? 'listen' : 'unlisten',
            elemId:  inner2.slice(0, sp),
            evtCode: parseInt(inner2.slice(sp + 1), 10),
          }, listenerMap, writeEventToRing);
        }
        return;
      }

	if (inner.startsWith('getval ')) {

	    const elemId = inner.slice(7);
	    
            const val = encodeURIComponent(document.getElementById(elemId)?.value ?? '');
            writeEventToRing(`${elemId}\t${EVT_VAL}\t0\t0\t0\t${val}\n`);
            return;
	}

	// <!canvas-put ID PTR W H> — copy pixels from WASM memory, post transferable.
      if (inner.startsWith('canvas-put ')) {
        const inner2 = inner.slice(11);
        const parts = inner2.split(' ');
        if (parts.length === 4) {
          const id  = parts[0];
          const ptr = parseInt(parts[1], 10);
          const w   = parseInt(parts[2], 10);
          const h   = parseInt(parts[3], 10);
            const bytes = new Uint8Array(w * h * 4);
	    const mem  = getMemory ? getMemory() : null;
          bytes.set(new Uint8Array(mem.buffer, ptr, w * h * 4));
            //self.postMessage({ type: 'canvas-put', id, buffer: bytes.buffer, w, h }, [bytes.buffer]);

	    const c = canvasMap.get(id);
	    c.ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer), w, h), 0, 0);
	    
        }
        return;
      }

      // <!canvas ID W H PTR> — ask main thread to create the canvas element.
      if (inner.startsWith('canvas ')) {
        const inner2 = inner.slice(7);
        const parts = inner2.split(' ');
        if (parts.length === 4) {
          const id  = parts[0];
          const w   = parseInt(parts[1], 10);
          const h   = parseInt(parts[2], 10);
          const ptr = parseInt(parts[3], 10);
          canvasMap.set(id, { ptr, w, h, auto: ptr !== 0 });
            //self.postMessage({ type: 'canvas', id, w, h, ptr });

	    let el = document.getElementById(id);
        if (!el) {
          el = document.createElement('canvas');
          el.id = id;
          root.appendChild(el);
        }
        el.width  = w;
        el.height = h;
        canvasMap.set(id, { ctx: el.getContext('2d'), w: w, h: h, ptr: ptr, auto: ptr !== 0 });
        if (ptr !== 0) startRaf();
        }
        return;
      }

      return; // unknown directive — ignore
    }

    // ── HTML elements ─────────────────────────────────────────────────────
    let tagName, attrsStr, textContent = null;

    const fullMatch = line.match(
      /^<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*)>([^<]*)<\/[a-zA-Z][a-zA-Z0-9]*>$/
    );
    if (fullMatch) {
      [, tagName, attrsStr, textContent] = fullMatch;
    } else {
      const selfMatch = line.match(/^<([a-zA-Z][a-zA-Z0-9]*)\s*(.*?)\s*\/>$/);
      if (!selfMatch) return;
      [, tagName, attrsStr] = selfMatch;
    }

    const attrRe = /([a-zA-Z][a-zA-Z0-9_:-]*)="([^"]*)"/g;
    const attrs  = {};
    let m;
    while ((m = attrRe.exec(attrsStr)) !== null) attrs[m[1]] = m[2];

    const id = attrs['id'];
    if (!id) return; // id is required by protocol

    let el = document.getElementById(id);
    if (!el) {
      const inSvg = insertionParent instanceof SVGElement;
      el = (inSvg || tagName === 'svg')
        ? document.createElementNS(SVG_NS, tagName)
        : document.createElement(tagName);
      insertionParent.appendChild(el);
    }

    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, resolveAttrValue(value));
    if (textContent !== null) el.textContent = textContent;
  };

    return [ processMessage, select, writeEventToRing ];
}

