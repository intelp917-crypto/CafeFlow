import { Module } from '@nestjs/common';
import { PublicModule } from '../public/public.module';
import { GamesController } from './games.controller';
import { GamesGateway } from './games.gateway';
import { GamesRepository } from './games.repository';
import { GamesService } from './games.service';
import { RoomManager } from './room-manager';

@Module({
  imports: [PublicModule],
  controllers: [GamesController],
  providers: [GamesRepository, GamesService, RoomManager, GamesGateway],
  exports: [RoomManager, GamesService],
})
export class GamesModule {}
