const SENSITIVE_PARAM =
  /^(token|access_token|id_token|refresh_token|auth|authorization|key|api_key|apikey|secret|password|passwd|pwd|session|sessionid|sid|code|signature|sig)$/i;

/** Redact sensitive query parameter values from a URL for safe logging. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return '[INVALID_URL]';
  }
}
