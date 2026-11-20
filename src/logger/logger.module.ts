import { Module } from '@nestjs/common';
import { WinstonModule, utilities as nestWinstonUtilities } from 'nest-winston';
import * as winston from 'winston';

@Module({
  imports: [
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.ms(),
            nestWinstonUtilities.format.nestLike('dmutrobot', {
              prettyPrint: true,
              colors: true,
              processId: true,
            }),
          ),
        }),
      ],
    }),
  ],
})
export class LoggerModule {}
