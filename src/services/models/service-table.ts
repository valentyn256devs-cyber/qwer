export const ServiceTable = {
  TableName: 'Service',
  Fields: {
    Name: 'name',
    Description: 'description',
    Price: 'price',
    /** Конфігурований чек-лист послуги: { version, steps: ChecklistStep[] } */
    Checklist: 'checklist',
    /** Фото-слоти «до» для цієї послуги: { key, name, instruction, required, minPhotos, guideUrl? }[] */
    PhotoSlots: 'photoSlots',
  },
} as const;
