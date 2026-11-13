const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** Minimal stubs so pdfjs can load in Node / Vercel Functions. */
function ensurePdfDomShims() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    };
  }
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
  }
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {};
  }
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s().-]*)?\d{3}[\s().-]*\d{4}\b/g;
const LOCATION_RE =
  /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.']+){0,3}),\s*([A-Z]{2}|[A-Z][a-zA-Z]+)\b/g;
const TITLE_HINT_RE =
  /\b(engineer|developer|manager|designer|analyst|consultant|director|lead|architect|specialist|recruiter|coordinator|scientist|founder|ceo|cto|intern|assistant|officer|full[-\s]?stack|front[-\s]?end|back[-\s]?end)\b/i;
const PIPE_SPLIT_RE = /\s*[|•·]\s*/;
const SECTION_HEADER_RE =
  /^(summary|experience|education|skills|projects|work history|employment|certifications|awards|languages)\b/i;

/**
 * Parse an uploaded resume and extract team-member fields.
 * Returns only structured fields — never the full resume body.
 */
export async function parseResumeFile({
  filename = '',
  contentType = '',
  dataBase64 = '',
}) {
  if (!dataBase64) throw new Error('Resume file data is required.');

  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.length) throw new Error('Resume file is empty.');
  if (buffer.length > MAX_RESUME_BYTES) {
    throw new Error('Resume must be 10MB or smaller.');
  }

  const kind = detectKind(filename, contentType);
  const text = await extractText(buffer, kind);
  if (!text.trim()) {
    throw new Error('Could not read text from that resume.');
  }

  const fields = extractMemberFields(text, filename);
  if (!fields.name && !fields.email && !fields.phone_number) {
    throw new Error(
      'Could not find name, email, or phone in that resume. Fill the form manually.',
    );
  }

  return {
    ...fields,
    source: kind,
  };
}

export function extractMemberFields(rawText, filename = '') {
  const text = normalizeResumeText(rawText);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const headerLines = lines.slice(0, 12);
  const headerText = headerLines.join('\n');
  const contact = parseContactFromHeader(headerLines, headerText);

  const email =
    contact.email ||
    firstMatch(headerText, EMAIL_RE) ||
    firstMatch(text, EMAIL_RE) ||
    '';
  const phone_number = cleanPhone(
    contact.phone ||
      firstMatch(headerText, PHONE_RE) ||
      firstMatch(text, PHONE_RE) ||
      '',
  );
  const location =
    contact.location ||
    extractLocation(headerLines) ||
    extractLocation(lines.slice(0, 8)) ||
    '';
  const name =
    extractName(headerLines, email) ||
    nameFromFilename(filename) ||
    '';
  const professional_title =
    extractTitle(headerLines, name, email) ||
    contact.title ||
    '';

  return {
    name: titleCaseName(name),
    professional_title: cleanTitle(professional_title),
    email: String(email || '').toLowerCase(),
    phone_number,
    location,
  };
}

function detectKind(filename, contentType) {
  const lowerName = String(filename || '').toLowerCase();
  const type = String(contentType || '').toLowerCase();

  if (lowerName.endsWith('.pdf') || type.includes('pdf')) return 'pdf';
  if (
    lowerName.endsWith('.docx') ||
    type.includes('wordprocessingml') ||
    type.includes('officedocument.wordprocessingml')
  ) {
    return 'docx';
  }
  if (lowerName.endsWith('.doc') || type.includes('msword')) {
    throw new Error('DOC files are not supported. Upload PDF, DOCX, or TXT.');
  }
  if (lowerName.endsWith('.txt') || type.includes('text/plain')) return 'txt';

  return 'txt';
}

async function extractPdfText(buffer) {
  ensurePdfDomShims();
  const [{ createRequire }, { pathToFileURL }, pdfjs] = await Promise.all([
    import('node:module'),
    import('node:url'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  ]);
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent({
        includeMarkedContent: false,
      });
      pages.push(rebuildPdfLines(content.items || []));

      // mailto: links often hold the email when text is styled/vectorized.
      try {
        const annotations = await page.getAnnotations({ intent: 'display' });
        for (const ann of annotations || []) {
          const uri = String(ann?.url || ann?.unsafeUrl || '');
          const mail = uri.match(/^mailto:([^?]+)/i);
          if (mail?.[1]) pages.push(decodeURIComponent(mail[1]).trim());
        }
      } catch {
        // Annotations optional.
      }
    }
    return pages.filter(Boolean).join('\n');
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/** Group pdfjs text items into visual lines using Y position. */
function rebuildPdfLines(items) {
  const rows = [];
  for (const item of items) {
    const str = item && typeof item.str === 'string' ? item.str : '';
    if (!str.trim() && str !== ' ') continue;
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    const row = rows.find((r) => Math.abs(r.y - y) <= 3.5);
    if (row) {
      row.parts.push({ x, str });
    } else {
      rows.push({ y, parts: [{ x, str }] });
    }
  }

  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd = null;
      for (const part of row.parts) {
        const gap = prevEnd == null ? 0 : part.x - prevEnd;
        if (prevEnd != null && gap > 1.2 && !line.endsWith(' ') && !part.str.startsWith(' ')) {
          line += ' ';
        }
        line += part.str;
        prevEnd = part.x + estimateWidth(part.str);
      }
      return line.replace(/[ \t]{2,}/g, ' ').trim();
    })
    .filter(Boolean)
    .join('\n');
}

function estimateWidth(str) {
  return String(str || '').length * 5;
}

async function extractText(buffer, kind) {
  if (kind === 'pdf' || buffer.slice(0, 4).toString() === '%PDF') {
    return extractPdfText(buffer);
  }

  if (kind === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return String(result?.value || '');
  }

  return buffer.toString('utf8');
}

function normalizeResumeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function firstMatch(text, re) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const matcher = new RegExp(re.source, flags);
  const match = matcher.exec(String(text || ''));
  return match ? match[0].trim() : '';
}

function cleanPhone(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\s*[|•].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Keep intentional casing for mixed names; normalize ALL CAPS / all lower.
  if (raw === raw.toUpperCase() || raw === raw.toLowerCase()) {
    return raw
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return raw;
}

function parseContactFromHeader(lines, headerText) {
  const result = { email: '', phone: '', location: '', title: '' };
  for (const line of lines) {
    if (!PIPE_SPLIT_RE.test(line) && !EMAIL_RE.test(line) && !PHONE_RE.test(line)) {
      continue;
    }
    const parts = line.split(PIPE_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (!result.email) {
        const email = firstMatch(part, EMAIL_RE);
        if (email) {
          result.email = email;
          continue;
        }
      }
      if (!result.phone) {
        const phone = firstMatch(part, PHONE_RE);
        if (phone && /[\d]/.test(phone)) {
          result.phone = phone;
          continue;
        }
      }
      if (!result.location) {
        const loc = firstMatch(part, LOCATION_RE);
        if (loc && !/linkedin|github|http|www\./i.test(part)) {
          result.location = loc;
          continue;
        }
        // "Batangas, Philippines" / "Tampa, FL" / single city+country without regex miss
        if (
          /^[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.']+)*,\s*[A-Za-z].+$/.test(part) &&
          !EMAIL_RE.test(part) &&
          !PHONE_RE.test(part) &&
          !/linkedin|github|http|www\./i.test(part)
        ) {
          result.location = part;
        }
      }
    }
  }

  if (!result.email) result.email = firstMatch(headerText, EMAIL_RE) || '';
  if (!result.phone) result.phone = firstMatch(headerText, PHONE_RE) || '';
  return result;
}

function isNameLine(line, email) {
  if (!line || line === email) return false;
  if (SECTION_HEADER_RE.test(line)) return false;
  if (EMAIL_RE.test(line) || PHONE_RE.test(line)) return false;
  if (/linkedin|github|portfolio|http|www\./i.test(line)) return false;
  if (/^(resume|curriculum vitae|cv)\b/i.test(line)) return false;
  if (line.length < 3 || line.length > 80) return false;
  if (/^\d/.test(line)) return false;
  if (PIPE_SPLIT_RE.test(line)) return false;

  const words = line.split(/\s+/);
  if (words.length < 1 || words.length > 6) return false;
  // Allow letters, periods, apostrophes, hyphens (ALL CAPS ok).
  if (!words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word))) return false;
  // Titles like "Senior Software Engineer" should not be treated as names.
  if (TITLE_HINT_RE.test(line) && words.length >= 2) return false;
  return true;
}

function extractName(lines, email) {
  for (const line of lines.slice(0, 10)) {
    if (isNameLine(line, email)) return line.trim();
  }
  return '';
}

function extractTitle(lines, name, email) {
  const start = Math.max(
    0,
    lines.findIndex(
      (line) =>
        line === name || titleCaseName(line) === titleCaseName(name),
    ),
  );
  // Only inspect the short band under the name (before contact / sections).
  const window = [];
  for (const line of lines.slice(start, start + 6)) {
    if (line === name) continue;
    if (SECTION_HEADER_RE.test(line)) break;
    if (PIPE_SPLIT_RE.test(line) && (EMAIL_RE.test(line) || PHONE_RE.test(line))) {
      break;
    }
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) break;
    window.push(line);
  }

  for (const line of window) {
    if (!line || line === email) continue;
    if (/linkedin|github|http|www\./i.test(line)) continue;
    if (LOCATION_RE.test(line) && !TITLE_HINT_RE.test(line)) continue;
    // Avoid summary sentences mistaken for titles.
    if (line.length > 80 || line.includes('. ')) continue;
    if (line.endsWith('.') && line.split(/\s+/).length > 4) continue;
    if (TITLE_HINT_RE.test(line)) {
      return cleanTitle(line);
    }
  }

  for (const line of window) {
    const parts = line.split(/\s+[|–—-]\s+/);
    if (parts.length >= 2 && TITLE_HINT_RE.test(parts[1])) {
      return cleanTitle(parts[1]);
    }
  }

  return '';
}

function extractLocation(lines) {
  for (const line of lines) {
    if (/linkedin|github|http|www\./i.test(line)) continue;
    // Prefer location tokens on contact/pipe lines.
    if (PIPE_SPLIT_RE.test(line)) {
      const parts = line.split(PIPE_SPLIT_RE).map((p) => p.trim());
      for (const part of parts) {
        if (EMAIL_RE.test(part) || PHONE_RE.test(part)) continue;
        const match = firstMatch(part, LOCATION_RE);
        if (match) return match;
        if (/^[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.']+)*,\s*[A-Za-z].+$/.test(part)) {
          return part;
        }
      }
    }
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) {
      const match = firstMatch(line, LOCATION_RE);
      if (match) return match;
      continue;
    }
  }

  for (const line of lines.slice(0, 8)) {
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) continue;
    if (SECTION_HEADER_RE.test(line)) break;
    const match = firstMatch(line, LOCATION_RE);
    if (match) return match;
  }
  return '';
}

function nameFromFilename(filename) {
  const base = String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base || /resume|cv|curriculum/i.test(base)) return '';
  const words = base.split(/\s+/);
  if (words.length < 2 || words.length > 6) return '';
  if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) return '';
  return base;
}
