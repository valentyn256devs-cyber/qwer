export const OrderServiceChecklistTable = {
  TableName: 'OrderServiceChecklist',
  Fields: {
    OrderId: 'orderId',
    ServiceChecklistId: 'serviceChecklistId',
    Version: 'version',
    Snapshot: 'snapshot',
    CreatedAt: 'createdAt',
  },
} as const;
