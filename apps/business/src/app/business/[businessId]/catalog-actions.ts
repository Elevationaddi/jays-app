'use server';

import { randomUUID } from 'node:crypto';
import { ApiClientError } from '@jays/api-client';
import {
  EMIRATE_CODES,
  IMAGE_CONTENT_TYPES,
  PRODUCT_IMAGES_MAX,
  STOCK_ADJUST_REASONS,
  TAX_CLASSES,
} from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';
import { parseAed } from '../../../lib/workspace';

const UUID = /^[0-9a-f-]{36}$/i;
const text = (f: FormData, name: string) => String(f.get(name) ?? '').trim();

function uuid(f: FormData, name: string): string {
  const id = text(f, name);
  if (!UUID.test(id)) redirect('/business/gateway');
  return id;
}

function fail(path: string, error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`${path}?error=${encodeURIComponent(code)}`);
}

const taxClass = (f: FormData) => {
  const value = text(f, 'taxClass');
  return (TAX_CLASSES as readonly string[]).includes(value)
    ? (value as (typeof TAX_CLASSES)[number])
    : 'standard';
};

const intOr = (f: FormData, name: string, fallback?: number) => {
  const value = text(f, name);
  return /^-?\d+$/.test(value) ? Number(value) : fallback;
};

function content(f: FormData) {
  const brandId = text(f, 'brandId');
  return {
    categoryId: text(f, 'categoryId'),
    brandId: UUID.test(brandId) ? brandId : null,
    title: { en: text(f, 'titleEn'), ar: text(f, 'titleAr') },
    description: { en: text(f, 'descriptionEn'), ar: text(f, 'descriptionAr') },
    returnEligible: f.get('returnEligible') === 'on',
  };
}

function variant(f: FormData) {
  const priceFils = parseAed(f.get('price'));
  // Blank clears the was-price; anything unreadable is sent as invalid so the API explains it.
  const compareAt = text(f, 'compareAt');
  return {
    name: { en: text(f, 'variantNameEn'), ar: text(f, 'variantNameAr') },
    priceFils: priceFils ?? -1,
    compareAtFils: compareAt === '' ? null : (parseAed(compareAt) ?? -1),
    taxClass: taxClass(f),
    lowStockThreshold: intOr(f, 'lowStockThreshold'),
  };
}

/** Creates a draft with its first variant, then opens it to add images. */
export async function createProduct(f: FormData) {
  const id = uuid(f, 'businessId');
  const back = `/business/${id}/products/new`;
  let productId: string;
  try {
    const v = variant(f);
    const created = await (
      await serverApi()
    ).createProduct(id, {
      ...content(f),
      variants: [{ ...v, sku: text(f, 'sku') }],
    });
    productId = created.id;
  } catch (error) {
    fail(back, error);
  }
  redirect(`/business/${id}/products/${productId}?saved=1`);
}

