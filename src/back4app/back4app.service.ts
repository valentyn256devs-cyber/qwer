import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Parse from 'parse/node';

@Injectable()
export class Back4appService implements OnModuleInit {
  private readonly logger = new Logger(Back4appService.name);

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const appId = this.configService.get<string>('BACK4APP_APP_ID');
    const jsKey = this.configService.get<string>('BACK4APP_JS_KEY');
    const masterKey = this.configService.get<string>('BACK4APP_MASTER_KEY');
    const serverUrl = this.configService.get<string>('BACK4APP_SERVER_URL');

    this.logger.log(`appId = ${appId}`)
    this.logger.log(`jsKey = ${jsKey}`)
    this.logger.log(`masterKey = ${masterKey}`)
    this.logger.log(`serverUrl = ${serverUrl}`)

    if (!appId || !jsKey || !masterKey) {
      this.logger.error('Back4app keys are missing in .env file!');
      return;
    }

    Parse.initialize(appId, jsKey, masterKey);
    Parse.CoreManager.set('SERVER_URL', serverUrl ?? '');

    this.logger.log('✅ Надійно підключено до Back4app (Parse Server)');
  }

  get parse() {
    return Parse;
  }
}
