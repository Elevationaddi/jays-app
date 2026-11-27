import Link from 'next/link';
import { ProductFields, VariantFields } from '../../../../../components/ProductFields';
import { Workspace, loadBusiness } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import { createProduct } from '../../catalog-actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function NewProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const api = await serverApi();
  const [categories, brands] = await Promise.all([api.categories('shop'), api.brands()]);
  return (
    <Workspace
      locale={locale}
      business={business}
      tab="products"
      path={`/business/${businessId}/products/new`}
      title={tr('product.newTitle')}
      intro={tr('product.variants.hint')}
      error={query['error']}
    >
      <p>
        <Link href={`/business/${businessId}/products`}>{tr('product.back')}</Link>
      </p>
      <form action={createProduct} className="stack" style={{ maxWidth: 760 }}>
        <input type="hidden" name="businessId" value={businessId} />
        <section className="card">
          <h2>{tr('product.details')}</h2>
          <ProductFields
            locale={locale}
            content={null}
            categories={categories.items.filter((c) => c.status === 'active')}
            brands={brands.items.filter((b) => b.status === 'active')}
          />
        </section>
        <section className="card">
          <h2>{tr('product.variants')}</h2>
          <VariantFields locale={locale} variant={null} idPrefix="v0" />
        </section>
        <div>
          <button className="btn" type="submit">
            {tr('product.create')}
          </button>
        </div>
      </form>
    </Workspace>
  );
}
