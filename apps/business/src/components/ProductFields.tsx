import type { BrandView, CategoryView, MerchantProduct, MerchantVariant } from '@jays/contracts';
import { TAX_CLASSES } from '@jays/domain';
import { t, type Locale } from '@jays/i18n';
import { aedInput } from './Workspace';

type Content = MerchantProduct['draft'];

/** Listing text, category and brand. Both languages are required (docs/08-design.md). */
export function ProductFields({
  locale,
  content,
  categories,
  brands,
}: {
  locale: Locale;
  content: Content | null;
  categories: CategoryView[];
  brands: BrandView[];
}) {
  const tr = (key: Parameters<typeof t>[1]) => t(locale, key);
  return (
    <>
      <div className="grid2">
        <div className="field">
          <label htmlFor="titleEn">{tr('product.titleEn')}</label>
          <input
            id="titleEn"
            name="titleEn"
            type="text"
            dir="ltr"
            lang="en"
            minLength={2}
            maxLength={120}
            required
            defaultValue={content?.title.en ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="titleAr">{tr('product.titleAr')}</label>
          <input
            id="titleAr"
            name="titleAr"
            type="text"
            dir="rtl"
            lang="ar"
            minLength={2}
            maxLength={120}
            required
            defaultValue={content?.title.ar ?? ''}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="descriptionEn">{tr('product.descriptionEn')}</label>
        <textarea
          id="descriptionEn"
          name="descriptionEn"
          dir="ltr"
          lang="en"
          rows={4}
          minLength={10}
          maxLength={4000}
          required
          defaultValue={content?.description.en ?? ''}
        />
      </div>
      <div className="field">
        <label htmlFor="descriptionAr">{tr('product.descriptionAr')}</label>
        <textarea
          id="descriptionAr"
          name="descriptionAr"
          dir="rtl"
          lang="ar"
          rows={4}
          minLength={10}
          maxLength={4000}
          required
          defaultValue={content?.description.ar ?? ''}
        />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="categoryId">{tr('product.category')}</label>
          <select
            id="categoryId"
            name="categoryId"
            required
            defaultValue={content?.categoryId ?? ''}
          >
            <option value="" disabled>
              {tr('product.category')}
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.depth > 0 ? '— ' : ''}
                {c.name[locale]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="brandId">{tr('product.brand')}</label>
          <select id="brandId" name="brandId" defaultValue={content?.brandId ?? ''}>
            <option value="">{tr('product.noBrand')}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name[locale]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          name="returnEligible"
          defaultChecked={content?.returnEligible ?? true}
        />
        <span>{tr('shop.returnEligible')}</span>
      </label>
    </>
  );
}

/** One variant's name, SKU, VAT-inclusive price and VAT class. */
export function VariantFields({
  locale,
  variant,
  idPrefix,
}: {
  locale: Locale;
  variant: MerchantVariant | null;
  idPrefix: string;
}) {
  const tr = (key: Parameters<typeof t>[1]) => t(locale, key);
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <div className="grid2">
      <div className="field">
        <label htmlFor={id('nameEn')}>{tr('product.variant.nameEn')}</label>
        <input
          id={id('nameEn')}
          type="text"
          name="variantNameEn"
          dir="ltr"
          lang="en"
          maxLength={80}
          required
          defaultValue={variant?.name.en ?? ''}
        />
      </div>
      <div className="field">
        <label htmlFor={id('nameAr')}>{tr('product.variant.nameAr')}</label>
        <input
          id={id('nameAr')}
          type="text"
          name="variantNameAr"
          dir="rtl"
          lang="ar"
          maxLength={80}
          required
          defaultValue={variant?.name.ar ?? ''}
        />
      </div>
      <div className="field">
        <label htmlFor={id('sku')}>{tr('product.variant.sku')}</label>
        <input
          id={id('sku')}
          type="text"
          name="sku"
          dir="ltr"
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}"
          required={!variant}
          disabled={Boolean(variant)}
          defaultValue={variant?.sku ?? ''}
        />
      </div>
      <div className="field">
        <label htmlFor={id('price')}>{tr('product.variant.price')}</label>
        <input
          id={id('price')}
          type="text"
          name="price"
          dir="ltr"
          inputMode="decimal"
          pattern="\d{1,7}(\.\d{1,2})?"
          required
          defaultValue={variant ? aedInput(variant.priceFils) : ''}
        />
      </div>
      <div className="field">
        <label htmlFor={id('tax')}>{tr('product.variant.taxClass')}</label>
        <select id={id('tax')} name="taxClass" defaultValue={variant?.taxClass ?? 'standard'}>
          {TAX_CLASSES.map((c) => (
            <option key={c} value={c}>
              {tr(`taxClass.${c}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={id('low')}>{tr('product.variant.lowStock')}</label>
        <input
          id={id('low')}
          name="lowStockThreshold"
          type="number"
          min={0}
          max={100000}
          dir="ltr"
          defaultValue={variant?.lowStockThreshold ?? 3}
        />
      </div>
    </div>
  );
}
