export const ClarificationRequestTable = {
  TableName: 'ClarificationRequest',
  Fields: {
    OrderId: 'orderId',
    CreatedBy: 'createdBy',
    Recipient: 'recipient',
    Question: 'question',
    Answer: 'answer',
    CreatedAt: 'createdAt',
    AnsweredAt: 'answeredAt',
    Status: 'status',
  },
} as const;

export enum ClarificationStatus {
  AwaitingResponse = 'awaiting_response',
  Answered = 'answered',
  Canceled = 'canceled',
}
