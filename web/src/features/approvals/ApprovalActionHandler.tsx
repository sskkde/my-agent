import { useState, useCallback } from 'react';
import * as client from '../../api/client';

export interface ApprovalActionsResult {
  approve: (approvalRequestId: string) => Promise<void>;
  reject: (approvalRequestId: string, reason?: string) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

export function useApprovalActions(): ApprovalActionsResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(async (approvalRequestId: string): Promise<void> => {
    setIsSubmitting(true);
    setError(null);
    try {
      await client.respondApproval(approvalRequestId, 'approved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve';
      setError(message);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const reject = useCallback(async (approvalRequestId: string, reason?: string): Promise<void> => {
    setIsSubmitting(true);
    setError(null);
    try {
      await client.respondApproval(approvalRequestId, 'rejected', reason);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reject';
      setError(message);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return {
    approve,
    reject,
    isSubmitting,
    error,
  };
}
