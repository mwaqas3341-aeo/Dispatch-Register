/**
 * Dispatch Register — Client-Side Compression Pipeline
 * ----------------------------------------------------------------
 * Included in index.html via:
 *
 *   <script src="compression.js"></script>
 *
 * Usage (see index.html handleFileSelect / submitDispatch):
 *
 *   DRCompress.compressFile(file, function (pct, msg) {
 *     // pct: 0-100, msg: short status string — update a progress bar
 *   }).then(function (result) {
 *     // result.file   -> File to actually upload (compressed OR original)
 *     // result.report -> { fileName, method, originalSize, finalSize,
 *     //                     savedBytes, ratio, statusText, ...H (human) }
 *   });
 *
 * WHAT THIS ACTUALLY DOES:
 *
 *  - JPG / JPEG / PNG / WEBP: real, adaptive compression. Downscales
 *    oversized images and re-encodes at a quality level chosen by
 *    trying progressively lower qualities (and, if still too large,
 *    an extra downscale pass) until a good size/readability balance
 *    is reached. Opaque PNGs are additionally compared against a
 *    JPEG re-encode and the smaller of the two (that still looks
 *    right) wins.
 *
 *  - PDF: LIGHT compression only, via pdf-lib re-save with object
 *    stream compaction. This trims object/xref overhead — typically
 *    5-20% on PDFs re-saved from Word/scanners — without touching
 *    embedded images. It does NOT recompress images embedded inside
 *    the PDF; that needs a real PDF engine (e.g. Ghostscript) which
 *    cannot run in a browser. Real shrinkage of large scanned PDFs
 *    would need a server-side step (e.g. a backend endpoint) — out
 *    of scope for this file, which fails safe to the original.
 *
 *  - Anything else (doc/docx/xlsx/xls, unknown types): passed
 *    through unchanged.
 *
 *  Safety guarantees baked in throughout:
 *   - Never returns a file bigger than the original — falls back to
 *     the original whenever a compressed candidate isn't smaller.
 *   - Never throws — any failure (bad image, encrypted/malformed
 *     PDF, missing CDN, etc.) resolves with the original file.
 *   - Keeps the original filename (only the extension changes if a
 *     PNG is converted to JPEG for a worthwhile size win).
 */

