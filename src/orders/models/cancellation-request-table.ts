export const CancellationRequestTable = {
  TableName: 'CancellationRequest',
  Fields: {
    OrderId: 'orderId',
    RequestedBy: 'requestedBy',
    RequestedAt: 'requestedAt',
    Reason: 'reason',
    Comment: 'comment',
    Status: 'status',
    ReviewedBy: 'reviewedBy',
    ReviewedAt: 'reviewedAt',
    DecisionComment: 'decisionComment',
  },
} as const;

export enum CancellationRequestStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}
