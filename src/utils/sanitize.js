export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

export function safeUrl(url) {
  if (!url) return '';
  const raw = String(url).trim();
  if (!raw) return '';

  // Allow relative app links.
  if (raw.startsWith('/')) return raw;

  try {
    const origin = globalThis.location?.origin || 'http://localhost';
    const parsed = new URL(raw, origin);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:') {
      return parsed.toString();
    }
  } catch (_) {
    // Ignore parse errors and return empty.
  }

  return '';
}