(function (global) {
  'use strict';

  var IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  var MAX_DIMENSION      = 2000;   // px — long edge cap for document photos (JPG/WEBP)
  var PNG_MAX_DIMENSION  = 1800;   // PNGs are usually screenshots/scans — cap a bit harder
  var MIN_DIMENSION      = 900;    // never downscale below this — keeps text/stamps legible
  var MIN_QUALITY        = 0.35;   // never go below this JPEG quality — protects readability
  var QUALITY_STEPS      = [0.85, 0.75, 0.65, 0.55, 0.45, MIN_QUALITY];
  var WEBP_QUALITY_STEPS = [0.85, 0.78, 0.70, 0.60, 0.50];

  var SMALL_FILE_SKIP_BYTES = 60 * 1024;   // < 60KB: not worth the CPU/time, pass through
  var SMALL_PDF_SKIP_BYTES  = 80 * 1024;   // < 80KB PDFs are rarely worth re-saving

  var PDFLIB_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  var _pdfLibLoadPromise = null;

  /* ───────────────────────── helpers ───────────────────────── */

  function noop() {}

  function report(cb, pct, msg) {
    try { (cb || noop)(pct, msg); } catch (e) { /* never let UI errors break compression */ }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    var kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    return (kb / 1024).toFixed(2) + ' MB';
  }

  function targetSizeFor(originalSize) {
    // Rough adaptive targets — "as small as reasonably possible while
    // staying readable", not a hard ceiling. Compression stops early
    // once the target is met or the quality/dimension floor is hit.
    if (originalSize > 6 * 1024 * 1024)  return 1.6 * 1024 * 1024;
    if (originalSize > 3 * 1024 * 1024)  return 1.0 * 1024 * 1024;
    if (originalSize > 1 * 1024 * 1024)  return 500 * 1024;
    return Math.round(originalSize * 0.55);
  }

  function loadPdfLib() {
    if (global.PDFLib) return Promise.resolve(global.PDFLib);
    if (_pdfLibLoadPromise) return _pdfLibLoadPromise;
    _pdfLibLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFLIB_CDN;
      s.onload = function () { resolve(global.PDFLib); };
      s.onerror = function () { _pdfLibLoadPromise = null; reject(new Error('Failed to load pdf-lib from CDN')); };
      document.head.appendChild(s);
    });
    return _pdfLibLoadPromise;
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload  = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload  = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob); else reject(new Error('Canvas encode failed'));
      }, mime, quality);
    });
  }

  function drawScaled(img, maxDim) {
    var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas;
  }

  /** Cheap opacity check — samples a grid of pixels rather than the
   *  whole image, so it stays fast even on large scans. */
  function hasTransparency(canvas) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var stepX = Math.max(1, Math.floor(w / 40));
    var stepY = Math.max(1, Math.floor(h / 40));
    for (var y = 0; y < h; y += stepY) {
      var row = ctx.getImageData(0, y, w, 1).data;
      for (var x = 0; x < row.length; x += 4 * stepX) {
        if (row[x + 3] < 250) return true;
      }
    }
    return false;
  }

  /** Progressively re-encodes `canvas` at descending qualities until
   *  the result is at/under targetSize or the quality floor is hit.
   *  Resolves the smallest usable {blob, quality}. */
  function encodeToTarget(canvas, mime, qualitySteps, targetSize, cb, pctStart, pctEnd) {
    var i = 0;
    var best = null;

    function next() {
      if (i >= qualitySteps.length) return Promise.resolve(best);
      var q = qualitySteps[i];
      var pct = pctStart + Math.round((pctEnd - pctStart) * ((i + 1) / qualitySteps.length));
      report(cb, pct, 'Compressing… quality pass ' + (i + 1) + '/' + qualitySteps.length);
      i++;
      return canvasToBlob(canvas, mime, q).then(function (blob) {
        if (!best || blob.size < best.blob.size) best = { blob: blob, quality: q };
        if (blob.size <= targetSize) return best;
        return next();
      });
    }

    return next();
  }

  /** Compresses a single JPG/PNG/WEBP File. Always resolves — never
   *  rejects — falling back to the original file on any failure or
   *  when compression doesn't actually help. */
  function compressImage(file, cb) {
    cb = cb || noop;
    report(cb, 5, 'Reading image…');

    return loadImage(file).then(function (img) {
      var isPng    = file.type === 'image/png';
      var isWebp   = file.type === 'image/webp';
      var maxDim   = isPng ? PNG_MAX_DIMENSION : MAX_DIMENSION;
      var target   = targetSizeFor(file.size);

      report(cb, 15, 'Analyzing image…');

      function tryDimension(dim, pctStart, pctEnd) {
        var canvas = drawScaled(img, dim);

        if (isPng) {
          var transparent = hasTransparency(canvas);
          return canvasToBlob(canvas, 'image/png').then(function (pngBlob) {
            var pngCandidate = { blob: pngBlob, ext: null, mime: 'image/png' };
            if (transparent) {
              return pngCandidate; // must stay PNG to keep transparency
            }
            // Opaque PNG — compare against a JPEG re-encode, which is
            // usually dramatically smaller for scanned documents.
            return encodeToTarget(canvas, 'image/jpeg', QUALITY_STEPS, target, cb, pctStart, pctEnd)
              .then(function (jpegBest) {
                if (jpegBest && jpegBest.blob.size < pngBlob.size) {
                  return { blob: jpegBest.blob, ext: '.jpg', mime: 'image/jpeg' };
                }
                return pngCandidate;
              });
          });
        }

        if (isWebp) {
          return encodeToTarget(canvas, 'image/webp', WEBP_QUALITY_STEPS, target, cb, pctStart, pctEnd)
            .then(function (best) { return { blob: best.blob, ext: null, mime: 'image/webp' }; });
        }

        // JPEG
        return encodeToTarget(canvas, 'image/jpeg', QUALITY_STEPS, target, cb, pctStart, pctEnd)
          .then(function (best) { return { blob: best.blob, ext: null, mime: 'image/jpeg' }; });
      }

      return tryDimension(maxDim, 20, 70).then(function (result) {
        // Still well above target and we have room to shrink further?
        // One extra downscale pass, without dropping below MIN_DIMENSION.
        if (result.blob.size > target && maxDim > MIN_DIMENSION) {
          report(cb, 75, 'Still large — reducing dimensions further…');
          var smallerDim = Math.max(MIN_DIMENSION, Math.round(maxDim * 0.8));
          return tryDimension(smallerDim, 80, 95).then(function (r2) {
            return r2.blob.size < result.blob.size ? r2 : result;
          });
        }
        return result;
      }).then(function (best) {
        report(cb, 98, 'Finalizing…');
        if (best.blob.size >= file.size) {
          return file; // compression didn't actually help — keep original
        }
        var name = best.ext ? file.name.replace(/\.[^.]+$/, '') + best.ext : file.name;
        return new File([best.blob], name, { type: best.mime, lastModified: Date.now() });
      });
    }).catch(function () {
      // Anything goes wrong decoding/encoding — fail safe, keep original.
      return file;
    });
  }

  /** Light, lossless PDF re-save via pdf-lib (object-stream compaction).
   *  Always resolves — falls back to the original on any error,
   *  including encrypted/malformed/unsupported PDFs. */
  function compressPdf(file, cb) {
    cb = cb || noop;

    if (file.size < SMALL_PDF_SKIP_BYTES) {
      report(cb, 100, 'Already compact — no changes needed');
      return Promise.resolve(file);
    }

    report(cb, 10, 'Loading PDF engine…');
    return loadPdfLib().then(function (PDFLib) {
      report(cb, 35, 'Reading PDF…');
      return readAsArrayBuffer(file).then(function (buf) {
        return PDFLib.PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: false })
          .then(function (doc) {
            report(cb, 65, 'Optimizing PDF structure…');
            return doc.save({ useObjectStreams: true }).then(function (bytes) {
              report(cb, 95, 'Finalizing…');
              if (bytes.byteLength >= file.size) return file;
              return new File([bytes], file.name, { type: 'application/pdf', lastModified: Date.now() });
            });
          });
      });
    }).catch(function () {
      // pdf-lib failed to load/parse (e.g. encrypted or malformed PDF) — keep original.
      return file;
    });
  }

  /**
   * Main entry point.
   * @param {File} file
   * @param {function(number,string)} [onProgress] — called with (0-100, statusText)
   * @returns {Promise<{file: File, report: object}>} — always resolves
   */
  function compressFile(file, onProgress) {
    var cb = onProgress || noop;
    var originalSize = file.size;

    report(cb, 0, 'Starting…');

    var work;
    var method;

    if (!file || !file.size) {
      work = Promise.resolve(file);
      method = 'passthrough';
    } else if (IMAGE_TYPES.indexOf(file.type) !== -1) {
      if (originalSize < SMALL_FILE_SKIP_BYTES) {
        report(cb, 100, 'Already small — no compression needed');
        work = Promise.resolve(file);
        method = 'skipped-small';
      } else {
        method = 'image-adaptive';
        work = compressImage(file, cb);
      }
    } else if (file.type === 'application/pdf') {
      method = 'pdf-light';
      work = compressPdf(file, cb);
    } else {
      report(cb, 100, 'Format not compressible client-side — using original');
      method = 'passthrough';
      work = Promise.resolve(file);
    }

    return work.then(function (finalFile) {
      var finalSize   = finalFile.size;
      var savedBytes  = Math.max(0, originalSize - finalSize);
      var ratio       = originalSize > 0 ? +(savedBytes / originalSize).toFixed(3) : 0;
      var didCompress = finalFile !== file && finalSize < originalSize;

      var statusText = didCompress
        ? 'Ready to upload'
        : (method === 'skipped-small'
            ? 'Compression not required — original file retained'
            : 'Compression unavailable — original file will be uploaded');

      report(cb, 100, statusText);

      return {
        file: finalFile,
        report: {
          fileName:      finalFile.name,
          method:        method,
          didCompress:   didCompress,
          originalSize:  originalSize,
          finalSize:     finalSize,
          savedBytes:    savedBytes,
          ratio:         ratio,
          percent:       Math.round(ratio * 1000) / 10,
          originalSizeH: formatBytes(originalSize),
          finalSizeH:    formatBytes(finalSize),
          savedBytesH:   formatBytes(savedBytes),
          statusText:    statusText
        }
      };
    }).catch(function () {
      // Absolute last-resort safety net — never block the user's submission.
      report(cb, 100, 'Compression unavailable — original file will be uploaded');
      return {
        file: file,
        report: {
          fileName: file.name, method: 'error', didCompress: false,
          originalSize: originalSize, finalSize: originalSize, savedBytes: 0, ratio: 0, percent: 0,
          originalSizeH: formatBytes(originalSize), finalSizeH: formatBytes(originalSize),
          savedBytesH: formatBytes(0), statusText: 'Compression unavailable — original file will be uploaded'
        }
      };
    });
  }

  global.DRCompress = {
    compressFile:  compressFile,
    compressImage: compressImage,
    compressPdf:   compressPdf,
    formatBytes:   formatBytes
  };

})(window);
