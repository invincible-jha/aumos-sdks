// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Transaction, TransactionFilter } from './types.js';

const RecordInputSchema = z.object({
  category: z.string().min(1),
  amount: z.number().positive('Transaction amount must be positive'),
  description: z.string().optional(),
  envelopeId: z.string().optional(),
});

type RecordInput = z.infer<typeof RecordInputSchema>;

/**
 * Build a validated Transaction record with a stable UUID and current timestamp.
 */
export function buildTransaction(input: RecordInput): Transaction {
  const validated = RecordInputSchema.parse(input);
  return {
    id: randomUUID(),
    category: validated.category,
    amount: validated.amount,
    description: validated.description,
    timestamp: new Date(),
    envelopeId: validated.envelopeId,
  };
}

/**
 * Apply an optional TransactionFilter to a list of transactions.
 * All filter fields are AND-ed together.
 */
export function filterTransactions(
  transactions: readonly Transaction[],
  filter: TransactionFilter,
): readonly Transaction[] {
  if (filter === undefined || filter === null) return transactions;

  return transactions.filter((transaction) => {
    if (filter.category !== undefined && transaction.category !== filter.category) {
      return false;
    }
    if (filter.since !== undefined && transaction.timestamp < filter.since) {
      return false;
    }
    if (filter.until !== undefined && transaction.timestamp > filter.until) {
      return false;
    }
    if (filter.minAmount !== undefined && transaction.amount < filter.minAmount) {
      return false;
    }
    if (filter.maxAmount !== undefined && transaction.amount > filter.maxAmount) {
      return false;
    }
    return true;
  });
}
