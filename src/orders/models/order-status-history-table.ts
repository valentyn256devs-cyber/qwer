export const OrderStatusHistoryTable = {
  TableName: 'OrderStatusHistory',
  Fields: {
    OrderId: 'orderId',
    FromStatus: 'fromStatus',
    ToStatus: 'toStatus',
    ChangedBy: 'changedBy',
    ChangedAt: 'changedAt',
    Reason: 'reason',
    Comment: 'comment',
  },
} as const;
