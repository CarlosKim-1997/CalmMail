import { getDb } from '../db';
import type { MemoryProposal, MemoryProposalResult } from '@shared/types';

/**
 * Append-only proposal log. Every memory proposal coming from the AI is
 * recorded — whether it was applied or rejected. This is the audit trail that
 * keeps the "AI never directly modifies memory" promise inspectable.
 */
export const proposalLogRepo = {
  record(proposal: MemoryProposal, result: MemoryProposalResult): void {
    getDb()
      .prepare(
        `INSERT INTO proposal_log
           (created_at, action, target_contact, target_thread_id,
            delta, topic, reason_type, applied, rejection_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Date.now(),
        proposal.action,
        proposal.targetContact ?? null,
        proposal.targetThreadId ?? null,
        proposal.delta ?? null,
        proposal.topic ?? null,
        proposal.reasonType,
        result.applied ? 1 : 0,
        result.rejectionReason ?? null,
      );
  },
};
