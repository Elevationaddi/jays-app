import { randomBytes } from 'node:crypto';

/**
 * Optional delivery-partner interface (ADR-0029). Businesses deliver themselves and enter
 * tracking by hand; a partner adapter can book a shipment and return its tracking instead. No
 * paid provider is wired: a real courier needs the founder's approval and its own adapter.
 */
export interface DeliveryPartner {
  readonly name: 'mock';
  createShipment(input: ShipmentRequest): Promise<Shipment>;
}

export interface ShipmentRequest {
  merchantOrderId: string;
  businessId: string;
  emirate: string;
  method: 'standard' | 'express';
}

export interface Shipment {
  carrier: string;
  trackingNumber: string;
  /** Always https. */
  trackingUrl: string;
}

export const DELIVERY_PARTNER = Symbol('DELIVERY_PARTNER');

/**
 * Books fictional shipments for local testing. Its tracking links point at a reserved test
 * domain and lead nowhere. Production refuses DELIVERY_PARTNER=mock.
 */
export class MockDeliveryPartner implements DeliveryPartner {
  readonly name = 'mock' as const;
  readonly shipments: ShipmentRequest[] = [];

  createShipment(input: ShipmentRequest): Promise<Shipment> {
    this.shipments.push(input);
    const trackingNumber = `MOCK-${randomBytes(5).toString('hex').toUpperCase()}`;
    return Promise.resolve({
      carrier: 'Mock courier (test)',
      trackingNumber,
      trackingUrl: `https://tracking.example.test/${trackingNumber}`,
    });
  }
}
