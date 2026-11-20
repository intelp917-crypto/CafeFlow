import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { MediaService } from './media.service';

@Module({
  imports: [AuditModule],
  controllers: [CatalogController],
  providers: [CatalogRepository, CatalogService, MediaService],
  // The public module serves the uploaded files from this same folder.
  exports: [MediaService],
})
export class CatalogModule {}
