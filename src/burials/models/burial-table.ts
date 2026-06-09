export const BurialTable = {
  TableName : 'Burial',
  Fields : {
    Name: 'name',                 // Довільна назва (напр. "Могила дідуся")
    BurialName: 'burialName',     // ПІБ померлого
    BurialLastName: 'burialLastName',
    BurialFatherName: 'burialFatherName',
    BirthDate: 'birthDate',       // Дата народження (Date)
    DeathDate: 'deathDate',       // Дата смерті (Date)
    Cemetery: 'cemetery',         // Назва кладовища / Сектор
    Coordinates: 'coordinates',   // Геолокація (строка "lat,lng" або Parse.GeoPoint)
    Photos: 'photos',             // Масив файлів Parse.File[]
    Notes: 'notes',               // Нотатки / Коментарі
    TelegramId: 'telegramId',     // Хто додав (щоб юзер бачив свої поховання)
  },
}
