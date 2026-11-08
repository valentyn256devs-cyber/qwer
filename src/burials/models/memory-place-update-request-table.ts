export const MemoryPlaceUpdateRequestTable = {
  TableName: 'MemoryPlaceUpdateRequest',
  Fields: {
    MemoryPlaceId: 'memoryPlaceId',
    OrderId: 'orderId',
    ProposedBy: 'proposedBy',
    ProposedData: 'proposedData',
    CurrentData: 'currentData',
    Status: 'status',
    Critical: 'critical',
    CreatedAt: 'createdAt',
    AdminReviewedAt: 'adminReviewedAt',
    AdminReviewedBy: 'adminReviewedBy',
    ClientReviewedAt: 'clientReviewedAt',
    ClientReviewedBy: 'clientReviewedBy',
  },
} as const;

export enum MemoryPlaceUpdateStatus {
  Draft = 'draft',
  AwaitingAdminApproval = 'awaiting_admin_approval',
  AwaitingClientApproval = 'awaiting_client_approval',
  PendingClarification = 'pending_clarification',
  Approved = 'approved',
  RejectedByAdmin = 'rejected_by_admin',
  RejectedByClient = 'rejected_by_client',
}
