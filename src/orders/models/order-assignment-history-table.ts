export const OrderAssignmentHistoryTable = {
  TableName: 'OrderAssignmentHistory',
  Fields: {
    OrderId: 'orderId',
    ExecutorId: 'executorId',
    AssignedAt: 'assignedAt',
    UnassignedAt: 'unassignedAt',
    AssignedBy: 'assignedBy',
    UnassignedBy: 'unassignedBy',
    Reason: 'reason',
    Comment: 'comment',
  },
} as const;
