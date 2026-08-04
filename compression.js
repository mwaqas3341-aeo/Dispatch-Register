/**
 * Dispatch Register — Client-Side Compression Pipeline (Phase 2)
 * ----------------------------------------------------------------
 * Drop this file next to index.html and include it BEFORE your existing
 * script block:
 *
 *   <script src="compression.js"></script>
 *
 * Then, wherever the app currently reads the picked file (in index.html,
 * search for `_pendingFile` / `reader.readAsDataURL`), replace the raw
 * file with the compressed one before it's turned into base64:
 *
 *   DRCompress.compressFile(_pendingFile).then(function (result) {
 *     _pendingFile = result.file;          // compressed File object
 *     console.log(result.report);          // { originalSize, finalSize, ratio, method }
 *     // ...continue with the existing readAsDataURL logic unchanged...
 *   });
 *
 * WHAT THIS ACTUALLY DOES (read before assuming it's magic):
 *
 *  - JPG / JPEG / PNG / WEBP: real compression. Downscales oversized
 *    images and re-encodes at a quality level tuned per type, using the
 *    Canvas API. Typically 40-85% smaller with no visible quality loss
 *    for document photos.
 *
 *  - PDF: LIGHT compression only. This uses pdf-lib to re-save the PDF
 *    with object-stream compaction, which trims maybe 5-15% off PDFs
 *    that were saved inefficiently (e.g. re-saved from Word/scanners).
 *    It does NOT recompress images embedded inside the PDF — that needs
 *    a real PDF engine (e.g. Ghostscript) which cannot run in a browser.
 *    If you need real PDF shrinkage (large scanned PDFs), that has to be
 *    a server-side step — e.g. a Supabase Edge Function — not this file.
 *
 *  - Anything else: passed through unchanged.
 */

(function (global) {
  'use strict';

  var IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  var MAX_DIMENSION = 2000;        // px — long edge cap for document photos
  var JPEG_QUALITY = 0.78;         // 0-1, good balance for text/document photos
  var WEBP_QUALITY = 0.80;
  var PNG_MAX_DIMENSION = 1800;    // PNGs are usually screenshots/scans — cap harder

  var PDFLIB_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  var _pdfLibLoadPromise = null;

  function loadPdfLib() {
    if (global.PDFLib) return Promise.resolve(global.PDFLib);
    if (_pdfLibLoadPromise) return _pdfLibLoadPromise;
    _pdfLibLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFLIB_CDN;
      s.onload = function () { resolve(global.PDFLib); };
      s.onerror = function () { reject(new Error('Failed to load pdf-lib from CDN')); };
      document.head.appendChild(s);
    });
    return _pdfLibLoadPromise;
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
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

  /** Compresses a single JPG/PNG/WEBP File. Returns a File (or the
   *  original if compression didn't actually help). */
  function compressImage(file) {
    return loadImage(file).then(function (img) {
      var maxDim = (file.type === 'image/png') ? PNG_MAX_DIMENSION : MAX_DIMENSION;
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var w = Math.round(img.width * scale);
      var h = Math.round(img.height * scale);

      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      var outMime = (file.type === 'image/png') ? 'image/png' : file.type;
      var quality = (outMime === 'image/webp') ? WEBP_QUALITY
                  : (outMime === 'image/png') ? undefined   // PNG is lossless; quality arg ignored
                  : JPEG_QUALITY;

      return canvasToBlob(canvas, outMime, quality).then(function (blob) {
        if (blob.size >= file.size) {
          // Compression didn't help (rare, e.g. already-tiny images) — keep original
          return file;
        }
        return new File([blob], file.name, { type: outMime, lastModified: Date.now() });
      });
    }).catch(function () {
      // If anything goes wrong decoding the image, fail safe and keep the original
      return file;
    });
  }

  /** Light, lossless-ish PDF re-save via pdf-lib. See file header for
   *  what this can and can't do. */
  function compressPdf(file) {
    return loadPdfLib().then(function (PDFLib) {
      return readAsArrayBuffer(file).then(function (buf) {
        return PDFLib.PDFDocument.load(buf, { updateMetadata: false }).then(function (doc) {
          return doc.save({ useObjectStreams: true }).then(function (bytes) {
            if (bytes.byteLength >= file.size) return file;
            return new File([bytes], file.name, { type: 'application/pdf', lastModified: Date.now() });
          });
        });
      });
    }).catch(function () {
      // pdf-lib failed to load or parse (e.g. encrypted/malformed PDF) — keep original
      return file;
    });
  }

  /**
   * Main entry point.
   * @param {File} file
   * @returns {Promise<{file: File, report: object}>}
   */
  function compressFile(file) {
    var originalSize = file.size;
    var work;
    var method;

    if (IMAGE_TYPES.indexOf(file.type) !== -1) {
      method = 'image-canvas';
      work = compressImage(file);
    } else if (file.type === 'application/pdf') {
      method = 'pdf-light';
      work = compressPdf(file);
    } else {
      method = 'passthrough';
      work = Promise.resolve(file);
    }

    return work.then(function (finalFile) {
      var finalSize = finalFile.size;
      return {
        file: finalFile,
        report: {
          fileName: file.name,
          method: method,
          originalSize: originalSize,
          finalSize: finalSize,
          savedBytes: originalSize - finalSize,
          ratio: originalSize > 0 ? +(1 - finalSize / originalSize).toFixed(3) : 0
        }
      };
    });
  }

  global.DRCompress = {
    compressFile: compressFile,
    compressImage: compressImage,
    compressPdf: compressPdf
  };

})(window);
