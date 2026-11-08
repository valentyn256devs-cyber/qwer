export const ServiceChecklistTable = {
  TableName: 'ServiceChecklist',
  Fields: {
    ServiceId: 'serviceId',
    Version: 'version',
    Steps: 'steps',
  },
} as const;

export enum ChecklistStepType {
  Instruction = 'instruction',
  Checkbox = 'checkbox',
  YesNo = 'yes_no',
  Text = 'text',
  Comment = 'comment',
  Photo = 'photo',
  MultiplePhotos = 'multiple_photos',
  Select = 'select',
  Confirmation = 'confirmation',
}
