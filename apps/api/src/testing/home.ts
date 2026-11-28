import { homeServiceProfileSchema, type Session, uploadTicketSchema } from '@jays/contracts';
import { approvedVenue, type Venue } from './booking.js';
import { adminLogin, bearer, type Harness, provisionAdmin, putUpload } from './harness.js';
import { fictionalPdf } from './png.js';

/** Helpers for home-visit tests (phase 8.5, 8.8). Everything here is fictional. */

export async function addAddress(h: Harness, session: Session, emirate: string, area: string) {
  const res = await h
    .http()
    .post('/v1/me/addresses')
    .set('Authorization', bearer(session))
    .send({ emirate, area, street: 'Fictional Street 4', building: 'Villa 12' })
    .expect(201);
  return res.body.id as string;
}

export async function uploadLicence(h: Harness, v: Venue) {
  const bytes = fictionalPdf('Fictional home service licence');
  const ticket = uploadTicketSchema.parse(
    (
      await h
        .http()
        .post(`/v1/businesses/${v.businessId}/documents`)
        .set('Authorization', bearer(v.owner))
        .send({
          kind: 'home_service_license',
          fileName: 'home-licence.pdf',
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
        })
        .expect(201)
    ).body,
  );
  await putUpload(h, ticket, bytes).expect(200);
  await h
    .http()
    .post(`/v1/businesses/${v.businessId}/documents/${ticket.id}/complete`)
    .set('Authorization', bearer(v.owner))
    .expect(200);
  return ticket.id;
}

export const profileBody = (documentId: string | null, over: Record<string, unknown> = {}) => ({
  licenseNumber: 'HS-2026-0042',
  licenseAuthority: 'Fictional Licensing Authority',
  licenseExpiry: '2030-06-30',
  licenseDocumentId: documentId,
  travelBufferMin: 30,
  minOrderFils: 10_000,
  areas: [
    { emirate: 'DXB', area: null, travelFeeFils: 3_000 },
    { emirate: 'DXB', area: 'Dubai Marina', travelFeeFils: 1_500 },
  ],
  ...over,
});

/** A venue approved for home visits, with its service offered at the venue and at home. */
export async function homeVenue(h: Harness) {
  const v = await approvedVenue(h);
  const base = `/v1/businesses/${v.businessId}`;
  const auth = bearer(v.owner);
  const doc = await uploadLicence(h, v);
  await h
    .http()
    .put(`${base}/home-services`)
    .set('Authorization', auth)
    .send(profileBody(doc))
    .expect(200);
  const submitted = homeServiceProfileSchema.parse(
    (await h.http().post(`${base}/home-services/submit`).set('Authorization', auth).expect(200))
      .body,
  );
  const admin = bearer(await adminLogin(h, await provisionAdmin(h, ['compliance'])));
  await h
    .http()
    .post(`/v1/admin/home-services/${v.businessId}/decision`)
    .set('Authorization', admin)
    .send({ decision: 'approve', expectedVersion: submitted.version })
    .expect(200);
  await h
    .http()
    .patch(`${base}/services/${v.serviceId}`)
    .set('Authorization', auth)
    .send({ locationMode: 'both' })
    .expect(200);
  return { v, admin };
}
