import { Injectable } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import { PrismaService } from '../prisma/prisma.service';

export interface ListProductsQuery {
  page: number;
  pageSize: number;
  /** Case-insensitive match on name or SKU. */
  search?: string;
  /** Only products that have / lack an active competitor listing. */
  monitored?: boolean;
}

export interface ProductDto {
  id: string;
  sallaProductId: string;
  sku: string | null;
  name: string;
  /** Regular price, decimal string. */
  price: string;
  salePrice: string | null;
  currency: string;
  quantity: number | null;
  status: string;
  url: string | null;
  imageUrl: string | null;
  competitors: {
    active: number;
    /** Lowest last-known active competitor price, decimal string. */
    lowestPrice: string | null;
    /** Lowest competitor price is below what the customer pays here. */
    undercut: boolean;
  };
}

export interface ProductListResponse {
  items: ProductDto[];
  page: number;
  pageSize: number;
  total: number;
}

/** Catalogue reads. Every query is scoped by the session's store. */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(storeId: string, q: ListProductsQuery): Promise<ProductListResponse> {
    const where: Prisma.ProductWhereInput = { storeId, status: { not: 'DELETED' } };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { sku: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    if (q.monitored === true) where.competitors = { some: { isActive: true } };
    if (q.monitored === false) where.competitors = { none: { isActive: true } };

    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          sallaProductId: true,
          sku: true,
          name: true,
          price: true,
          salePrice: true,
          currency: true,
          quantity: true,
          status: true,
          url: true,
          imageUrl: true,
          competitors: {
            where: { isActive: true },
            select: { lastPrice: true },
          },
        },
      }),
    ]);

    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => {
        const effective = r.salePrice ?? r.price;
        const known = r.competitors
          .map((c) => c.lastPrice)
          .filter((p): p is Prisma.Decimal => p !== null);
        const lowest = known.length
          ? known.reduce((min, p) => (p.lessThan(min) ? p : min))
          : null;
        return {
          id: r.id,
          sallaProductId: r.sallaProductId,
          sku: r.sku,
          name: r.name,
          price: r.price.toFixed(2),
          salePrice: r.salePrice ? r.salePrice.toFixed(2) : null,
          currency: r.currency,
          quantity: r.quantity,
          status: r.status,
          url: r.url,
          imageUrl: r.imageUrl,
          competitors: {
            active: r.competitors.length,
            lowestPrice: lowest ? lowest.toFixed(2) : null,
            undercut: lowest !== null && lowest.lessThan(effective),
          },
        };
      }),
    };
  }
}
