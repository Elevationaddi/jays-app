import { ApiClientError } from '@jays/api-client';
import { PRODUCT_IMAGES_MAX, canEditProduct, canSubmitProduct } from '@jays/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductFields, VariantFields } from '../../../../../components/ProductFields';
import { Workspace, loadBusiness, money } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import {
  addVariant,
  archiveProduct,
  removeProductImage,
  submitProduct,
  updateProduct,
  updateVariant,
  uploadProductImage,
} from '../../catalog-actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; productId: string }>;
  searchParams: Search;
}) {
  const { businessId, productId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const api = await serverApi();
  let product;
  try {
    product = await api.merchantProduct(businessId, productId);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 400))
      notFound();
    throw error;
  }
  const [categories, brands] = await Promise.all([api.categories('shop'), api.brands()]);
  const editable = canEditProduct(product.status);
  const hidden = (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="productId" value={productId} />
    </>
  );
  const banner =
    product.status === 'submitted'
      ? { kind: 'info', text: tr('product.inReview') }
      : product.status === 'suspended'
        ? {
            kind: 'error',
            text: tr('product.suspended', { reason: product.suspensionReason ?? '' }),
          }
        : product.changesPending
          ? { kind: 'info', text: tr('product.editsPending') }
          : product.reviewReason
            ? { kind: 'error', text: tr('product.rejected', { reason: product.reviewReason }) }
            : null;

  return (
    <Workspace
      locale={locale}
      business={business}
      tab="products"
      path={`/business/${businessId}/products/${productId}`}
      title={product.draft.title[locale]}
      error={query['error']}
      notice={
        query['submitted']
          ? tr('product.submitted')
          : query['saved']
            ? tr('common.saved')
            : undefined
      }
    >
      <p className="meta">
        <Link href={`/business/${businessId}/products`}>{tr('product.back')}</Link>
        <span className={`badge ${product.status}`}>{tr(`productStatus.${product.status}`)}</span>
      </p>
      {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}
      <div className="split">
        <div className="stack">
          <section className="card" aria-labelledby="details-title">
            <h2 id="details-title">{tr('product.details')}</h2>
            <form action={updateProduct}>
              {hidden}
              <fieldset disabled={!editable} className="plain">
                <ProductFields
                  locale={locale}
                  content={product.draft}
                  categories={categories.items.filter((c) => c.status === 'active')}
                  brands={brands.items.filter((b) => b.status === 'active')}
                />
                <button className="btn" type="submit">
                  {tr('product.save')}
                </button>
              </fieldset>
            </form>
          </section>

          <section className="card" aria-labelledby="variants-title">
            <h2 id="variants-title">{tr('product.variants')}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {tr('product.variants.hint')}
            </p>
            {product.variants.map((v) => (
              <details key={v.id} className="variant" open={product.variants.length === 1}>
                <summary>
                  <strong>{v.name[locale]}</strong> <span className="ltr muted">{v.sku}</span> ·{' '}
                  {money(v.priceFils, locale)}
                  {v.compareAtFils ? (
                    <>
                      {' '}
                      <s className="muted">{money(v.compareAtFils, locale)}</s>
                    </>
                  ) : null}{' '}
                  · {tr('products.available', { count: v.stockAvailable })}
                  {v.status === 'archived' ? ` · ${tr('productStatus.archived')}` : ''}
                </summary>
                <form action={updateVariant}>
                  {hidden}
                  <input type="hidden" name="variantId" value={v.id} />
                  <fieldset disabled={!editable || v.status === 'archived'} className="plain">
                    <VariantFields locale={locale} variant={v} idPrefix={v.id} />
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn secondary" type="submit">
                        {tr('product.variant.save')}
                      </button>
                      <button className="btn ghost" type="submit" name="archive" value="1">
                        {tr('product.variant.archive')}
                      </button>
                    </div>
                  </fieldset>
                </form>
              </details>
            ))}
            {editable ? (
              <details className="variant">
                <summary>{tr('product.variant.add')}</summary>
                <form action={addVariant}>
                  {hidden}
                  <VariantFields locale={locale} variant={null} idPrefix="new" />
                  <button className="btn secondary" type="submit">
                    {tr('product.variant.add')}
                  </button>
                </form>
              </details>
            ) : null}
          </section>
        </div>

        <aside className="stack">
          <section className="card" aria-labelledby="images-title">
            <h2 id="images-title">{tr('product.images')}</h2>
            <p className="muted" style={{ margin: 0 }} id="images-hint">
              {tr('product.images.hint')}
            </p>
            {product.draft.images.length === 0 ? (
              <p className="muted">{tr('product.images.none')}</p>
            ) : (
              <ul className="gallery">
                {product.draft.images.map((img) => (
                  <li key={img.id}>
                    {img.url ? <img src={img.url} alt="" className="thumb product" /> : null}
                    {editable ? (
                      <form action={removeProductImage}>
                        {hidden}
                        <input type="hidden" name="mediaId" value={img.id} />
                        <button className="btn ghost" type="submit">
                          {tr('product.images.remove')}
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {editable && product.draft.images.length < PRODUCT_IMAGES_MAX ? (
              <form action={uploadProductImage} className="upload">
                {hidden}
                <label className="sr-only" htmlFor="image-file">
                  {tr('product.images.add')}
                </label>
                <input
                  id="image-file"
                  name="file"
                  type="file"
                  required
                  accept="image/jpeg,image/png,image/webp"
                  aria-describedby="images-hint"
                />
                <button className="btn secondary" type="submit">
                  {tr('product.images.add')}
                </button>
              </form>
            ) : null}
          </section>
          <section className="card">
            {canSubmitProduct(product.status) ? (
              <form action={submitProduct}>
                {hidden}
                <button className="btn block" type="submit">
                  {tr('product.submit')}
                </button>
              </form>
            ) : null}
            {product.status !== 'archived' ? (
              <form action={archiveProduct}>
                {hidden}
                <button className="btn ghost block" type="submit">
                  {tr('product.archive')}
                </button>
              </form>
            ) : null}
          </section>
        </aside>
      </div>
    </Workspace>
  );
}
