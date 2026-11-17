export const PerformerTable = {
  TableName: 'Performer',
  Fields: {
    TelegramId: 'telegramId', // Telegram user ID — primary key for identification
    Username: 'username', // Telegram @username (nickname)
    PhoneNumber: 'phoneNumber', // Contact phone number
    LastName: 'lastName', // Basic personal data
    FirstName: 'firstName',
    Patronymic: 'patronymic',
    City: 'city',
    Location: 'location', // Location coordinates (latitude, longitude)
    RadiusKm: 'radiusKm', // Radius in kilometers the performer can cover
    status: 'Status', // Status of the performer
  },
} as const;
