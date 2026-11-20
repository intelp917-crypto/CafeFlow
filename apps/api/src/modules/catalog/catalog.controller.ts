import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createCategorySchema,
  createProductSchema,
  importCatalogSchema,
  uploadProductImageSchema,
  productOptionsSchema,
  productExtrasSchema,
  productAvailabilitySchema,
  reorderCategoriesSchema,
  reorderProductsSchema,
  updateCategorySchema,
  updateProductSchema,
} from '@cafeflow/shared';
import { CurrentAuth, Permissions } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { CatalogService, type RequestMeta } from './catalog.service';
import { MediaService } from './media.service';

function meta(request: Request): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? request.socket?.remoteAddress ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
  };
}

/** The write side of the QR menu. Reads are one document, writes are granular. */
@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  @Get()
  @Permissions('catalog.read')
  getCatalog() {
    return this.catalog.getCatalog();
  }

  @Post('categories')
  @Permissions('catalog.write')
  createCategory(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    return this.catalog.createCategory(
      parseWith(createCategorySchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  /** Full display order in one write; keeps two managers from half-swapping. */
  @Put('categories/order')
  @HttpCode(200)
  @Permissions('catalog.write')
  reorderCategories(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    return this.catalog.reorderCategories(
      parseWith(reorderCategoriesSchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  @Patch('categories/:id')
  @Permissions('catalog.write')
  updateCategory(
    @Param('id') id: string,
    @CurrentAuth() auth: RequestAuth,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.catalog.updateCategory(
      id,
      parseWith(updateCategorySchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  @Delete('categories/:id')
  @Permissions('catalog.write')
  deleteCategory(@Param('id') id: string, @CurrentAuth() auth: RequestAuth, @Req() request: Request) {
    return this.catalog.deleteCategory(
      id,
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  /** Stores a PNG/JPEG/WebP product photo and returns its same-origin path. */
  @Post('images')
  @Permissions('catalog.write')
  uploadImage(@Body() body: unknown) {
    return this.media.save(parseWith(uploadProductImageSchema, body).dataUrl);
  }

  /** Bulk CSV import; `dryRun` returns the same report without writing. */
  @Post('import')
  @HttpCode(200)
  @Permissions('catalog.write')
  importCatalog(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    return this.catalog.importCatalog(
      parseWith(importCatalogSchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  @Post('products')
  @Permissions('catalog.write')
  createProduct(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    return this.catalog.createProduct(
      parseWith(createProductSchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  /** Display order of the products inside one category, in one write. */
  @Put('products/order')
  @HttpCode(200)
  @Permissions('catalog.write')
  reorderProducts(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    return this.catalog.reorderProducts(
      parseWith(reorderProductsSchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  @Patch('products/:id')
  @Permissions('catalog.write')
  updateProduct(
    @Param('id') id: string,
    @CurrentAuth() auth: RequestAuth,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.catalog.updateProduct(
      id,
      parseWith(updateProductSchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  /** Replaces the product's extras in one transaction. */
  @Put('products/:id/extras')
  @HttpCode(200)
  @Permissions('catalog.write')
  replaceExtras(
    @Param('id') id: string,
    @CurrentAuth() auth: RequestAuth,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.catalog.replaceExtras(
      id,
      parseWith(productExtrasSchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  /** Replaces the product's service windows in one transaction. */
  @Put('products/:id/availability')
  @HttpCode(200)
  @Permissions('catalog.write')
  replaceAvailability(
    @Param('id') id: string,
    @CurrentAuth() auth: RequestAuth,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.catalog.replaceAvailability(
      id,
      parseWith(productAvailabilitySchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  /** Replaces the product's whole option tree in one transaction. */
  @Put('products/:id/options')
  @HttpCode(200)
  @Permissions('catalog.write')
  replaceOptions(
    @Param('id') id: string,
    @CurrentAuth() auth: RequestAuth,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.catalog.replaceOptions(
      id,
      parseWith(productOptionsSchema, body),
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  /** Archives: the product leaves the menu, order history keeps its snapshot. */
  @Delete('products/:id')
  @Permissions('catalog.write')
  archiveProduct(@Param('id') id: string, @CurrentAuth() auth: RequestAuth, @Req() request: Request) {
    return this.catalog.archiveProduct(
      id,
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }
}
