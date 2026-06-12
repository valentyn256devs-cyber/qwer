import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  initSwagger(app);

  const PORT = process.env.PORT ?? 3000;
  await app.listen(PORT, '0.0.0.0');
  console.log(`🚀 Сервер працює на: http://localhost:${PORT}`);
  console.log(
    `📑 Документація Swagger доступна на: http://localhost:${PORT}/api/docs`,
  );
}

function initSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('ДОГЛЯД+ API')
    .setDescription(
      'Документація REST API для MVP Telegram-бота дистанційного догляду за місцями пам’яті',
    )
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document); // Шлях до UI документації
}

void bootstrap();
