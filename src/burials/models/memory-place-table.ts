export const MemoryPlaceTable = {
  TableName: 'MemoryPlace',
  Fields: {
    ClientId: 'clientId',
    FullName: 'fullName',
    Cemetery: 'cemetery',
    Sector: 'sector',
    Row: 'row',
    PlaceNumber: 'placeNumber',
    GpsLat: 'gpsLat',
    GpsLng: 'gpsLng',
    Description: 'description',
    Landmarks: 'landmarks',
    Photos: 'photos',
    MonumentData: 'monumentData',
    Notes: 'notes',
    Version: 'version',
  },
} as const;
