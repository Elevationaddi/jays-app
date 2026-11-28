import Link from 'next/link';
import { TaxDocumentView } from '../../../../../../components/TaxDocumentView';
import { Workspace, loadBusiness } from '../../../../../../components/Workspace';
import { serverApi } from '../../../../../../lib/api';
import { translator } from '../../../../../../lib/i18n';

/** One invoice, commission invoice or credit note, printable from the browser. */
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ businessId: string; documentId: string }>;
}) {
  const { businessId, documentId } = await params;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/finance`;
  const frame = { locale, business, tab: 'finance' as const, path, title: tr('tax.documents') };
  if (!business.myCapabilities.includes('finance.view')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const doc = await (await serverApi()).businessDocument(businessId, documentId);
  return (
    <Workspace {...frame}>
      <p>
        <Link href={`${path}?view=documents`}>{tr('finance.backToDocuments')}</Link>
      </p>
      <TaxDocumentView doc={doc} locale={locale} />
    </Workspace>
  );
}
