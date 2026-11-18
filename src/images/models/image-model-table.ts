export const ImageModelTable = {
  TableName: 'ImageModel',
  Fields: {
    Base64Data: 'base64Data',     // Base64 рядок зображення (data:image/jpeg;base64,...)
    OriginalName: 'originalName', // Оригінальне ім'я файлу
    Kind: 'kind',                 // 'order' | 'burial'
    EntityId: 'entityId',         // orderId або burialId
    Slot: 'slot',                 // before | after | checklist/<stepId> | ...
    MimeType: 'mimeType',         // MIME-тип (image/jpeg)
    Size: 'size',                 // Розмір у байтах
  },
};