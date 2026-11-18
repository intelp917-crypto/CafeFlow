import { Global, Module } from '@nestjs/common';
import { DB_SERVICE } from '../common/tokens';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [
    DatabaseService,
    { provide: DB_SERVICE, useExisting: DatabaseService },
  ],
  exports: [DatabaseService, DB_SERVICE],
})
export class DatabaseModule {}
