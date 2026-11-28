import Link from 'next/link';
import { Shell } from '../../../../../components/Shell';
import { TaxDocumentView } from '../../../../../components/TaxDocumentView';
import { requireAdmin } from '../../../../../lib/admin';
import { translator } from '../../../../../lib/i18n';
import { can, Forbidden } from '../../shared';

export default async function TaxDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin(`/admin/finance/tax/${documentId}`);
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  const doc = await api.adminTaxDocument(documentId);
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <p>
        <Link href="/admin/finance/tax">{tr('admin.tax.back')}</Link>
      </p>
      <TaxDocumentView doc={doc} locale={locale} />
    </Shell>
  );
}
