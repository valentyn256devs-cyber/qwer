export const MemoryPlaceVersionTable = {
  TableName: 'MemoryPlaceVersion',
  Fields: {
    MemoryPlaceId: 'memoryPlaceId',
    Version: 'version',
    Data: 'data',
    ChangedBy: 'changedBy',
    ChangedAt: 'changedAt',
    OrderId: 'orderId',
  },
} as const;
