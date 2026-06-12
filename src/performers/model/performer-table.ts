export const PerformerTable = {
  TableName: 'Performer',
  Fields: {
    LastName: 'lastName', // Basic personal data
    FirstName: 'firstName',
    Patronymic: 'patronymic',
    City: 'city',
    Location: 'location', // Location coordinates (latitude, longitude)
    RadiusKm: 'radiusKm', // Radius in kilometers the performer can cover
    status: 'Status', // Status of the performer
  },
} as const;
