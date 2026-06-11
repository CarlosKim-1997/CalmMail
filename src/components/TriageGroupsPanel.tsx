import { useMemo, useState } from 'react';
import type { EmailSummary, TriageGroupId, TriageGroups, TriageItem } from '@shared/types';

const GROUP_ORDER: TriageGroupId[] = ['now', 'today', 'later'];

/** Visible rows per group before "show more" (default collapsed). */
export const TRIAGE_LIST_PREVIEW = 4;

function TrashIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export type TriageEmailCache = Pick<EmailSummary, 'id' | 'isUnread' | 'triageDismissed'>;

export function TriageGroupsPanel({
  triage,
  emailById,
  t,
  onOpen,
  onDismissLater,
  dismissBusy,
  gmailMarkReadActive = false,
}: {
  triage: TriageGroups;
  emailById: Map<string, TriageEmailCache>;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onOpen: (item: TriageItem) => void | Promise<void>;
  onDismissLater?: (emailIds: string[]) => void | Promise<void>;
  dismissBusy?: boolean;
  /** @deprecated List preview collapse applies to all groups. */
  collapseLater?: boolean;
  gmailMarkReadActive?: boolean;
}) {
  const [dismissMsg, setDismissMsg] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [expandedLists, setExpandedLists] = useState<Partial<Record<TriageGroupId, boolean>>>({});

  const groups = useMemo(() => {
    return GROUP_ORDER.map((id) => {
      const items = (triage[id] ?? []).filter((item) =>
        isVisibleInTriage(item.emailId, emailById),
      );
      return { id, items };
    });
  }, [triage, emailById]);

  const unreadInGroup = (items: TriageItem[]) =>
    items.filter((item) => isUnreadInTriage(item.emailId, emailById)).length;

  const laterIds = useMemo(
    () =>
      (triage.later ?? [])
        .filter((i) => isVisibleInTriage(i.emailId, emailById))
        .map((i) => i.emailId),
    [triage.later, emailById],
  );

  const handleDismissLater = async () => {
    if (!onDismissLater || laterIds.length === 0 || dismissBusy) return;
    await onDismissLater(laterIds);
    setDismissMsg(
      t(
        gmailMarkReadActive
          ? 'briefing.triage.dismissLaterDoneGmail'
          : 'briefing.triage.dismissLaterDone',
        { n: laterIds.length },
      ),
    );
    window.setTimeout(() => setDismissMsg(null), 2800);
  };

  const handleDismissOne = async (emailId: string) => {
    if (!onDismissLater || dismissBusy || dismissingId) return;
    setDismissingId(emailId);
    try {
      await onDismissLater([emailId]);
    } finally {
      setDismissingId(null);
    }
  };

  const { withinDays, unreadInScope, triagedCount } = triage.scope;

  return (
    <section className="card stack triage-panel">
      <div className="stack tight">
        <h2 className="h2" style={{ margin: 0 }}>
          {t('briefing.triage.title')}
        </h2>
        <p className="subtle" style={{ margin: 0 }}>
          {t('briefing.triage.subtitle', {
            days: withinDays,
            unread: unreadInScope,
            triaged: triagedCount,
          })}
        </p>
      </div>

      <div className="triage-grid">
        {groups.map(({ id, items }) => {
          const isExpanded = expandedLists[id] === true;
          const canCollapse = items.length > TRIAGE_LIST_PREVIEW;
          const visibleItems =
            canCollapse && !isExpanded
              ? items.slice(0, TRIAGE_LIST_PREVIEW)
              : items;
          const hiddenCount = items.length - visibleItems.length;

          return (
            <div key={id} className="triage-group card stack tight">
              <div className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
                <h3 className="h2" style={{ margin: 0, fontSize: 15 }}>
                  {t(`briefing.triage.group.${id}`)}
                </h3>
                <span
                  className={`badge ${badgeForGroup(id)}`}
                  title={t('briefing.triage.badgeHint')}
                >
                  {items.length === 0
                    ? '0'
                    : unreadInGroup(items) > 0
                      ? `${unreadInGroup(items)}/${items.length}`
                      : items.length}
                </span>
              </div>

              {items.length === 0 ? (
                <p className="subtle triage-group__empty" style={{ margin: 0, fontSize: 12 }}>
                  {t(`briefing.triage.groupEmpty.${id}`)}
                </p>
              ) : (
                <>
                  <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
                    {t(`briefing.triage.hint.${id}`)}
                  </p>
                  <ul className="triage-list stack tight">
                    {visibleItems.map((item) => {
                      const isRead = !isUnreadInTriage(item.emailId, emailById);
                      const readClass = isRead ? ' triage-item--read' : '';

                      if (id === 'later' && onDismissLater) {
                        return (
                          <li key={item.emailId} className="triage-row">
                            <button
                              type="button"
                              className={`triage-item triage-item--later${readClass}`}
                              onClick={() => void onOpen(item)}
                            >
                              <span className="triage-item__subject">{item.subject}</span>
                            </button>
                            <button
                              type="button"
                              className="triage-item__remove btn ghost"
                              aria-label={t('briefing.triage.dismissOneAria', {
                                subject: item.subject,
                              })}
                              disabled={dismissBusy || dismissingId === item.emailId}
                              onClick={() => void handleDismissOne(item.emailId)}
                            >
                              <TrashIcon />
                            </button>
                          </li>
                        );
                      }

                      return (
                        <li key={item.emailId}>
                          <button
                            type="button"
                            className={`triage-item${readClass}`}
                            onClick={() => void onOpen(item)}
                          >
                            <span className="triage-item__from">{item.from}</span>
                            <span className="triage-item__subject">{item.subject}</span>
                            {item.reason && (
                              <span className="triage-item__reason subtle">{item.reason}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {canCollapse && (
                    <button
                      type="button"
                      className="btn ghost triage-group__expand"
                      onClick={() =>
                        setExpandedLists((prev) => ({ ...prev, [id]: !isExpanded }))
                      }
                    >
                      {isExpanded
                        ? t('briefing.triage.collapseList')
                        : t('briefing.triage.expandList', { n: hiddenCount })}
                    </button>
                  )}
                  {id === 'later' && onDismissLater && laterIds.length > 0 && (
                    <div className="stack tight triage-dismiss-all-wrap">
                      <button
                        type="button"
                        className="btn primary triage-dismiss-all"
                        disabled={dismissBusy || Boolean(dismissingId)}
                        onClick={() => void handleDismissLater()}
                      >
                        {t(
                          gmailMarkReadActive
                            ? 'briefing.triage.dismissLaterGmail'
                            : 'briefing.triage.dismissLater',
                          { n: laterIds.length },
                        )}
                      </button>
                      <p className="subtle" style={{ margin: 0, fontSize: 11 }}>
                        {t(
                          gmailMarkReadActive
                            ? 'briefing.triage.dismissLaterHintGmail'
                            : 'briefing.triage.dismissLaterHint',
                        )}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {dismissMsg && (
        <p className="subtle" style={{ margin: 0, color: 'var(--accent-ink)' }}>
          {dismissMsg}
        </p>
      )}
    </section>
  );
}

export function buildEmailById(emails: EmailSummary[]): Map<string, TriageEmailCache> {
  const map = new Map<string, TriageEmailCache>();
  for (const e of emails) {
    map.set(e.id, {
      id: e.id,
      isUnread: e.isUnread,
      triageDismissed: e.triageDismissed,
    });
  }
  return map;
}

/** Minimal row for Gmail open IPC (id + threadId only required). */
export function triageItemToEmailSummary(item: TriageItem): EmailSummary {
  return {
    id: item.emailId,
    threadId: item.threadId,
    from: { name: null, email: '' },
    to: [],
    subject: item.subject,
    snippet: '',
    receivedAt: 0,
    isUnread: true,
    labels: [],
    importanceScore: 0,
    priority: 'LOW',
    reasons: [],
    category: 'other',
    openCount: 0,
    triageDismissed: false,
  };
}

/** Hide only when user dismissed from CalmMail — keep read items visible (faded). */
export function isVisibleInTriage(
  emailId: string,
  emailById: Map<string, TriageEmailCache>,
): boolean {
  const row = emailById.get(emailId);
  if (!row) return true;
  return !row.triageDismissed;
}

export function isUnreadInTriage(
  emailId: string,
  emailById: Map<string, TriageEmailCache>,
): boolean {
  const row = emailById.get(emailId);
  if (!row) return true;
  return row.isUnread;
}

function badgeForGroup(id: TriageGroupId): string {
  if (id === 'now') return 'high';
  if (id === 'today') return 'medium';
  return 'low';
}
