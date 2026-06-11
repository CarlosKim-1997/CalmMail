import type { AppLanguage, BriefingInspectionSummary, TriageGroups } from './types';

/** Sender/category colour for triage reasoning — no cluster counts (those are scan-window totals). */
export function buildInspectionClusterHint(
  clusters: BriefingInspectionSummary['clusters'],
  lang: AppLanguage,
): string | undefined {
  const top = (clusters ?? []).filter((c) => c.count > 0).slice(0, 2);
  if (top.length === 0) return undefined;

  const senderBits = top
    .map((c) =>
      c.topSenders
        .slice(0, 2)
        .map((s) => s.label.replace(/\s*<[^>]+>\s*$/, '').trim())
        .filter(Boolean)
        .join(', '),
    )
    .filter(Boolean);

  if (senderBits.length === 0) return undefined;

  const joined = senderBits.join(lang === 'ko' ? ', ' : '; ');
  return lang === 'ko' ? `주로 ${joined} 등에서 왔어요.` : `Mostly from ${joined}.`;
}

/** User-facing reasoning aligned with triage.scope (not cached inbox total). */
export function buildTriageScopeReasoning(opts: {
  lang: AppLanguage;
  scope: TriageGroups['scope'];
  highlightCount: number;
  awaitedTracked: number;
  clusterSnippet?: string;
}): string {
  const { lang, scope, highlightCount, awaitedTracked, clusterSnippet } = opts;
  const ko = lang === 'ko';
  const { unreadInScope, triagedCount, withinDays } = scope;

  const headline =
    unreadInScope > triagedCount
      ? ko
        ? `최근 ${withinDays}일 미읽음 ${unreadInScope}건 중 ${triagedCount}건을 정리 순서로 나눴어요.`
        : `Sorted ${triagedCount} of ${unreadInScope} unread messages from the last ${withinDays} days.`
      : ko
        ? `최근 ${withinDays}일 미읽음 ${triagedCount}건을 정리 순서로 나눴어요.`
        : `Sorted ${triagedCount} unread messages from the last ${withinDays} days.`;

  if (highlightCount === 0) {
    const parts: string[] = [headline];
    if (clusterSnippet?.trim()) parts.push(clusterSnippet.trim());
    parts.push(
      ko
        ? '우선 신호(VIP·키워드·답장 대기)가 잡힌 건이 없어, 굳이 알릴 만한 메일은 없었습니다.'
        : 'None of them tripped a priority signal (VIP, keyword, awaited reply), so nothing is pressing.',
    );
    if (awaitedTracked > 0) {
      parts.push(
        ko
          ? `답장 대기 ${awaitedTracked}건은 계속 지켜보고 있어요.`
          : `Still tracking ${awaitedTracked} awaited replies.`,
      );
    }
    return parts.join(' ');
  }

  return ko
    ? `${headline} 그중 ${highlightCount}건을 우선 확인할 만한 메일로 골랐어요.`
    : `${headline} ${highlightCount} look worth opening first.`;
}
