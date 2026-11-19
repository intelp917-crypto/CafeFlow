import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PublicController } from './public.controller';
import { PublicRepository } from './public.repository';
import { PublicService } from './public.service';

@Module({
  imports: [InventoryModule],
  controllers: [PublicController],
  providers: [PublicRepository, PublicService],
})
export class PublicModule {}