export async function updateProduct(f: FormData) {
  const id = uuid(f, 'businessId');
  const productId = uuid(f, 'productId');
  const path = `/business/${id}/products/${productId}`;
  try {
    await (await serverApi()).updateProduct(id, productId, content(f));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function submitProduct(f: FormData) {
  const id = uuid(f, 'businessId');
  const productId = uuid(f, 'productId');
  const path = `/business/${id}/products/${productId}`;
  try {
    await (await serverApi()).submitProduct(id, productId);
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?submitted=1`);
}

export async function archiveProduct(f: FormData) {
  const id = uuid(f, 'businessId');
  const productId = uuid(f, 'productId');
  try {
    await (await serverApi()).archiveProduct(id, productId);
  } catch (error) {
    fail(`/business/${id}/products/${productId}`, error);
  }
  redirect(`/business/${id}/products?saved=1`);
}

export async function addVariant(f: FormData) {
  const id = uuid(f, 'businessId');
  const productId = uuid(f, 'productId');
  const path = `/business/${id}/products/${productId}`;
  try {
    await (await serverApi()).addVariant(id, productId, { ...variant(f), sku: text(f, 'sku') });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function updateVariant(f: FormData) {
  const id = uuid(f, 'businessId');
  const productId = uuid(f, 'productId');
  const variantId = uuid(f, 'variantId');
  const path = `/business/${id}/products/${productId}`;
  try {
    await (
      await serverApi()
    ).updateVariant(id, variantId, f.get('archive') === '1' ? { status: 'archived' } : variant(f));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

/**
 * Uploads a product image (signed ticket, PUT, server-side checks) and appends it to the draft's
 * image list. The API rejects images from another business.
 */
export async function uploadProductImage(f: FormData) {
  const id = uuid(f, 'businessId');
  const productId = uuid(f, 'productId');
  const path = `/business/${id}/products/${productId}`;
  const file = f.get('file');
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    !(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)
  ) {
    redirect(`${path}?error=VALIDATION_FAILED`);
  }
  try {
    const api = await serverApi();
    const product = await api.merchantProduct(id, productId);
    const current = product.draft.images.map((i) => i.id);
    if (current.length >= PRODUCT_IMAGES_MAX)
      throw new ApiClientError(422, 'VALIDATION_FAILED', 'Too many images.');
    const ticket = await api.createProductImageUpload(id, {
      contentType: file.type as (typeof IMAGE_CONTENT_TYPES)[number],
      sizeBytes: file.size,
    });
    await api.upload(ticket, new Uint8Array(await file.arrayBuffer()));
    await api.completeProductImage(id, ticket.id);
    await api.updateProduct(id, productId, { mediaIds: [...current, ticket.id] });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function removeProductImage(f: FormData) {
  const id = uuid(f, 'businessId');
  const productId = uuid(f, 'productId');
  const mediaId = uuid(f, 'mediaId');
  const path = `/business/${id}/products/${productId}`;
  try {
    const api = await serverApi();
    const product = await api.merchantProduct(id, productId);
    await api.updateProduct(id, productId, {
      mediaIds: product.draft.images.map((i) => i.id).filter((m) => m !== mediaId),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

/**
 * Stock adjustment. The idempotency key is minted when the form is rendered, so a double submit
 * or a retried request applies the change once.
 */
export async function adjustStock(f: FormData) {
  const id = uuid(f, 'businessId');
  const path = `/business/${id}/inventory`;
  const reason = text(f, 'reason');
  const delta = intOr(f, 'delta');
  const variantId = uuid(f, 'variantId');
  if (!(STOCK_ADJUST_REASONS as readonly string[]).includes(reason) || !delta) {
    redirect(`${path}?error=VALIDATION_FAILED`);
  }
  try {
    await (
      await serverApi()
    ).adjustStock(
      id,
      {
        variantId,
        delta,
        reason: reason as (typeof STOCK_ADJUST_REASONS)[number],
      },
      text(f, 'idempotencyKey') || `stock-${randomUUID()}`,
    );
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

/** Replaces the delivery zones with the ticked emirates. */
export async function saveDeliveryZones(f: FormData) {
  const id = uuid(f, 'businessId');
  const path = `/business/${id}/delivery`;
  const zones = [];
  for (const emirate of EMIRATE_CODES) {
    if (f.get(`on-${emirate}`) !== 'on') continue;
    const feeFils = parseAed(f.get(`fee-${emirate}`));
    const free = text(f, `free-${emirate}`);
    const freeOverFils = free ? parseAed(free) : null;
    if (feeFils === null || (free && freeOverFils === null))
      redirect(`${path}?error=VALIDATION_FAILED`);
    zones.push({
      emirate,
      feeFils,
      freeOverFils,
      minDays: intOr(f, `min-${emirate}`, 1) ?? 1,
      maxDays: intOr(f, `max-${emirate}`, 3) ?? 3,
    });
  }
  try {
    await (await serverApi()).putDeliveryZones(id, { zones });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}
