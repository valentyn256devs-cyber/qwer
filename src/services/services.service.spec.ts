import { ServicesService } from './services.service';

jest.mock('parse/node', () => {
  const find = jest.fn();
  const get = jest.fn();
  const count = jest.fn().mockResolvedValue(0);
  const ascending = jest.fn();

  return {
    Query: jest.fn().mockImplementation(() => ({ find, get, count, ascending })),
    Object: jest.fn(),
    __mockState: { find, get, count, ascending },
  };
});

type ParseMock = {
  __mockState: {
    find: jest.Mock;
    get: jest.Mock;
    count: jest.Mock;
    ascending: jest.Mock;
  };
};

const parseMock = jest.requireMock('parse/node') as ParseMock;

describe('ServicesService', () => {
  let service: ServicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ServicesService({} as never);
  });

  it('findAll() returns mapped services sorted by price', async () => {
    parseMock.__mockState.find.mockResolvedValue([
      {
        id: 'svc1',
        get: (field: string) =>
          ({ name: 'Прибирання', description: 'Опис', price: 800 })[field],
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await service.findAll();

    expect(parseMock.__mockState.ascending).toHaveBeenCalledWith('price');
    expect(result).toEqual([
      {
        id: 'svc1',
        name: 'Прибирання',
        description: 'Опис',
        price: 800,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
  });

  it('findOne() returns a single mapped service', async () => {
    parseMock.__mockState.get.mockResolvedValue({
      id: 'svc2',
      get: (field: string) =>
        ({ name: 'Фотоогляд', description: 'Опис', price: 400 })[field],
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });

    const result = await service.findOne('svc2');

    expect(parseMock.__mockState.get).toHaveBeenCalledWith('svc2');
    expect(result.id).toBe('svc2');
    expect(result.name).toBe('Фотоогляд');
    expect(result.price).toBe(400);
  });

  it('findOne() throws a friendly error when the service is missing', async () => {
    parseMock.__mockState.get.mockRejectedValue(new Error('Object not found'));

    await expect(service.findOne('missing')).rejects.toThrow(
      'Послугу з ID missing не знайдено',
    );
  });
});