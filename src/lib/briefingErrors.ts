/** Maps main-process briefing errors to i18n keys (renderer). */
export function briefingErrorMessageKey(raw: string): { key: string; vars?: Record<string, string | number> } | null {
  if (raw === 'CALMMAIL_AI_DISABLED') return { key: 'errors.briefingAiOff' };
  if (raw === 'CALMMAIL_BRIEFING_GMAIL_NOT_CONNECTED') {
    return { key: 'errors.briefingGmailNotConnected' };
  }
  const noMailPrefix = 'CALMMAIL_BRIEFING_NO_MAIL:';
  if (raw === 'CALMMAIL_BRIEFING_NO_MAIL' || raw.startsWith(noMailPrefix)) {
    const detail = raw.startsWith(noMailPrefix) ? raw.slice(noMailPrefix.length) : 'cache_empty';
    const keyByDetail: Record<string, string> = {
      gmail_api: 'errors.briefingNoMailGmailApi',
      fetch_failed: 'errors.briefingNoMailFetchFailed',
      gmail_empty: 'errors.briefingNoMail',
      cache_empty: 'errors.briefingNoMail',
    };
    return { key: keyByDetail[detail] ?? 'errors.briefingNoMail' };
  }
  const provPrefix = 'CALMMAIL_PROVIDER_NOT_CONFIGURED:';
  if (raw.startsWith(provPrefix)) {
    const id = raw.slice(provPrefix.length);
    if (id === 'local') return { key: 'errors.briefingLocalGeneric' };
    return { key: 'errors.briefingProvider', vars: { id } };
  }
  const localPrefix = 'CALMMAIL_LOCAL_AI_NOT_READY:';
  if (raw.startsWith(localPrefix)) {
    const reason = raw.slice(localPrefix.length);
    const keyByReason: Record<string, string> = {
      runtime_not_managed: 'errors.briefingLocalRuntime',
      notice_not_accepted: 'errors.briefingLocalNotice',
      model_not_selected: 'errors.briefingLocalModel',
      artifacts_missing: 'errors.briefingLocalArtifacts',
      server_start_failed: 'errors.briefingLocalServerStart',
      ollama_not_ready: 'errors.briefingLocalOllama',
      mode_off: 'errors.briefingLocalGeneric',
    };
    return { key: keyByReason[reason] ?? 'errors.briefingLocalGeneric' };
  }
  // Wire format: CALMMAIL_CLOUD_BRIEFING_LIMIT:<resetAtMs>:<limit>
  if (raw === 'CALMMAIL_LOCAL_AI_CONTEXT_OVERFLOW') {
    return { key: 'errors.briefingLocalContextOverflow' };
  }
  const limitPrefix = 'CALMMAIL_CLOUD_BRIEFING_LIMIT:';
  if (raw.startsWith(limitPrefix)) {
    const [, resetAtRaw, limitRaw] = raw.split(':');
    const resetAt = Number(resetAtRaw);
    const limit = Number(limitRaw);
    return {
      key: 'errors.briefingCloudLimit',
      vars: {
        limit: Number.isFinite(limit) ? limit : 2,
        // resetTime is rendered by the consumer (it owns locale).
        resetAt: Number.isFinite(resetAt) ? resetAt : Date.now(),
      },
    };
  }
  return null;
}
