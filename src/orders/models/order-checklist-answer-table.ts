export const OrderChecklistAnswerTable = {
  TableName: 'OrderChecklistAnswer',
  Fields: {
    OrderId: 'orderId',
    StepId: 'stepId',
    Answer: 'answer',
    AnsweredBy: 'answeredBy',
    AnsweredAt: 'answeredAt',
  },
} as const;
