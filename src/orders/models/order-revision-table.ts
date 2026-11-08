export const OrderRevisionTable = {
  TableName: 'OrderRevision',
  Fields: {
    OrderId: 'orderId',
    RevisionNumber: 'revisionNumber',
    FromStatus: 'fromStatus',
    ToStatus: 'toStatus',
    Description: 'description',
    ChecklistSteps: 'checklistSteps',
    PhotoIds: 'photoIds',
    CreatedBy: 'createdBy',
    CreatedByRole: 'createdByRole',
    CreatedAt: 'createdAt',
    ResolvedAt: 'resolvedAt',
    ExecutorComment: 'executorComment',
  },
} as const;