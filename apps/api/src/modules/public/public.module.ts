import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PublicController } from './public.controller';
import { PublicRepository } from './public.repository';
import { PublicService } from './public.service';

@Module({
  imports: [InventoryModule, CatalogModule],
  controllers: [PublicController],
  providers: [PublicRepository, PublicService],
  // The staff order flow reuses the same menu pricing engine as the QR menu.
  exports: [PublicService],
})
export class PublicModule {}
