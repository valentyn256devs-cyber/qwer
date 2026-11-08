export const MemoryPlaceVersionTable = {
  TableName: 'MemoryPlaceVersion',
  Fields: {
    MemoryPlaceId: 'memoryPlaceId',
    Version: 'version',
    PreviousData: 'previousData',
    Data: 'data',
    ChangedBy: 'changedBy',        // executor who proposed
    AdminReviewedBy: 'adminReviewedBy',
    ClientReviewedBy: 'clientReviewedBy',
    ChangedAt: 'changedAt',
    OrderId: 'orderId',
  },
} as const;
