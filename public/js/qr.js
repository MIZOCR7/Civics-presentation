/* ==========================================================================
   Tiny QR code generator - no dependencies, works fully offline.

   Byte mode, error-correction level M, versions 1-10. Enough for a join URL
   on screen. Exposes:
     QR.make(text)            -> { size, modules: boolean[][] }  (true = dark)
     QR.draw(canvas, text)    -> paints the code with a quiet zone
   ========================================================================== */

(function (global) {
  'use strict';

  /* ------------------------------------------------------------ GF(256) math */

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // Generator polynomial g(x) = (x - a^0)(x - a^1)...(x - a^(deg-1)).
  function genPoly(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  // Reed-Solomon remainder (the error-correction codewords).
  function ecCodewords(data, ecLen) {
    const gen = genPoly(ecLen);
    const res = new Array(ecLen).fill(0);
    for (let k = 0; k < data.length; k++) {
      const factor = data[k] ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (let i = 0; i < ecLen; i++) res[i] ^= mul(gen[i + 1], factor);
      }
    }
    return res;
  }

  /* ----------------------------------------------------- version tables (M) */
  // version -> [ec codewords per block, [[block count, data codewords], ...]]
  const EC_M = {
    1: [10, [[1, 16]]],
    2: [16, [[1, 28]]],
    3: [26, [[1, 44]]],
    4: [18, [[2, 32]]],
    5: [24, [[2, 43]]],
    6: [16, [[4, 27]]],
    7: [18, [[4, 31]]],
    8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]],
  };

  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  const dataCodewordCount = (v) =>
    EC_M[v][1].reduce((n, [count, len]) => n + count * len, 0);

  function fitVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      const countBits = v <= 9 ? 8 : 16;
      if (4 + countBits + byteLen * 8 <= dataCodewordCount(v) * 8) return v;
    }
    return null;
  }

  /* ------------------------------------------------------------- bit stream */

  function toUtf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return Uint8Array.from(out);
  }

  function encode(v, bytes) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };

    push(4, 4);                                  // byte mode indicator
    push(bytes.length, v <= 9 ? 8 : 16);         // character count
    for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);

    const cap = dataCodewordCount(v) * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0); // terminator
    while (bits.length % 8 !== 0) bits.push(0);
    const pads = [0xec, 0x11];
    for (let k = 0; bits.length < cap; k++) push(pads[k % 2], 8);

    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      words.push(b);
    }
    return words;
  }

  function interleave(v, data) {
    const [ecLen, groups] = EC_M[v];
    const blocks = [];
    let offset = 0;
    for (const [count, len] of groups) {
      for (let i = 0; i < count; i++) {
        const chunk = data.slice(offset, offset + len);
        offset += len;
        blocks.push({ data: chunk, ec: ecCodewords(chunk, ecLen) });
      }
    }
    const maxData = Math.max(...blocks.map((b) => b.data.length));
    const out = [];
    for (let i = 0; i < maxData; i++) {
      for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
    }
    for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]);
    return out;
  }

  /* ---------------------------------------------------------------- matrix */

  function bchDigit(n) {
    let digit = 0;
    while (n !== 0) { digit++; n >>>= 1; }
    return digit;
  }

  function typeInfoBits(mask) {
    // error level M = 00
    const data = (0 << 3) | mask;
    let d = data << 10;
    const G15 = 0x537;
    while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
    return ((data << 10) | d) ^ 0x5412;
  }

  function typeNumberBits(v) {
    let d = v << 12;
    const G18 = 0x1f25;
    while (bchDigit(d) - bchDigit(G18) >= 0) d ^= G18 << (bchDigit(d) - bchDigit(G18));
    return (v << 12) | d;
  }

  const MASK = [
    (i, j) => (i + j) % 2 === 0,
    (i) => i % 2 === 0,
    (i, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
    (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
  ];

  function penalty(modules, size) {
    let score = 0;

    // Rule 1 - runs of five or more same-colour modules.
    for (let a = 0; a < size; a++) {
      for (const vertical of [false, true]) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          const cur = vertical ? modules[b][a] : modules[a][b];
          const prev = vertical ? modules[b - 1][a] : modules[a][b - 1];
          if (cur === prev) run++;
          else { if (run >= 5) score += 3 + (run - 5); run = 1; }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }

    // Rule 2 - 2x2 blocks of one colour.
    for (let i = 0; i < size - 1; i++) {
      for (let j = 0; j < size - 1; j++) {
        const c = modules[i][j];
        if (c === modules[i][j + 1] && c === modules[i + 1][j] && c === modules[i + 1][j + 1]) score += 3;
      }
    }

    // Rule 3 - finder-like patterns.
    const finderA = [true, false, true, true, true, false, true, false, false, false, false];
    const finderB = [false, false, false, false, true, false, true, true, true, false, true];
    const matches = (arr, from) => {
      for (let k = 0; k < 11; k++) if (arr[from + k] !== finderA[k]) return false;
      return true;
    };
    const matchesB = (arr, from) => {
      for (let k = 0; k < 11; k++) if (arr[from + k] !== finderB[k]) return false;
      return true;
    };
    for (let i = 0; i < size; i++) {
      const row = modules[i];
      const col = modules.map((r) => r[i]);
      for (let j = 0; j + 11 <= size; j++) {
        if (matches(row, j) || matchesB(row, j)) score += 40;
        if (matches(col, j) || matchesB(col, j)) score += 40;
      }
    }

    // Rule 4 - deviation from a 50/50 dark ratio.
    let dark = 0;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) if (modules[i][j]) dark++;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  function build(v, codewords) {
    const size = v * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));

    // Finder patterns + separators.
    const finder = (row, col) => {
      for (let i = -1; i <= 7; i++) {
        for (let j = -1; j <= 7; j++) {
          const r = row + i, c = col + j;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          fixed[r][c] = true;
          const ring = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6));
          const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
          modules[r][c] = ring || core;
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    // Timing patterns.
    for (let i = 8; i < size - 8; i++) {
      modules[6][i] = i % 2 === 0; fixed[6][i] = true;
      modules[i][6] = i % 2 === 0; fixed[i][6] = true;
    }

    // Alignment patterns.
    const centers = ALIGN[v];
    for (const r of centers) {
      for (const c of centers) {
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
        for (let i = -2; i <= 2; i++) {
          for (let j = -2; j <= 2; j++) {
            fixed[r + i][c + j] = true;
            modules[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
          }
        }
      }
    }

    // Format info areas (written later) and the always-dark module.
    for (let i = 0; i < 9; i++) {
      if (i !== 6) { fixed[8][i] = true; fixed[i][8] = true; }
    }
    for (let i = 0; i < 8; i++) {
      fixed[8][size - 1 - i] = true;
      fixed[size - 1 - i][8] = true;
    }
    fixed[size - 8][8] = true;
    modules[size - 8][8] = true;

    // Version info (versions 7+).
    if (v >= 7) {
      const bits = typeNumberBits(v);
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >> i) & 1) === 1;
        modules[Math.floor(i / 3)][i % 3 + size - 11] = bit;
        fixed[Math.floor(i / 3)][i % 3 + size - 11] = true;
        modules[i % 3 + size - 11][Math.floor(i / 3)] = bit;
        fixed[i % 3 + size - 11][Math.floor(i / 3)] = true;
      }
    }

    // Data placement, bottom-right, two columns at a time, zig-zag.
    const bits = [];
    for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push(((cw >> i) & 1) === 1);
    let idx = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (let k = 0; k < 2; k++) {
          const c = col - k;
          if (fixed[row][c]) continue;
          modules[row][c] = idx < bits.length ? bits[idx] : false;
          idx++;
        }
      }
      upward = !upward;
    }

    // Choose the mask that scores best.
    let best = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const trial = modules.map((row) => row.slice());
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          if (!fixed[i][j] && MASK[mask](i, j)) trial[i][j] = !trial[i][j];
        }
      }
      writeFormat(trial, fixed, size, mask);
      const score = penalty(trial, size);
      if (score < bestScore) { bestScore = score; best = trial; }
    }
    return best || modules;
  }

  function writeFormat(modules, fixed, size, mask) {
    const bits = typeInfoBits(mask);
    for (let i = 0; i < 15; i++) {
      const bit = ((bits >> i) & 1) === 1;
      if (i < 6) modules[i][8] = bit;
      else if (i < 8) modules[i + 1][8] = bit;
      else modules[size - 15 + i][8] = bit;

      if (i < 8) modules[8][size - i - 1] = bit;
      else if (i < 9) modules[8][15 - i] = bit;
      else modules[8][15 - i - 1] = bit;
    }
    modules[size - 8][8] = true;
  }

  /* ----------------------------------------------------------------- public */

  function make(text) {
    const bytes = toUtf8(String(text));
    const v = fitVersion(bytes.length);
    if (!v) throw new Error('QR: text too long (' + bytes.length + ' bytes)');
    const words = interleave(v, encode(v, bytes));
    return { version: v, size: v * 4 + 17, modules: build(v, words) };
  }

  function draw(canvas, text, opts) {
    const o = opts || {};
    const dark = o.dark || '#1b1035';
    const light = o.light || '#ffffff';
    const quiet = o.quiet == null ? 4 : o.quiet;
    const code = make(text);
    const total = code.size + quiet * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const target = o.size || canvas.clientWidth || 240;
    const scale = Math.max(1, Math.floor((target * dpr) / total));
    const px = total * scale;

    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = dark;
    for (let i = 0; i < code.size; i++) {
      for (let j = 0; j < code.size; j++) {
        if (code.modules[i][j]) {
          ctx.fillRect((j + quiet) * scale, (i + quiet) * scale, scale, scale);
        }
      }
    }
    return code;
  }

  global.QR = { make, draw };
})(window);
