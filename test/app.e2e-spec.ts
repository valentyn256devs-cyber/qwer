import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/services (GET) returns the list of services', () => {
    return request(app.getHttpServer())
      .get('/services')
      .expect(200)
      .expect((res) => {
        if (!Array.isArray(res.body)) {
          throw new Error('Expected /services to return an array');
        }
      });
  });

  it('/orders (GET) returns the list of orders', () => {
    return request(app.getHttpServer())
      .get('/orders')
      .expect(200)
      .expect((res) => {
        if (!Array.isArray(res.body)) {
          throw new Error('Expected /orders to return an array');
        }
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
